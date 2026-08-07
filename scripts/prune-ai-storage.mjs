/**
 * Prune ai_observations / duplicate rejected ai_traces to free Neon storage.
 *
 * Deletes observation rows for rejected/suppressed traces (operators still
 * retain one decision row per external_id via application-level dedupe going
 * forward). Safe: never deletes posts or surfaced traces.
 *
 * Usage: node scripts/prune-ai-storage.mjs
 */

import pg from 'pg';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

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
  } catch { /* optional */ }
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, statement_timeout: 180000 });
const client = await pool.connect();

async function sizeReport(label) {
  const { rows } = await client.query(`
    SELECT relname, pg_size_pretty(pg_total_relation_size(c.oid)) AS size
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 5
  `);
  console.log(label, rows);
}

try {
  await sizeReport('Before:');
  let obsDel = 0;
  for (let i = 0; i < 40; i++) {
    const r = await client.query(`
      DELETE FROM ai_observations WHERE id IN (
        SELECT o.id FROM ai_observations o
        JOIN ai_traces t ON t.id = o.trace_id
        WHERE t.decision IN ('rejected_irrelevant','suppressed_low_quality')
          AND t.post_id IS NULL
        LIMIT 5000
      )
    `);
    obsDel += r.rowCount;
    if (r.rowCount === 0) break;
  }
  console.log('Deleted rejected observations:', obsDel);

  let traceDel = 0;
  for (let i = 0; i < 20; i++) {
    const r = await client.query(`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY org_id, COALESCE(source,''), COALESCE(metadata->>'external_id',''), decision
          ORDER BY created_at DESC
        ) rn
        FROM ai_traces
        WHERE decision IN ('rejected_irrelevant','suppressed_low_quality') AND post_id IS NULL
      )
      DELETE FROM ai_traces WHERE id IN (SELECT id FROM ranked WHERE rn > 1 LIMIT 3000)
    `);
    traceDel += r.rowCount;
    if (r.rowCount === 0) break;
  }
  console.log('Deleted duplicate rejected traces:', traceDel);

  try {
    await client.query('VACUUM ai_observations');
    await client.query('VACUUM ai_traces');
  } catch (e) {
    console.log('VACUUM note (Neon may auto-reclaim):', e.message);
  }

  await sizeReport('After:');
  console.log('Done. If still over 512MB, export/drop prompt_execution_debug or upgrade Neon.');
  console.log('Azure migration is optional and not required when pruning succeeds.');
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
