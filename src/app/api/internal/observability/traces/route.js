import { NextResponse } from 'next/server';
import { getUser } from '../../../../../server/api-auth.js';
import { getObservabilityScope, scopeAllowsOrg } from '../../../../../server/super-admin.js';
import { ensureMigrations } from '../../../../../server/migrate.js';
import { query } from '../../../../../server/db.js';
import { explainTrace } from '../../../../../server/event-intelligence.js';
import {
  buildRejectionSummary,
  extractCandidateFromTrace,
  overrideTraceToDashboard,
} from '../../../../../server/trace-override.js';

export const maxDuration = 60;

function extractSourceBody(trace, observations) {
  return extractCandidateFromTrace(trace, observations);
}

async function requireScope(request) {
  await ensureMigrations();
  const user = getUser(request);
  if (!user) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  const scope = await getObservabilityScope(user);
  if (!scope.all && !scope.orgIds.length) return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  return { user, scope };
}

function buildTracePayload(traceRow, observations) {
  const candidate = extractSourceBody(traceRow, observations || []);
  const rejection = buildRejectionSummary(traceRow, observations || []);
  const decision = traceRow.decision || 'unknown';
  const canOverride = decision !== 'surfaced' && decision !== 'surfaced_override';
  const trace = {
    ...traceRow,
    title: candidate.title || null,
    body: candidate.body || null,
    url: candidate.url || null,
    author: candidate.author || null,
  };
  return {
    trace,
    observations: observations || [],
    candidate,
    rejection,
    override: {
      available: canOverride || !traceRow.post_id,
      already_on_dashboard: Boolean(traceRow.post_id) && (decision === 'surfaced' || decision === 'surfaced_override'),
      post_id: traceRow.post_id || null,
      dashboard_path: traceRow.org_slug ? `/${traceRow.org_slug}` : null,
    },
  };
}

export async function GET(request) {
  try {
    const auth = await requireScope(request);
    if (auth.error) return auth.error;
    const { scope } = auth;
    const url = new URL(request.url);
    const orgId = url.searchParams.get('org_id');
    const traceId = url.searchParams.get('trace_id');
    if (traceId) {
      const { rows: traces } = await query(
        `SELECT t.*, o.name AS org_name, o.slug AS org_slug, p.title AS post_title, p.body AS post_body, p.url AS post_url, p.author AS post_author, p.escalation_score
         FROM ai_traces t
         JOIN organizations o ON o.id=t.org_id
         LEFT JOIN posts p ON p.id=t.post_id
         WHERE t.id::text=$1 OR t.trace_key=$1`,
        [traceId]
      );
      if (!traces[0]) return NextResponse.json({ error: 'not found' }, { status: 404 });
      if (!scopeAllowsOrg(scope, traces[0].org_id)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      if (orgId && orgId !== traces[0].org_id) return NextResponse.json({ error: 'trace does not belong to this organisation' }, { status: 404 });
      const { rows: observations } = await query('SELECT * FROM ai_observations WHERE trace_id=$1 ORDER BY created_at', [traces[0].id]);
      const explanation = await explainTrace({ trace: traces[0], observations: observations || [] });
      const payload = buildTracePayload({
        ...traces[0],
        title: traces[0].post_title,
        body: traces[0].post_body,
        url: traces[0].post_url,
        author: traces[0].post_author,
      }, observations || []);
      return NextResponse.json({ ...payload, ...explanation });
    }
    const params = [];
    const clauses = [];
    if (orgId) { params.push(orgId); clauses.push(`t.org_id=$${params.length}`); }
    if (!scope.all) { params.push(scope.orgIds); clauses.push(`t.org_id = ANY($${params.length}::uuid[])`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT t.id,t.trace_key,t.event_id,t.org_id,t.source,t.decision,t.quality,t.metadata,t.created_at,o.name AS org_name,o.slug AS org_slug,p.title,p.escalation_score
       FROM ai_traces t
       JOIN organizations o ON o.id=t.org_id
       LEFT JOIN posts p ON p.id=t.post_id
       ${where}
       ORDER BY t.created_at DESC
       LIMIT 100`,
      params
    );
    return NextResponse.json({ traces: rows });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/internal/observability/traces — override a rejected/suppressed trace onto the org dashboard.
export async function POST(request) {
  try {
    const auth = await requireScope(request);
    if (auth.error) return auth.error;
    const body = await request.json().catch(() => ({}));
    const action = body.action || 'override';
    const traceId = body.trace_id || body.id;
    if (!traceId) return NextResponse.json({ error: 'trace_id is required' }, { status: 400 });
    if (action !== 'override') return NextResponse.json({ error: 'unsupported action' }, { status: 400 });

    const { rows: traces } = await query(
      `SELECT t.id, t.org_id FROM ai_traces t WHERE t.id::text=$1 OR t.trace_key=$1`,
      [traceId]
    );
    if (!traces[0]) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (!scopeAllowsOrg(auth.scope, traces[0].org_id)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const result = await overrideTraceToDashboard({
      traceId: traces[0].id,
      user: auth.user,
      note: typeof body.note === 'string' ? body.note : '',
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
