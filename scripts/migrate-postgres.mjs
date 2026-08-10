/**
 * Copy Spill data from Neon (or any source Postgres) → Supabase (or other Postgres).
 *
 * Usage:
 *   SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... node scripts/migrate-postgres.mjs
 *   SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... node scripts/migrate-postgres.mjs --wipe-target
 *
 * Defaults: SOURCE = DATABASE_URL from .env.local; TARGET = SUPABASE_DATABASE_URL.
 *
 * Prefers pg_dump/psql when installed (full fidelity). Falls back to row copy.
 */
import pg from 'pg';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

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

const source = process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL;
const target = process.env.TARGET_DATABASE_URL || process.env.SUPABASE_DATABASE_URL;
const wipe = process.argv.includes('--wipe-target');

if (!source || !target) {
  console.error('Set SOURCE_DATABASE_URL (or DATABASE_URL) and TARGET_DATABASE_URL (or SUPABASE_DATABASE_URL)');
  process.exit(1);
}
if (source === target) {
  console.error('Source and target must differ');
  process.exit(1);
}

function redact(url) {
  return String(url).replace(/:([^:@/]+)@/, ':***@');
}

function qIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

console.log('Source:', redact(source));
console.log('Target:', redact(target));
console.log('Wipe target:', wipe);

const hasPgDump = spawnSync('pg_dump', ['--version'], { encoding: 'utf8' }).status === 0;
const hasPsql = spawnSync('psql', ['--version'], { encoding: 'utf8' }).status === 0;

if (hasPgDump && hasPsql) {
  if (wipe) {
    console.log('Wiping target public schema...');
    const w = spawnSync(
      'psql',
      [target, '-v', 'ON_ERROR_STOP=1', '-c', 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'],
      { encoding: 'utf8' },
    );
    if (w.status !== 0) {
      console.error(w.stderr || w.stdout);
      process.exit(1);
    }
  }
  console.log('Dumping source...');
  const dump = spawnSync(
    'pg_dump',
    [source, '--no-owner', '--no-acl', '--clean', '--if-exists', '--format=plain'],
    { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 },
  );
  if (dump.status !== 0) {
    console.error(dump.stderr || dump.stdout);
    process.exit(1);
  }
  console.log(`Dump size ~${Math.round((dump.stdout?.length || 0) / 1024 / 1024)} MB — restoring...`);
  const restore = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1'], {
    input: dump.stdout,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  if (restore.status !== 0) {
    console.error(restore.stderr || restore.stdout);
    process.exit(1);
  }
  console.log('pg_dump → psql migration complete.');
  process.exit(0);
}

console.log('pg_dump/psql not found — using node row copy (target schema must already exist).');
console.log('Tip: brew install libpq && brew link --force libpq');

const src = new pg.Pool({ connectionString: source, ssl: { rejectUnauthorized: false }, max: 2 });
const dst = new pg.Pool({ connectionString: target, ssl: { rejectUnauthorized: false }, max: 2 });
const sc = await src.connect();
const dc = await dst.connect();

try {
  if (wipe) {
    await dc.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    console.error('Target wiped. Re-run app migrations against TARGET, then re-run this script without --wipe-target.');
    process.exit(1);
  }

  const { rows: tables } = await sc.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);
  console.log('Tables:', tables.map((t) => t.tablename).join(', '));

  try {
    await dc.query('SET session_replication_role = replica');
  } catch {
    /* ignore if not superuser */
  }

  for (const { tablename } of tables) {
    const qname = qIdent(tablename);
    const countSrc = await sc.query(`SELECT count(*)::int AS n FROM ${qname}`);
    const n = countSrc.rows[0].n;
    if (!n) {
      console.log(`  ${tablename}: empty`);
      continue;
    }
    const { rows } = await sc.query(`SELECT * FROM ${qname}`);
    const cols = Object.keys(rows[0]);
    const colList = cols.map(qIdent).join(',');
    const BATCH = 50;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values = [];
      const placeholders = batch.map((row, bi) => {
        const ph = cols.map((_, ci) => `$${bi * cols.length + ci + 1}`);
        for (const c of cols) values.push(row[c]);
        return `(${ph.join(',')})`;
      });
      await dc.query(
        `INSERT INTO ${qname} (${colList}) VALUES ${placeholders.join(',')} ON CONFLICT DO NOTHING`,
        values,
      );
      inserted += batch.length;
    }
    console.log(`  ${tablename}: ${inserted}/${n}`);
  }

  try {
    await dc.query('SET session_replication_role = DEFAULT');
  } catch { /* ignore */ }

  console.log('Node table copy complete.');
} finally {
  sc.release();
  dc.release();
  await src.end();
  await dst.end();
}
