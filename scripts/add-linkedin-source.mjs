/**
 * Add LinkedIn source configs for all existing orgs.
 * Uses org name to build sensible default queries + company handle guess.
 * Does NOT enable the source — orgs must opt in from Settings.
 */

import pg from 'pg';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(__dirname, '../.env.local');
for (const line of readFileSync(envFile, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
  if (m) process.env[m[1]] = m[2];
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const { rows: orgs } = await pool.query(
  `SELECT o.id, o.name, o.slug
   FROM organizations o
   WHERE o.onboarded = true
   ORDER BY o.created_at`
);

console.log(`Found ${orgs.length} onboarded orgs\n`);

for (const org of orgs) {
  const nameLC = org.name.toLowerCase();
  const handle = nameLC.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  const linkedinConfig = {
    queries: [org.name, `${org.name} review`, `${nameLC} linkedin`],
    company_handles: [handle],
  };

  const { rowCount } = await pool.query(
    `INSERT INTO source_configs (org_id, source, enabled, credentials, config)
     VALUES ($1, 'linkedin', false, '{}', $2)
     ON CONFLICT (org_id, source) DO NOTHING`,
    [org.id, JSON.stringify(linkedinConfig)]
  );

  console.log(`${org.name} (${org.slug}): ${rowCount > 0 ? 'added linkedin source' : 'already exists, skipped'}`);
}

await pool.end();
console.log('\nDone. LinkedIn source configs created (disabled by default — enable in Settings).');
