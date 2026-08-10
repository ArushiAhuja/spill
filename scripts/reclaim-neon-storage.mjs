/**
 * Aggressive Neon free-space reclaim + Chimes brand keyword enrichment.
 * Usage: node scripts/reclaim-neon-storage.mjs
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

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, statement_timeout: 600000 });
const c = await pool.connect();

try {
  const counts = await c.query(`
    SELECT
      (SELECT count(*)::int FROM ai_observations) AS obs,
      (SELECT count(*)::int FROM ai_traces) AS traces,
      (SELECT count(*)::int FROM ai_observations o JOIN ai_traces t ON t.id=o.trace_id
        WHERE t.decision NOT IN ('surfaced','surfaced_override') AND t.post_id IS NULL) AS drop_obs
  `);
  console.log('counts', counts.rows[0]);

  try {
    await c.query('TRUNCATE TABLE prompt_execution_debug');
    console.log('truncated prompt_execution_debug');
  } catch (e) {
    console.log('ped truncate:', e.message);
  }

  let del = 0;
  for (let i = 0; i < 500; i++) {
    const r = await c.query(`
      DELETE FROM ai_observations WHERE id IN (
        SELECT o.id FROM ai_observations o
        INNER JOIN ai_traces t ON t.id = o.trace_id
        WHERE t.decision NOT IN ('surfaced','surfaced_override')
          AND t.post_id IS NULL
        LIMIT 2000
      )
    `);
    del += r.rowCount;
    if (r.rowCount === 0) break;
    if (i % 25 === 0) console.log('del batch', i, del);
  }
  console.log('deleted reject obs', del);

  let del2 = 0;
  for (let i = 0; i < 200; i++) {
    const r = await c.query(`
      DELETE FROM ai_observations WHERE id IN (
        SELECT o.id FROM ai_observations o
        INNER JOIN ai_traces t ON t.id = o.trace_id
        WHERE t.decision NOT IN ('surfaced','surfaced_override')
          AND o.created_at < NOW() - INTERVAL '3 days'
        LIMIT 2000
      )
    `);
    del2 += r.rowCount;
    if (r.rowCount === 0) break;
  }
  console.log('deleted older non-surfaced obs', del2);

  let tr = 0;
  for (let i = 0; i < 100; i++) {
    const r = await c.query(`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY org_id ORDER BY created_at DESC) rn
        FROM ai_traces
        WHERE decision NOT IN ('surfaced','surfaced_override') AND post_id IS NULL
      )
      DELETE FROM ai_traces WHERE id IN (SELECT id FROM ranked WHERE rn > 50 LIMIT 3000)
    `);
    tr += r.rowCount;
    if (r.rowCount === 0) break;
  }
  console.log('culled reject traces (keep 50/org)', tr);

  const sizeBefore = await c.query(`SELECT pg_database_size(current_database()) AS b`);
  console.log('db bytes before vacuum', sizeBefore.rows[0].b);

  for (const tbl of ['ai_traces', 'ai_observations']) {
    try {
      await c.query(`VACUUM FULL ${tbl}`);
      console.log('VACUUM FULL', tbl, 'ok');
    } catch (e) {
      console.log('VACUUM FULL', tbl, 'failed:', e.message);
    }
  }

  // Table rebuild when dead tuples still fill the 512MB project
  if (Number(sizeBefore.rows[0].b) > 350 * 1024 * 1024) {
    console.log('Attempting observation table rebuild...');
    try {
      await c.query('BEGIN');
      await c.query('DROP TABLE IF EXISTS ai_observations_keep');
      await c.query(`
        CREATE TABLE ai_observations_keep AS
        SELECT o.*
        FROM ai_observations o
        JOIN ai_traces t ON t.id = o.trace_id
        WHERE t.decision IN ('surfaced','surfaced_override')
           OR t.post_id IS NOT NULL
           OR o.created_at > NOW() - INTERVAL '2 days'
      `);
      const kept = await c.query('SELECT count(*)::int AS n FROM ai_observations_keep');
      console.log('keep rows', kept.rows[0].n);
      await c.query('DROP TABLE ai_observations CASCADE');
      await c.query('ALTER TABLE ai_observations_keep RENAME TO ai_observations');
      await c.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_observations_pkey') THEN
            ALTER TABLE ai_observations ADD PRIMARY KEY (id);
          END IF;
        END $$
      `);
      await c.query('CREATE INDEX IF NOT EXISTS ai_observations_trace_id_idx ON ai_observations (trace_id)');
      await c.query('CREATE INDEX IF NOT EXISTS ai_observations_created_at_idx ON ai_observations (created_at)');
      await c.query('COMMIT');
      console.log('rebuilt ai_observations');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      console.log('rebuild failed:', e.message);
    }
  }

  const ch = await c.query(`
    UPDATE organizations
    SET intel_profile = COALESCE(intel_profile, '{}'::jsonb)
      || jsonb_build_object(
        'brandKeywords', (
          SELECT COALESCE(jsonb_agg(to_jsonb(v)), '[]'::jsonb)
          FROM (
            SELECT DISTINCT v FROM (
              SELECT jsonb_array_elements_text(COALESCE(intel_profile->'brandKeywords','[]'::jsonb)) AS v
              UNION ALL SELECT 'CAA'
              UNION ALL SELECT 'ICPP'
              UNION ALL SELECT 'Chimes Aviation'
              -- deliberately omit bare "Chimes" (English homonym); moniker+context handles it
            ) s WHERE v IS NOT NULL AND length(trim(v)) > 0
          ) d
        ),
        'productKeywords', (
          SELECT COALESCE(jsonb_agg(to_jsonb(v)), '[]'::jsonb)
          FROM (
            SELECT DISTINCT v FROM (
              SELECT jsonb_array_elements_text(COALESCE(intel_profile->'productKeywords','[]'::jsonb)) AS v
              UNION ALL SELECT 'ICPP'
              UNION ALL SELECT 'ICPP ADAPT'
              UNION ALL SELECT 'cadet pilot'
              UNION ALL SELECT 'pilot training'
            ) s WHERE v IS NOT NULL AND length(trim(v)) > 0
          ) d
        )
      ),
      updated_at = NOW()
    WHERE slug = 'chimes-aviation-academy'
    RETURNING slug, intel_profile->'brandKeywords' AS bk
  `);
  console.log('chimes enriched', JSON.stringify(ch.rows[0], null, 2));

  await c.query(
    `UPDATE organization_agent_configs c
     SET priority_instructions = $1,
         examples = CASE
           WHEN jsonb_array_length(COALESCE(c.examples,'[]'::jsonb)) >= 6 THEN c.examples
           ELSE $2::jsonb
         END,
         version = c.version + 1,
         updated_at = NOW()
     FROM organizations o
     WHERE o.id = c.org_id AND o.slug = 'chimes-aviation-academy' AND c.agent_name = 'relevance'`,
    [
      'ALWAYS include third-party Reddit/news posts that name Chimes, CAA, ICPP, or admissions/application intent for Chimes Aviation Academy. Title-only "Chimes" with applied/results/admission context is relevant. Only exclude true homonyms (bells/chimes of a clock) with zero aviation/admissions context, or self-published official Chimes pages.',
      JSON.stringify([
        {
          input: { title: 'Chimes', body: "I've applied for Chimes. waiting for results", source: 'reddit' },
          expected: { is_relevant: true },
          note: 'moniker + admission intent on CadetPilot',
        },
        {
          input: { title: 'How to apply for Chimes?', body: 'Need ICPP ADAPT guidance', source: 'reddit' },
          expected: { is_relevant: true },
          note: 'explicit admissions question',
        },
        {
          input: { title: 'The church bell chimes every hour', body: 'travel diary bells', source: 'reddit' },
          expected: { is_relevant: false },
          note: 'English homonym only',
        },
      ]),
    ]
  );
  console.log('relevance agent config updated');

  const sizes = await c.query(`
    SELECT relname, pg_size_pretty(pg_total_relation_size(c.oid)) AS size
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 6
  `);
  console.log('sizes', sizes.rows);
  const db = await c.query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS s`);
  console.log('db', db.rows[0]);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
