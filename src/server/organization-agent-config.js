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
