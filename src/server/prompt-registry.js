import { query } from './db.js';
import { DEFAULT_PROMPTS } from './prompts.js';

export const AGENT_NAMES = ['source_understanding', 'relevance', 'category', 'severity', 'summary', 'trend', 'response_writer', 'intelligence_extraction'];

export const AGENT_PROMPT_DEFAULTS = {
  source_understanding: 'Use deterministic source-normalisation policy. Preserve source facts, do not invent missing content, and treat exclusions as stronger than fuzzy matches.',
  relevance: DEFAULT_PROMPTS.relevance_filter.content,
  category: DEFAULT_PROMPTS.classifier_system.content,
  severity: DEFAULT_PROMPTS.classifier_scoring.content,
  summary: 'Write a concise operational executive summary using only the supplied signal, category, and scored dimensions. Do not add facts, causes, or commitments not present in the runtime context.',
  trend: 'Use deterministic clustering policy. Cluster only materially similar signals within the supplied organisation and window; do not infer a trend from one unrelated signal.',
  response_writer: DEFAULT_PROMPTS.response_writer.content,
  intelligence_extraction: DEFAULT_PROMPTS.intel_extraction.content,
};

const LEGACY_KEY_TO_AGENT = {
  relevance_filter: 'relevance',
  classifier_system: 'category',
  classifier_scoring: 'severity',
  response_writer: 'response_writer',
  intel_extraction: 'intelligence_extraction',
};

let seeded = false;

function validateAgent(agentName) {
  if (!AGENT_NAMES.includes(agentName)) throw new Error(`unknown prompt agent: ${agentName}`);
}

export async function ensurePromptRegistrySeeded() {
  if (seeded) return;
  for (const agentName of AGENT_NAMES) {
    await query(
      `INSERT INTO prompt_registry (prompt_id,agent_name,scope,organization_id,version,status,prompt_template,created_by,change_summary)
       VALUES ($1,$2,'global',NULL,1,'active',$3,'Spill system','Initial Spill-managed global prompt')
       ON CONFLICT (prompt_id) DO NOTHING`,
      [`global_${agentName}_v1`, agentName, AGENT_PROMPT_DEFAULTS[agentName]]
    );
  }
  seeded = true;
}

export async function getActivePrompt({ orgId, agentName }) {
  validateAgent(agentName);
  await ensurePromptRegistrySeeded();
  const { rows } = await query(
    `SELECT id,prompt_id,agent_name,scope,organization_id,version,status,prompt_template,created_by,change_summary,created_at
     FROM prompt_registry
     WHERE agent_name=$1 AND status='active' AND (scope='global' OR (scope='organization' AND organization_id=$2))
     ORDER BY CASE WHEN scope='organization' THEN 0 ELSE 1 END, version DESC`,
    [agentName, orgId]
  );
  return selectActivePrompt(rows, agentName);
}

export function selectActivePrompt(rows, agentName) {
  const organizationRows = rows.filter(row => row.scope === 'organization');
  const globalRows = rows.filter(row => row.scope === 'global');
  if (organizationRows.length > 1 || globalRows.length > 1) {
    throw new Error(`prompt registry conflict for ${agentName}: expected one active prompt per scope, found organization=${organizationRows.length}, global=${globalRows.length}`);
  }
  if (organizationRows[0]) return organizationRows[0];
  if (globalRows[0]) return globalRows[0];
  throw new Error(`no active prompt for ${agentName}`);
}

export async function createPromptVersion({ agentName, scope = 'organization', organizationId = null, promptTemplate, createdBy = null, changeSummary = 'Prompt version created', status = 'draft' }) {
  validateAgent(agentName);
  if (!['global', 'organization'].includes(scope)) throw new Error('invalid prompt scope');
  if (scope === 'organization' && !organizationId) throw new Error('organizationId required for organization prompt');
  if (!['draft', 'active', 'deprecated'].includes(status)) throw new Error('invalid prompt status');
  const { rows: versionRows } = await query(
    `SELECT COALESCE(MAX(version),0)+1 AS next_version FROM prompt_registry
     WHERE agent_name=$1 AND scope=$2 AND organization_id IS NOT DISTINCT FROM $3`,
    [agentName, scope, scope === 'organization' ? organizationId : null]
  );
  const version = Number(versionRows[0].next_version);
  const promptId = `${scope === 'global' ? 'global' : 'org'}_${agentName}_v${version}_${Date.now().toString(36)}`;
  if (status === 'active') {
    await query(`UPDATE prompt_registry SET status='deprecated',updated_at=NOW() WHERE agent_name=$1 AND scope=$2 AND organization_id IS NOT DISTINCT FROM $3 AND status='active'`, [agentName, scope, scope === 'organization' ? organizationId : null]);
  }
  const { rows } = await query(
    `INSERT INTO prompt_registry (prompt_id,agent_name,scope,organization_id,version,status,prompt_template,created_by,change_summary)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [promptId, agentName, scope, scope === 'organization' ? organizationId : null, version, status, String(promptTemplate || '').trim(), createdBy, String(changeSummary || 'Prompt version created').trim()]
  );
  return rows[0];
}

export async function activatePromptVersion(promptId) {
  const { rows } = await query('SELECT * FROM prompt_registry WHERE prompt_id=$1', [promptId]);
  const prompt = rows[0];
  if (!prompt) throw new Error('prompt version not found');
  await query(`UPDATE prompt_registry SET status='deprecated',updated_at=NOW() WHERE agent_name=$1 AND scope=$2 AND organization_id IS NOT DISTINCT FROM $3 AND status='active'`, [prompt.agent_name, prompt.scope, prompt.organization_id]);
  const { rows: updated } = await query(`UPDATE prompt_registry SET status='active',updated_at=NOW() WHERE prompt_id=$1 RETURNING *`, [promptId]);
  return updated[0];
}

export async function listPromptVersions({ orgId, agentName }) {
  validateAgent(agentName);
  await ensurePromptRegistrySeeded();
  const { rows } = await query(
    `SELECT id,prompt_id,agent_name,scope,organization_id,version,status,prompt_template,created_by,change_summary,created_at,updated_at
     FROM prompt_registry WHERE agent_name=$1 AND (scope='global' OR organization_id=$2)
     ORDER BY scope DESC, version DESC`, [agentName, orgId]
  );
  return rows;
}

export function legacyPromptAgent(promptKey) {
  return LEGACY_KEY_TO_AGENT[promptKey] || null;
}
