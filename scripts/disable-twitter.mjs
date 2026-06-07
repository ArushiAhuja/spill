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

const { rowCount } = await pool.query(`
  UPDATE source_configs SET enabled = false, last_fetch_error = 'bearer token expired — needs renewal'
  WHERE source = 'twitter'
`);
console.log(`Disabled ${rowCount} Twitter source configs.`);
console.log('Re-enable after setting a fresh TWITTER_BEARER_TOKEN in Vercel env vars.');

await pool.end();
