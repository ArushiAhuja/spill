/**
 * Rebuild Chimes Relevance Agent priority_instructions from intel keep rules.
 * Usage: node scripts/sync-chimes-relevance-agent.mjs
 */
import pg from 'pg';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildRelevanceAgentPriorityBlock } from '../src/server/relevance-policy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const file of ['../.env.local', '../.env.production']) {
  try {
    for (const line of readFileSync(resolve(__dirname, file), 'utf8').split('\n')) {
      const m = line.trim().match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m || process.env[m[1]]) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  } catch {}
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  ssl: { rejectUnauthorized: false },
});
const c = await pool.connect();
try {
  const { rows: [org] } = await c.query(
    `SELECT id, name, website, intel_profile FROM organizations WHERE slug='chimes-aviation-academy'`
  );
  if (!org) throw new Error('chimes org not found');
  const intel = org.intel_profile || {};
  const priority = buildRelevanceAgentPriorityBlock(org, intel);

  const { rows: [current] } = await c.query(
    `SELECT * FROM organization_agent_configs WHERE org_id=$1 AND agent_name='relevance'`,
    [org.id]
  );
  const version = Number(current?.version || 0) + 1;
  const evaluation = {
    ...(current?.evaluation_criteria || {}),
    case_insensitive_brand_match: true,
    require_explicit_rejection_reason: true,
    always_keep_external_brand_with_context: true,
  };

  await c.query(
    `INSERT INTO organization_agent_configs (org_id,agent_name,enabled,model,priority_instructions,ignore_instructions,escalation_rules,evaluation_criteria,examples,version,updated_by)
     VALUES ($1,'relevance',true,COALESCE($2,'gpt-4o-mini'),$3,COALESCE($4,''),COALESCE($5,'{}'::jsonb),$6::jsonb,COALESCE($7,'[]'::jsonb),$8,'system-sync-relevance')
     ON CONFLICT (org_id,agent_name) DO UPDATE SET
       priority_instructions=EXCLUDED.priority_instructions,
       evaluation_criteria=EXCLUDED.evaluation_criteria,
       version=EXCLUDED.version,
       updated_by=EXCLUDED.updated_by,
       updated_at=NOW()`,
    [
      org.id,
      current?.model || 'gpt-4o-mini',
      priority,
      current?.ignore_instructions || '',
      JSON.stringify(current?.escalation_rules || {}),
      JSON.stringify(evaluation),
      JSON.stringify(current?.examples || []),
      version,
    ]
  );
  await c.query(
    `INSERT INTO organization_agent_config_versions (org_id,agent_name,version,author_email,change_summary,config)
     VALUES ($1,'relevance',$2,'system-sync-relevance',$3,$4::jsonb)`,
    [
      org.id,
      version,
      `Synced relevance agent from ${Array.isArray(intel.learnedKeepRules) ? intel.learnedKeepRules.length : 0} keep rules`,
      JSON.stringify({ priority_instructions: priority, evaluation_criteria: evaluation, examples: current?.examples || [] }),
    ]
  );
  console.log('relevance agent version', version);
  console.log('keep rules', Array.isArray(intel.learnedKeepRules) ? intel.learnedKeepRules.length : 0);
  console.log('priority preview:\n', priority.slice(0, 1500));
} finally {
  c.release();
  await pool.end();
}
