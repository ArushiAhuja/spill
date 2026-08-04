import { NextResponse } from 'next/server';
import { getUser } from '../../../../../../server/api-auth.js';
import { getObservabilityScope, scopeAllowsOrg } from '../../../../../../server/super-admin.js';
import { ensureMigrations } from '../../../../../../server/migrate.js';
import { query } from '../../../../../../server/db.js';
import { buildEffectivePromptPreview, getPromptVersions, listPrompts, safeMonitoringConfig, savePrompt, rollbackPrompt, PROMPT_KEYS } from '../../../../../../server/prompts.js';
import { agentForPrompt, getOrganizationAgentConfigs, getOrganizationAgentConfigVersions, saveOrganizationAgentConfig } from '../../../../../../server/organization-agent-config.js';

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
    const { rows: [organization] } = await query(`SELECT o.id,o.name,o.slug,o.description,o.website,o.competitors,o.industry_keywords,o.partner_brands,o.organization_profile,o.intel_profile,COALESCE(array_agg(sc.source) FILTER (WHERE sc.enabled),'{}') AS active_sources FROM organizations o LEFT JOIN source_configs sc ON sc.org_id=o.id WHERE o.id=$1 GROUP BY o.id`, [params.id]);
    if (!organization) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const { rows: [metrics] } = await query(`SELECT COUNT(*)::int total_events,COUNT(*) FILTER(WHERE decision='surfaced')::int surfaced,COUNT(*) FILTER(WHERE decision LIKE 'suppressed%')::int suppressed,ROUND(AVG((quality->>'relevance')::numeric),2) avg_relevance,ROUND(AVG(p.escalation_score)::numeric,1) avg_escalation,MAX(t.created_at) last_event_at FROM ai_traces t LEFT JOIN posts p ON p.id=t.post_id WHERE t.org_id=$1`, [params.id]);
    const [{ rows: agents }, { rows: categories }, { rows: sourceConfigs }, { rows: recentTraces }, { rows: feedbackSummary }, agentConfigs] = await Promise.all([
      query(`SELECT o.name,COALESCE(o.model,'deterministic') model,MAX(o.prompt_version) prompt_version,MAX(o.created_at) last_execution,COUNT(*)::int executions,COUNT(*) FILTER (WHERE o.error IS NULL)::int successful,COUNT(*) FILTER (WHERE o.error IS NOT NULL)::int failed FROM ai_observations o JOIN ai_traces t ON t.id=o.trace_id WHERE t.org_id=$1 GROUP BY o.name,o.model ORDER BY last_execution DESC`, [params.id]),
      query('SELECT id,name,description,severity,color FROM categories WHERE org_id=$1 ORDER BY severity DESC,name', [params.id]),
      query('SELECT source,enabled,config FROM source_configs WHERE org_id=$1 ORDER BY source', [params.id]),
      // Initial slice only — the org page loads full history via /traces with pagination.
      query(`SELECT t.id,t.trace_key,t.decision,t.created_at,t.source,p.title,p.escalation_score FROM ai_traces t LEFT JOIN posts p ON p.id=t.post_id WHERE t.org_id=$1 ORDER BY t.created_at DESC LIMIT 50`, [params.id]),
      query(`SELECT label,COUNT(*)::int count FROM post_feedback WHERE org_id=$1 AND created_at > NOW()-INTERVAL '60 days' GROUP BY label ORDER BY count DESC`, [params.id]),
      getOrganizationAgentConfigs(params.id),
    ]);
    const safeSources = sourceConfigs.map(source => ({ source: source.source, enabled: source.enabled, config: safeMonitoringConfig(source.config) }));
    const prompts = (await listPrompts(params.id)).map(prompt => ({
      ...prompt,
      effective_content: buildEffectivePromptPreview(prompt.prompt_key, prompt.content, organization, categories, safeSources, agentConfigs.find(config => config.agent_name === agentForPrompt(prompt.prompt_key)?.agent_name)),
    }));
    const versions = {}; for (const p of prompts) versions[p.prompt_key] = await getPromptVersions(params.id, p.prompt_key, 10);
    const agentConfigVersions = {}; for (const config of agentConfigs) agentConfigVersions[config.agent_name] = await getOrganizationAgentConfigVersions(params.id, config.agent_name, 10);
    return NextResponse.json({ organization, metrics, agents, agent_configs: agentConfigs, agent_config_versions: agentConfigVersions, prompts, versions, recent_traces: recentTraces, quality: { feedback: feedbackSummary }, prompt_context: { categories, monitoring_sources: safeSources, inferred_intelligence: organization.intel_profile || {} } });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function PUT(request, { params }) {
  try {
    const auth = await authorize(request, params.id); if (auth.error) return auth.error;
    const body = await request.json();
    const { prompt_key, content, change_summary, action, target_version } = body;
    if (action === 'save_agent_config') {
      if (!body.agent_name) return NextResponse.json({ error: 'agent_name is required' }, { status: 400 });
      const config = await saveOrganizationAgentConfig(params.id, body.agent_name, body.config || {}, auth.user.email, change_summary);
      return NextResponse.json({ config });
    }
    if (action === 'save_organization_profile') {
      const profile = body.organization_profile && typeof body.organization_profile === 'object' && !Array.isArray(body.organization_profile) ? body.organization_profile : null;
      if (!profile) return NextResponse.json({ error: 'organization_profile object is required' }, { status: 400 });
      const { rows: [organization] } = await query('UPDATE organizations SET organization_profile=$1,updated_at=NOW() WHERE id=$2 RETURNING organization_profile', [JSON.stringify(profile), params.id]);
      return NextResponse.json({ organization });
    }
    if (!PROMPT_KEYS.includes(prompt_key)) return NextResponse.json({ error: 'valid prompt_key is required' }, { status: 400 });
    const prompt = action === 'rollback'
      ? await rollbackPrompt(params.id, prompt_key, Number(target_version), auth.user.email)
      : !content?.trim() ? null : await savePrompt(params.id, prompt_key, content.trim(), auth.user.email, change_summary?.trim() || 'updated from internal console');
    if (!prompt) return NextResponse.json({ error: 'prompt content is required' }, { status: 400 });
    return NextResponse.json({ prompt });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
