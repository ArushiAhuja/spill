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
  } catch {}
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, ssl: { rejectUnauthorized: false } });
const c = await pool.connect();
try {
  const { rows: [adapt] } = await c.query(`SELECT id, title, left(body,300) body, url FROM posts WHERE id='e780cdc1-b30c-47ea-9689-e37c11a76cad'`);
  console.log('Free ADAPT', adapt);
  if (adapt && !/chimes/i.test(`${adapt.title} ${adapt.body} ${adapt.url || ''}`)) {
    await c.query(`DELETE FROM posts WHERE id=$1`, [adapt.id]);
    await c.query(`UPDATE ai_traces SET decision='rejected_irrelevant', post_id=NULL WHERE id='ad35d890-2c87-44d2-908d-35957b66134b'`);
    console.log('reverted Free ADAPT');
  }

  const { rows: [icp] } = await c.query(`SELECT id, title, left(body,250) body, manually_escalated, escalated, reasoning, notes, saved_at FROM posts WHERE id='4fad0198-369a-43f5-a939-6b69623160ed'`);
  console.log('ICP13', icp);

  // Only clear escalate/highlight on posts that were clearly operator overrides
  const { rows: ov } = await c.query(`
    UPDATE posts p SET
      manually_escalated = false,
      saved_at = NULL,
      notes = CASE WHEN notes ILIKE '%operator override%' OR notes ILIKE 'Override note:%' THEN NULL ELSE notes END,
      reasoning = CASE
        WHEN reasoning ILIKE 'Operator override:%' THEN 'Related to admission process.'
        ELSE reasoning
      END
    WHERE org_id = (SELECT id FROM organizations WHERE slug='chimes-aviation-academy')
      AND (
        notes ILIKE '%operator override%'
        OR notes ILIKE 'Override note:%'
        OR reasoning ILIKE 'Operator override:%'
        OR ai_trace_id IN (SELECT id FROM ai_traces WHERE decision='surfaced_override' AND org_id=p.org_id)
      )
    RETURNING id, title
  `);
  console.log('cleaned true overrides', ov.length);
} finally {
  c.release();
  await pool.end();
}
