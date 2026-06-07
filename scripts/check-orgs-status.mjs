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

// All orgs
const { rows: orgs } = await pool.query(`
  SELECT o.id, o.name, o.slug, o.onboarded, o.plan,
         COUNT(DISTINCT sc.source) FILTER (WHERE sc.enabled) as enabled_sources,
         COUNT(DISTINCT sc.source) as total_sources,
         MAX(rl.completed_at) as last_refresh,
         COUNT(DISTINCT p.id) as total_posts,
         COUNT(DISTINCT p.id) FILTER (WHERE p.created_at > NOW() - INTERVAL '24 hours') as posts_24h
  FROM organizations o
  LEFT JOIN source_configs sc ON sc.org_id = o.id
  LEFT JOIN refresh_logs rl ON rl.org_id = o.id AND rl.status = 'completed'
  LEFT JOIN posts p ON p.org_id = o.id
  GROUP BY o.id
  ORDER BY o.created_at
`);

console.log('\n=== ALL ORGS ===');
for (const org of orgs) {
  console.log(`\n[${org.name}] slug=${org.slug} plan=${org.plan || 'monitor'}`);
  console.log(`  onboarded=${org.onboarded} | sources: ${org.enabled_sources}/${org.total_sources} enabled`);
  console.log(`  posts: ${org.total_posts} total, ${org.posts_24h} in last 24h`);
  console.log(`  last refresh: ${org.last_refresh ? new Date(org.last_refresh).toISOString() : 'never'}`);
}

// Source config details per org
const { rows: sources } = await pool.query(`
  SELECT o.name as org_name, o.slug, sc.source, sc.enabled,
         sc.last_fetch_at, sc.last_fetch_error,
         sc.config
  FROM source_configs sc
  JOIN organizations o ON o.id = sc.org_id
  ORDER BY o.name, sc.source
`);

console.log('\n\n=== SOURCE CONFIGS ===');
let lastOrg = null;
for (const s of sources) {
  if (s.org_name !== lastOrg) {
    console.log(`\n[${s.org_name}]`);
    lastOrg = s.org_name;
  }
  const cfg = s.config || {};
  const summary = s.source === 'reddit'
    ? `queries=${JSON.stringify(cfg.queries || []).slice(0,80)} subreddits=${JSON.stringify(cfg.subreddits || []).slice(0,60)}`
    : s.source === 'google_news'
    ? `queries=${JSON.stringify(cfg.queries || []).slice(0,80)}`
    : s.source === 'twitter'
    ? `queries=${JSON.stringify(cfg.queries || []).slice(0,80)}`
    : s.source === 'playstore'
    ? `appId=${cfg.app_id || 'none'}`
    : JSON.stringify(cfg).slice(0, 80);

  const lastFetch = s.last_fetch_at ? `fetched ${Math.round((Date.now() - new Date(s.last_fetch_at)) / 60000)}m ago` : 'never fetched';
  const errFlag = s.last_fetch_error ? ` ⚠ ERROR: ${s.last_fetch_error.slice(0, 80)}` : '';
  console.log(`  ${s.enabled ? '✓' : '✗'} ${s.source.padEnd(12)} | ${lastFetch}${errFlag}`);
  if (s.enabled) console.log(`    ${summary}`);
}

await pool.end();
