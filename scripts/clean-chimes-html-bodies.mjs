import pg from 'pg';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { stripHtmlNoise } from '../src/server/relevance-policy.js';

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
  const { rows } = await c.query(`
    SELECT id, body FROM posts
    WHERE org_id=(SELECT id FROM organizations WHERE slug='chimes-aviation-academy')
      AND (body LIKE '%<%' OR body LIKE '%&lt;%')
  `);
  let n = 0;
  for (const r of rows) {
    const cleaned = stripHtmlNoise(r.body);
    if (cleaned !== r.body) {
      await c.query('UPDATE posts SET body=$1 WHERE id=$2', [cleaned, r.id]);
      n++;
    }
  }
  console.log('cleaned html bodies', n);
  const { rows: [icp] } = await c.query(`SELECT left(body,220) body FROM posts WHERE id='4fad0198-369a-43f5-a939-6b69623160ed'`);
  console.log('ICP13 body now:', icp?.body);
} finally {
  c.release();
  await pool.end();
}
