/**
 * Restore UUID defaults broken when ai_observations was rebuilt via CREATE TABLE AS.
 * Usage: node scripts/fix-ai-observations-defaults.mjs
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

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  ssl: /neon\.tech|azure\.com|supabase\.co/i.test(process.env.DATABASE_URL)
    ? { rejectUnauthorized: false }
    : undefined,
});
const c = await pool.connect();

try {
  await c.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  // Core defaults lost after CREATE TABLE AS rebuild
  await c.query(`
    ALTER TABLE ai_observations
      ALTER COLUMN id SET DEFAULT gen_random_uuid(),
      ALTER COLUMN kind SET DEFAULT 'agent',
      ALTER COLUMN created_at SET DEFAULT NOW()
  `);
  await c.query(`
    ALTER TABLE ai_observations
      ALTER COLUMN id SET NOT NULL
  `).catch(() => {});

  // Re-add PK if missing
  await c.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.ai_observations'::regclass AND contype = 'p'
      ) THEN
        ALTER TABLE ai_observations ADD PRIMARY KEY (id);
      END IF;
    END $$
  `);

  // Friendly span_key default when null on legacy rows
  await c.query(`
    UPDATE ai_observations
    SET span_key = 'spill_span_' || replace(id::text, '-', '')
    WHERE span_key IS NULL AND id IS NOT NULL
  `);

  // Indexes recreate
  await c.query('CREATE INDEX IF NOT EXISTS idx_ai_observations_trace ON ai_observations(trace_id, created_at)');
  await c.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_observations_span_key ON ai_observations(span_key)');

  // Same risk on ai_traces if ever rebuilt
  await c.query(`
    ALTER TABLE ai_traces
      ALTER COLUMN id SET DEFAULT gen_random_uuid(),
      ALTER COLUMN created_at SET DEFAULT NOW()
  `).catch((e) => console.log('ai_traces default note:', e.message));

  // Smoke insert/delete
  const { rows: [t] } = await c.query(`
    INSERT INTO ai_traces (org_id, status, decision, quality, decision_evidence, metadata, trace_key)
    SELECT o.id, 'completed', 'test_defaults', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
           'spill_trace_defaults_check'
    FROM organizations o LIMIT 1
    RETURNING id
  `).catch(async (e) => {
    console.log('skip smoke trace (need org):', e.message);
    return { rows: [] };
  });

  if (t?.id) {
    const { rows: [obs] } = await c.query(`
      INSERT INTO ai_observations (trace_id, name, kind, input, output)
      VALUES ($1, 'Defaults Check', 'event', '{}'::jsonb, '{}'::jsonb)
      RETURNING id, span_key
    `, [t.id]);
    console.log('smoke observation id default works:', obs.id);
    await c.query('DELETE FROM ai_traces WHERE id=$1', [t.id]);
  }

  const cols = await c.query(`
    SELECT column_name, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_name='ai_observations' AND column_name IN ('id','kind','created_at')
  `);
  console.log(cols.rows);
  console.log('ai_observations defaults restored.');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
