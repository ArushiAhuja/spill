import { createHash } from 'crypto';
import { getActivePrompt } from './prompt-registry.js';
import { buildOrganizationIntelligence, getOrganizationAgentBriefing, loadOrganizationIntelligence } from './organization-intelligence.js';

const BASE_IDENTITIES = {
  source_understanding: 'You are Spill\'s Source Understanding Agent. Preserve source truth and make only deterministic, explainable normalisation decisions.',
  relevance: 'You are Spill\'s Relevance Agent. Matching is CASE-INSENSITIVE. Include posts that name the monitored organisation (full brand or short moniker with admissions, aviation, training, product, or customer-experience context). Exclude only true homonyms with no industry context, self-published official posts, and posts about unrelated companies. When excluding, state a concrete reason naming this organisation. When in doubt on a clear brand moniker in industry context, INCLUDE.',
  category: 'You are Spill\'s Category Classification Agent. Classify only from supplied evidence and follow the required structured output exactly.',
  severity: 'You are Spill\'s Severity Agent. Apply the supplied scoring policy consistently; do not invent impact, urgency, or reach.',
  summary: 'You are Spill\'s Executive Summary Agent. State the operational signal accurately and concisely, without unsupported causality.',
  trend: 'You are Spill\'s Trend Detection Agent. Treat repeated, materially similar evidence as a trend and keep unrelated signals separate.',
  response_writer: 'You are Spill\'s Response Writer Agent. Produce empathetic, truthful public responses and never promise outcomes that are not authorised.',
  intelligence_extraction: 'You are Spill\'s Organisation Intelligence Agent. Convert supplied company evidence into structured monitoring intelligence; distinguish evidence from inference.',
};

function bounded(value, max = 12000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? {});
  return text.length > max ? `${text.slice(0, max)}\n[truncated]` : text;
}

function formatExamples(examples) {
  if (!Array.isArray(examples) || !examples.length) return '';
  return examples.slice(0, 6).map((example, index) => `Example ${index + 1}:\n${bounded(example, 1800)}`).join('\n\n');
}

function formatFeedback(feedbackContext) {
  if (!feedbackContext) return '';
  return bounded(feedbackContext, 5000);
}

export async function composePrompt({ agentName, orgId, organization = null, categories = [], sourceConfigs = [], agentConfig = null, feedbackContext = null, runtimeContext = {}, model = null, promptOverride = null, logExecution = true } = {}) {
  if (!orgId) throw new Error('orgId is required for prompt composition');
  const loaded = organization ? { org: organization, categories, sourceConfigs } : await loadOrganizationIntelligence(orgId, agentConfig);
  const resolved = promptOverride ? {
    prompt_id: 'runtime_override', agent_name: agentName, scope: 'runtime', organization_id: orgId,
    version: 0, status: 'draft', prompt_template: promptOverride,
  } : await getActivePrompt({ orgId, agentName });
  const intelligence = buildOrganizationIntelligence({ ...loaded, agentConfig });
  const organisationBriefing = await getOrganizationAgentBriefing({
    orgId, agentName, org: loaded.org, categories: loaded.categories, agentConfig,
  });
  const examples = formatExamples(agentConfig?.examples);
  const feedback = formatFeedback(feedbackContext);
  const runtime = bounded(runtimeContext, 14000);
  const sections = [
    ['BASE IDENTITY', BASE_IDENTITIES[agentName] || 'You are a Spill operational intelligence agent.'],
    ['TASK INSTRUCTIONS', resolved.prompt_template],
    ['ORGANISATION INTELLIGENCE LAYER', organisationBriefing || intelligence || 'No organisation intelligence is available. Use only runtime context.'],
    examples ? ['REVIEWED ORGANISATION EXAMPLES', examples] : null,
    feedback ? ['REVIEWED FEEDBACK', feedback] : null,
  ].filter(Boolean);
  const systemPrompt = sections.map(([title, content]) => `${title}\n${content}`).join('\n\n---\n\n');
  const userPrompt = `RUNTIME CONTEXT\n${runtime}`;
  const finalPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;
  const promptHash = createHash('sha256').update(finalPrompt).digest('hex');
  const composed = {
    agentName, orgId, systemPrompt, userPrompt, finalPrompt, promptHash,
    prompt: { id: resolved.prompt_id, version: Number(resolved.version), scope: resolved.scope, status: resolved.status },
    model: model || agentConfig?.model || null,
    organizationIntelligence: organisationBriefing || intelligence,
    rawOrganizationIntelligence: intelligence,
    timestamp: new Date().toISOString(),
  };
  if (logExecution) await recordPromptExecution(composed);
  return composed;
}

export async function recordPromptExecution(composed) {
  try {
    await (await import('./db.js')).query(
      `INSERT INTO prompt_execution_debug (org_id,agent_name,prompt_id,prompt_version,prompt_hash,model,executed_at,metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [composed.orgId, composed.agentName, composed.prompt.id, composed.prompt.version, composed.promptHash, composed.model, composed.timestamp, JSON.stringify({ scope: composed.prompt.scope, status: composed.prompt.status })]
    );
  } catch (error) {
    console.warn('[prompt-composer] debug log failed:', error.message);
  }
}
