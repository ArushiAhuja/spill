import { NextResponse } from 'next/server';
import { getUser } from '../../../../../../server/api-auth.js';
import { getObservabilityScope, scopeAllowsOrg } from '../../../../../../server/super-admin.js';
import { ensureMigrations } from '../../../../../../server/migrate.js';
import { query } from '../../../../../../server/db.js';
import { getPromptVersions, listPrompts, savePrompt, rollbackPrompt, PROMPT_KEYS } from '../../../../../../server/prompts.js';

async function authorize(request, orgId) {
  await ensureMigrations();
  const user = getUser(request);
  if (!user) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  const scope = await getObservabilityScope(user);
  if (!scopeAllowsOrg(scope, orgId)) return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  return { user };
}

export async function GET(request, { params }) {
  try {
    const auth = await authorize(request, params.id); if (auth.error) return auth.error;
    const { rows: [organization] } = await query(`SELECT o.id,o.name,o.slug,o.description,o.intel_profile,COALESCE(array_agg(sc.source) FILTER (WHERE sc.enabled),'{}') AS active_sources FROM organizations o LEFT JOIN source_configs sc ON sc.org_id=o.id WHERE o.id=$1 GROUP BY o.id`, [params.id]);
    if (!organization) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const { rows: [metrics] } = await query(`SELECT COUNT(*)::int total_events,COUNT(*) FILTER(WHERE decision='surfaced')::int surfaced,COUNT(*) FILTER(WHERE decision LIKE 'suppressed%')::int suppressed,ROUND(AVG((quality->>'relevance')::numeric),2) avg_relevance,ROUND(AVG(p.escalation_score)::numeric,1) avg_escalation,MAX(t.created_at) last_event_at FROM ai_traces t LEFT JOIN posts p ON p.id=t.post_id WHERE t.org_id=$1`, [params.id]);
    const { rows: agents } = await query(`SELECT name,COALESCE(model,'deterministic') model,MAX(prompt_version) prompt_version,MAX(created_at) last_execution,COUNT(*)::int executions,COUNT(*) FILTER (WHERE error IS NULL)::int successful,COUNT(*) FILTER (WHERE error IS NOT NULL)::int failed FROM ai_observations o JOIN ai_traces t ON t.id=o.trace_id WHERE t.org_id=$1 GROUP BY name,model ORDER BY last_execution DESC`, [params.id]);
    const prompts = await listPrompts(params.id);
    const versions = {}; for (const p of prompts) versions[p.prompt_key] = await getPromptVersions(params.id, p.prompt_key, 10);
    return NextResponse.json({ organization, metrics, agents, prompts, versions });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function PUT(request, { params }) {
  try {
    const auth = await authorize(request, params.id); if (auth.error) return auth.error;
    const { prompt_key, content, change_summary, action, target_version } = await request.json();
    if (!PROMPT_KEYS.includes(prompt_key)) return NextResponse.json({ error: 'valid prompt_key is required' }, { status: 400 });
    const prompt = action === 'rollback'
      ? await rollbackPrompt(params.id, prompt_key, Number(target_version), auth.user.email)
      : !content?.trim() ? null : await savePrompt(params.id, prompt_key, content.trim(), auth.user.email, change_summary?.trim() || 'updated from internal console');
    if (!prompt) return NextResponse.json({ error: 'prompt content is required' }, { status: 400 });
    return NextResponse.json({ prompt });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
