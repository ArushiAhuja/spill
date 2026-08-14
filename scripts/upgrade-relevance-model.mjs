#!/usr/bin/env node
/**
 * Bump org relevance agents from gpt-4o-mini → gpt-4o (better homonym judgment).
 * Usage: node scripts/upgrade-relevance-model.mjs [org-slug-or-id]
 */
import { query } from '../src/server/db.js';
import { getOrganizationAgentConfig, saveOrganizationAgentConfig, preferredRelevanceModel } from '../src/server/organization-agent-config.js';

const target = process.argv[2] || null;

async function main() {
  let orgs;
  if (target) {
    const { rows } = await query(
      `SELECT id, name, slug FROM organizations WHERE slug=$1 OR id::text=$1`,
      [target]
    );
    orgs = rows;
  } else {
    const { rows } = await query('SELECT id, name, slug FROM organizations ORDER BY name');
    orgs = rows;
  }

  for (const org of orgs) {
    const config = await getOrganizationAgentConfig(org.id, 'relevance');
    const next = preferredRelevanceModel(config.model);
    if (next === config.model) {
      console.log(`[skip] ${org.slug}: already on ${config.model}`);
      continue;
    }
    await saveOrganizationAgentConfig(
      org.id,
      'relevance',
      { model: next },
      'upgrade-relevance-model-script',
      `Upgraded relevance model ${config.model} → ${next}`
    );
    console.log(`[ok] ${org.slug}: ${config.model} → ${next}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
