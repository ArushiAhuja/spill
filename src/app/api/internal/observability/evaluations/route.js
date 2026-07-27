import OpenAI from 'openai';
import { NextResponse } from 'next/server';
import { getUser } from '../../../../../server/api-auth.js';
import { getObservabilityScope, scopeAllowsOrg } from '../../../../../server/super-admin.js';
import { ensureMigrations } from '../../../../../server/migrate.js';
import { query } from '../../../../../server/db.js';
import { buildEffectivePromptPreview, getPromptMetadata, safeMonitoringConfig } from '../../../../../server/prompts.js';
import { agentForPrompt, getOrganizationAgentConfigs } from '../../../../../server/organization-agent-config.js';

const MODELS = new Set(['gpt-4o-mini', 'gpt-4o']);
const BUCKETS = new Set(['good_signal', 'bad_signal', 'borderline']);

async function authorize(request, orgId) {
  await ensureMigrations();
  const user = getUser(request);
  if (!user) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  const scope = await getObservabilityScope(user);
  if (!scopeAllowsOrg(scope, orgId)) return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  return { user };
}

export async function GET(request) {
  try {
    const orgId = new URL(request.url).searchParams.get('org_id');
    const auth = await authorize(request, orgId); if (auth.error) return auth.error;
    const [{ rows: cases }, { rows: runs }, { rows: experiments }] = await Promise.all([
      query(`SELECT id,post_id,agent_name,input,expected_output,bucket,notes,created_by,created_at FROM agent_evaluation_cases WHERE org_id=$1 ORDER BY created_at DESC LIMIT 100`, [orgId]),
      query(`SELECT id,agent_name,prompt_key,prompt_version,config_version,model,case_count,metrics,created_by,created_at FROM agent_evaluation_runs WHERE org_id=$1 ORDER BY created_at DESC LIMIT 30`, [orgId]),
      query(`SELECT id,agent_name,prompt_key,status,baseline_model,candidate_model,created_by,created_at,completed_at FROM prompt_experiments WHERE org_id=$1 ORDER BY created_at DESC LIMIT 30`, [orgId]),
    ]);
    return NextResponse.json({ cases, runs, experiments });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

function metricsFor(results) {
  const withRelevance = results.filter(result => typeof result.expected.relevant === 'boolean');
  const relevanceCorrect = withRelevance.filter(result => result.actual.relevant === result.expected.relevant).length;
  const withCategory = results.filter(result => result.expected.category && result.actual.category);
  const categoryCorrect = withCategory.filter(result => result.actual.category.toLowerCase() === String(result.expected.category).toLowerCase()).length;
  const confidenceErrors = withRelevance.map(result => Math.abs((Number(result.actual.confidence || 0) / 100) - (result.expected.relevant ? 1 : 0)));
  const jsonFailures = results.filter(result => result.actual.parse_error).length;
  return {
    relevance_accuracy: withRelevance.length ? Math.round((relevanceCorrect / withRelevance.length) * 1000) / 10 : null,
    classification_accuracy: withCategory.length ? Math.round((categoryCorrect / withCategory.length) * 1000) / 10 : null,
    confidence_calibration_error: confidenceErrors.length ? Math.round((confidenceErrors.reduce((a, b) => a + b, 0) / confidenceErrors.length) * 1000) / 1000 : null,
    hallucination_rate: results.length ? Math.round((jsonFailures / results.length) * 1000) / 10 : 0,
    false_positive_rate: withRelevance.length ? Math.round((results.filter(result => result.expected.relevant === false && result.actual.relevant === true).length / withRelevance.length) * 1000) / 10 : null,
  };
}

export async function POST(request) {
  try {
    const body = await request.json(); const orgId = body.org_id;
    const auth = await authorize(request, orgId); if (auth.error) return auth.error;
    if (body.action === 'create_case') {
      if (!body.input || !body.expected_output || !BUCKETS.has(body.bucket || 'good_signal')) return NextResponse.json({ error: 'input, expected_output and valid bucket are required' }, { status: 400 });
      const { rows: [created] } = await query(
        `INSERT INTO agent_evaluation_cases (org_id,post_id,agent_name,input,expected_output,bucket,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [orgId, body.post_id || null, body.agent_name || 'category', JSON.stringify(body.input), JSON.stringify(body.expected_output), body.bucket || 'good_signal', body.notes || null, auth.user.email || null]
      );
      return NextResponse.json({ case: created });
    }
    if (body.action === 'create_experiment') {
      if (!body.prompt_key || !body.baseline_content || !body.candidate_content) return NextResponse.json({ error: 'prompt_key, baseline_content and candidate_content are required' }, { status: 400 });
      const { rows: [experiment] } = await query(
        `INSERT INTO prompt_experiments (org_id,agent_name,prompt_key,baseline_content,candidate_content,baseline_model,candidate_model,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [orgId, body.agent_name || 'category', body.prompt_key, body.baseline_content, body.candidate_content, body.baseline_model || 'gpt-4o-mini', body.candidate_model || 'gpt-4o-mini', auth.user.email || null]
      );
      return NextResponse.json({ experiment });
    }
    if (body.action !== 'run') return NextResponse.json({ error: 'unsupported action' }, { status: 400 });

    const promptKey = body.prompt_key || 'classifier_system';
    const model = MODELS.has(body.model) ? body.model : 'gpt-4o-mini';
    const { rows: cases } = await query(`SELECT * FROM agent_evaluation_cases WHERE org_id=$1 AND agent_name=$2 ORDER BY created_at DESC LIMIT 50`, [orgId, body.agent_name || 'category']);
    if (!cases.length) return NextResponse.json({ error: 'no evaluation cases for this organisation and agent' }, { status: 400 });
    const [{ rows: orgRows }, { rows: categories }, { rows: sources }, prompt, configs] = await Promise.all([
      query('SELECT id,name,description,website,competitors,industry_keywords,partner_brands,organization_profile,intel_profile FROM organizations WHERE id=$1', [orgId]),
      query('SELECT id,name,description,severity FROM categories WHERE org_id=$1', [orgId]),
      query('SELECT source,enabled,config FROM source_configs WHERE org_id=$1', [orgId]),
      getPromptMetadata(orgId, promptKey), getOrganizationAgentConfigs(orgId),
    ]);
    const org = orgRows[0]; if (!org) return NextResponse.json({ error: 'organisation not found' }, { status: 404 });
    const config = configs.find(item => item.agent_name === agentForPrompt(promptKey)?.agent_name);
    const safeSources = sources.map(source => ({ source: source.source, enabled: source.enabled, config: safeMonitoringConfig(source.config) }));
    const content = body.prompt_override?.trim() || prompt.content;
    const system = buildEffectivePromptPreview(promptKey, content, org, categories, safeSources, config);
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const results = [];
    for (const evaluationCase of cases) {
      const input = evaluationCase.input || {};
      const complaint = [input.title, input.body, input.text].filter(Boolean).join('\n') || JSON.stringify(input);
      const response = await client.chat.completions.create({ model, temperature: 0, max_tokens: 500, messages: [
        { role: 'system', content: `${system}\nReturn JSON only: {"relevant":boolean,"category":"string|null","confidence":0-100,"customer_impact":0-10,"operational_urgency":0-10,"trust_risk":0-10,"reasoning":"string"}` },
        { role: 'user', content: `Organisation categories: ${JSON.stringify(categories)}\nCustomer signal: ${complaint}` },
      ] });
      const raw = response.choices[0].message.content?.trim() || '';
      let actual; try { actual = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw); } catch { actual = { raw, parse_error: true, relevant: false, confidence: 0 }; }
      results.push({ case_id: evaluationCase.id, bucket: evaluationCase.bucket, expected: evaluationCase.expected_output, actual });
    }
    const metrics = metricsFor(results);
    const { rows: [run] } = await query(
      `INSERT INTO agent_evaluation_runs (org_id,agent_name,prompt_key,prompt_version,config_version,model,case_count,metrics,results,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [orgId, body.agent_name || 'category', promptKey, prompt.version, config?.version || 0, model, cases.length, JSON.stringify(metrics), JSON.stringify(results), auth.user.email || null]
    );
    return NextResponse.json({ run });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
