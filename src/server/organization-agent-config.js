import { query } from './db.js';

export const AGENT_DEFINITIONS = [
  { agent_name: 'source_understanding', prompt_key: null, name: 'Source Understanding Agent', model: 'deterministic-policy' },
  { agent_name: 'relevance', prompt_key: 'relevance_filter', name: 'Relevance Agent', model: 'gpt-4o-mini' },
  { agent_name: 'category', prompt_key: 'classifier_system', name: 'Category Classification Agent', model: 'gpt-4o-mini' },
  { agent_name: 'severity', prompt_key: 'classifier_scoring', name: 'Severity Agent', model: 'deterministic-policy' },
  { agent_name: 'trend', prompt_key: null, name: 'Trend Detection Agent', model: 'deterministic-cluster-v1' },
  { agent_name: 'response_writer', prompt_key: 'response_writer', name: 'Response Writer Agent', model: 'gpt-4o-mini' },
  { agent_name: 'intelligence_extraction', prompt_key: 'intel_extraction', name: 'Organisation Intelligence Agent', model: 'gpt-4o-mini' },
];

export function agentForPrompt(promptKey) {
  return AGENT_DEFINITIONS.find(agent => agent.prompt_key === promptKey) || null;
}

function defaultConfig(definition) {
  return {
    agent_name: definition.agent_name,
    name: definition.name,
    prompt_key: definition.prompt_key,
    enabled: true,
    model: definition.model,
    priority_instructions: '',
    ignore_instructions: '',
    escalation_rules: {},
    evaluation_criteria: {},
    examples: [],
    version: 0,
    is_default: true,
  };
}

export async function getOrganizationAgentConfigs(orgId) {
  const { rows } = await query('SELECT * FROM organization_agent_configs WHERE org_id=$1', [orgId]);
  const byName = new Map(rows.map(row => [row.agent_name, row]));
  return AGENT_DEFINITIONS.map(definition => {
    const stored = byName.get(definition.agent_name);
    return stored ? { ...defaultConfig(definition), ...stored, name: definition.name, prompt_key: definition.prompt_key, is_default: false } : defaultConfig(definition);
  });
}

export async function getOrganizationAgentConfig(orgId, agentName) {
  const definition = AGENT_DEFINITIONS.find(agent => agent.agent_name === agentName);
  if (!definition) throw new Error(`unknown agent: ${agentName}`);
  const configs = await getOrganizationAgentConfigs(orgId);
  return configs.find(config => config.agent_name === agentName);
}

function normalizeObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function normalizeExamples(value) { return Array.isArray(value) ? value.slice(0, 20) : []; }

export async function saveOrganizationAgentConfig(orgId, agentName, patch, authorEmail = null, changeSummary = null) {
  const definition = AGENT_DEFINITIONS.find(agent => agent.agent_name === agentName);
  if (!definition) throw new Error(`unknown agent: ${agentName}`);
  const current = await getOrganizationAgentConfig(orgId, agentName);
  const next = {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
    model: ['gpt-4o-mini', 'gpt-4o', 'deterministic-policy', 'deterministic-cluster-v1'].includes(patch.model) ? patch.model : current.model,
    priority_instructions: typeof patch.priority_instructions === 'string' ? patch.priority_instructions.trim().slice(0, 8000) : current.priority_instructions,
    ignore_instructions: typeof patch.ignore_instructions === 'string' ? patch.ignore_instructions.trim().slice(0, 8000) : current.ignore_instructions,
    escalation_rules: patch.escalation_rules !== undefined ? normalizeObject(patch.escalation_rules) : current.escalation_rules,
    evaluation_criteria: patch.evaluation_criteria !== undefined ? normalizeObject(patch.evaluation_criteria) : current.evaluation_criteria,
    examples: patch.examples !== undefined ? normalizeExamples(patch.examples) : current.examples,
  };
  const version = Number(current.version || 0) + 1;
  const { rows: [saved] } = await query(
    `INSERT INTO organization_agent_configs (org_id,agent_name,enabled,model,priority_instructions,ignore_instructions,escalation_rules,evaluation_criteria,examples,version,updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (org_id,agent_name) DO UPDATE SET enabled=EXCLUDED.enabled,model=EXCLUDED.model,priority_instructions=EXCLUDED.priority_instructions,ignore_instructions=EXCLUDED.ignore_instructions,escalation_rules=EXCLUDED.escalation_rules,evaluation_criteria=EXCLUDED.evaluation_criteria,examples=EXCLUDED.examples,version=EXCLUDED.version,updated_by=EXCLUDED.updated_by,updated_at=NOW()
     RETURNING *`,
    [orgId, agentName, next.enabled, next.model, next.priority_instructions, next.ignore_instructions, JSON.stringify(next.escalation_rules), JSON.stringify(next.evaluation_criteria), JSON.stringify(next.examples), version, authorEmail]
  );
  await query(
    `INSERT INTO organization_agent_config_versions (org_id,agent_name,version,author_email,change_summary,config)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [orgId, agentName, version, authorEmail, changeSummary || 'agent configuration updated', JSON.stringify(next)]
  );
  return { ...saved, name: definition.name, prompt_key: definition.prompt_key, is_default: false };
}

export async function getOrganizationAgentConfigVersions(orgId, agentName, limit = 20) {
  const { rows } = await query(
    `SELECT id,version,author_email,change_summary,config,created_at FROM organization_agent_config_versions WHERE org_id=$1 AND agent_name=$2 ORDER BY version DESC LIMIT $3`,
    [orgId, agentName, limit]
  );
  return rows;
}

export function buildAgentPolicyContext(config) {
  if (!config) return '';
  const lines = [];
  if (config.priority_instructions?.trim()) lines.push(`Prioritise: ${config.priority_instructions.trim()}`);
  if (config.ignore_instructions?.trim()) lines.push(`Ignore or deprioritise: ${config.ignore_instructions.trim()}`);
  if (Object.keys(config.escalation_rules || {}).length) lines.push(`Organisation escalation rules: ${JSON.stringify(config.escalation_rules)}`);
  if (Object.keys(config.evaluation_criteria || {}).length) lines.push(`Evaluation criteria: ${JSON.stringify(config.evaluation_criteria)}`);
  if (Array.isArray(config.examples) && config.examples.length) lines.push(`Reviewed examples: ${JSON.stringify(config.examples.slice(0, 8))}`);
  return lines.length ? `AGENT-SPECIFIC ORGANISATION POLICY\n${lines.map(line => `- ${line}`).join('\n')}` : '';
}
