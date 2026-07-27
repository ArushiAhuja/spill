import { NextResponse } from 'next/server';
import { getUser } from '../../../../../server/api-auth.js';
import { getObservabilityScope, scopeAllowsOrg } from '../../../../../server/super-admin.js';
import { ensureMigrations } from '../../../../../server/migrate.js';
import { query } from '../../../../../server/db.js';

export async function GET(request) {
  try {
    await ensureMigrations();
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const scope = await getObservabilityScope(user);
    if (!scope.all && !scope.orgIds.length) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    const url = new URL(request.url); const orgId = url.searchParams.get('org_id'); const traceId = url.searchParams.get('trace_id');
    if (traceId) {
      const { rows: traces } = await query(`SELECT t.*, o.name AS org_name, p.title, p.body, p.url, p.escalation_score FROM ai_traces t JOIN organizations o ON o.id=t.org_id LEFT JOIN posts p ON p.id=t.post_id WHERE t.id::text=$1 OR t.trace_key=$1`, [traceId]);
      if (!traces[0]) return NextResponse.json({ error: 'not found' }, { status: 404 });
      if (!scopeAllowsOrg(scope, traces[0].org_id)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      const { rows: observations } = await query('SELECT * FROM ai_observations WHERE trace_id=$1 ORDER BY created_at', [traceId]);
      return NextResponse.json({ trace: traces[0], observations });
    }
    const params = []; const clauses = [];
    if (orgId) { params.push(orgId); clauses.push(`t.org_id=$${params.length}`); }
    if (!scope.all) { params.push(scope.orgIds); clauses.push(`t.org_id = ANY($${params.length}::uuid[])`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await query(`SELECT t.id,t.trace_key,t.event_id,t.org_id,t.source,t.decision,t.quality,t.metadata,t.created_at,o.name AS org_name,p.title,p.escalation_score FROM ai_traces t JOIN organizations o ON o.id=t.org_id LEFT JOIN posts p ON p.id=t.post_id ${where} ORDER BY t.created_at DESC LIMIT 100`, params);
    return NextResponse.json({ traces: rows });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
