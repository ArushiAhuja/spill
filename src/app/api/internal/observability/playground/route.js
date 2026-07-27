import OpenAI from 'openai';
import { NextResponse } from 'next/server';
import { getUser } from '../../../../../server/api-auth.js';
import { getObservabilityScope, scopeAllowsOrg } from '../../../../../server/super-admin.js';
import { ensureMigrations } from '../../../../../server/migrate.js';
import { query } from '../../../../../server/db.js';
import { buildEffectivePromptPreview, getPromptMetadata, safeMonitoringConfig, PROMPT_KEYS } from '../../../../../server/prompts.js';
import { agentForPrompt, getOrganizationAgentConfigs } from '../../../../../server/organization-agent-config.js';
import { createEventTrace } from '../../../../../server/observability.js';

const MODELS = new Set(['gpt-4o-mini', 'gpt-4o']);
export async function POST(request) {
  try {
    await ensureMigrations(); const user = getUser(request); if (!user) return NextResponse.json({ error:'unauthorized' },{status:401});
    const { org_id, complaint, prompt_key='classifier_system', prompt_override, model='gpt-4o-mini' } = await request.json();
    const scope = await getObservabilityScope(user); if (!scopeAllowsOrg(scope, org_id)) return NextResponse.json({error:'forbidden'},{status:403});
    if (!complaint?.trim() || !PROMPT_KEYS.includes(prompt_key) || !MODELS.has(model)) return NextResponse.json({error:'invalid playground input'},{status:400});
    const [{ rows: categories }, { rows: orgRows }, { rows: sourceConfigs }, prompt, agentConfigs] = await Promise.all([
      query('SELECT id,name,description,severity FROM categories WHERE org_id=$1',[org_id]),
      query('SELECT id,name,description,website,competitors,industry_keywords,partner_brands,organization_profile,intel_profile FROM organizations WHERE id=$1',[org_id]),
      query('SELECT source,enabled,config FROM source_configs WHERE org_id=$1 ORDER BY source',[org_id]),
      getPromptMetadata(org_id,prompt_key),
      getOrganizationAgentConfigs(org_id),
    ]);
    const organization = orgRows[0]; if (!organization) return NextResponse.json({error:'organisation not found'},{status:404});
    const safeSources = sourceConfigs.map(source => ({ source: source.source, enabled: source.enabled, config: safeMonitoringConfig(source.config) }));
    const agentConfig = agentConfigs.find(config => config.agent_name === agentForPrompt(prompt_key)?.agent_name);
    const system = buildEffectivePromptPreview(prompt_key, prompt_override?.trim() || prompt.content, organization, categories, safeSources, agentConfig);
    const started=Date.now(); const res=await new OpenAI({apiKey:process.env.OPENAI_API_KEY}).chat.completions.create({model,temperature:0,max_tokens:700,messages:[{role:'system',content:`${system}\nReturn JSON only: {"relevant":boolean,"category":"string|null","confidence":0-100,"customer_impact":0-10,"operational_urgency":0-10,"trust_risk":0-10,"reasoning":"string"}`},{role:'user',content:`Organisation categories: ${JSON.stringify(categories)}\nCustomer complaint: ${complaint.trim()}`} ]});
    const raw=res.choices[0].message.content.trim(); let output; try { output=JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0]||raw); } catch { output={raw}; }
    const escalation=Math.min(100,Math.round(((output.customer_impact||0)*.4+(output.operational_urgency||0)*.35+(output.trust_risk||0)*.25)*10));
    const traceId = await createEventTrace({ orgId: org_id, post: { id: `playground-${Date.now()}`, source: 'internal_playground', title: 'Agent playground run', body: complaint.trim(), detected_query: 'manual playground' }, quality: { relevance: output.relevant ? 1 : 0, confidence: Number(output.confidence || 0) / 100, score: Number(output.confidence || 0) }, decision: 'playground', promptVersions: { [prompt_key]: prompt.version }, observations: [{ name: 'Playground Agent', kind: 'agent', model, promptKey: prompt_key, promptVersion: prompt.version, input: { complaint: complaint.trim(), effective_prompt: system, agent_config_version: agentConfig?.version || 0 }, output, latencyMs: Date.now() - started, inputTokens: res.usage?.prompt_tokens, outputTokens: res.usage?.completion_tokens, promptSnapshot: { key: prompt_key, version: prompt.version, content: system }, configSnapshot: agentConfig || {} }] });
    return NextResponse.json({ output, trace_id: traceId, model, prompt_version:prompt.version, used_override:!!prompt_override?.trim(), effective_prompt:system, latency_ms:Date.now()-started, tokens:res.usage, metrics:{relevance:output.confidence??null, escalation_score:escalation, classification_accuracy:'requires labelled expected category', hallucinations:'requires human review'} });
  } catch(err) { return NextResponse.json({error:err.message},{status:500}); }
}
