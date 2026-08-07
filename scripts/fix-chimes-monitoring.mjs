/**
 * Production ops: ensure Chimes Aviation Academy reddit monitors CadetPilotProgram,
 * and optionally surface a prior ED Times rejection onto the dashboard.
 *
 * Usage:
 *   node scripts/fix-chimes-monitoring.mjs
 *   node scripts/fix-chimes-monitoring.mjs --override-edtimes
 *
 * Uses DATABASE_URL from .env.local or environment. Does not print secrets.
 */

import pg from 'pg';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv(file) {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const m = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[m[1]]) process.env[m[1]] = val;
    }
  } catch { /* optional */ }
}

loadEnv(resolve(__dirname, '../.env.local'));
loadEnv(resolve(__dirname, '../.env.production'));

const CHIMES_ID = '47ab9223-b238-4ff7-a1e4-95bc9769fa13';
const CHIMES_SLUG = 'chimes-aviation-academy';
const WANT_OVERRIDE = process.argv.includes('--override-edtimes');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set — cannot update production config.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

async function ensureCadetSubreddit() {
  const { rows: orgs } = await pool.query(
    `SELECT id, name, slug, website FROM organizations WHERE id = $1 OR slug = $2 LIMIT 1`,
    [CHIMES_ID, CHIMES_SLUG]
  );
  const org = orgs[0];
  if (!org) {
    console.error('Chimes org not found');
    return null;
  }
  console.log(`Org: ${org.name} (${org.slug})`);

  const { rows: configs } = await pool.query(
    `SELECT source, enabled, config FROM source_configs WHERE org_id = $1 AND source = 'reddit'`,
    [org.id]
  );
  if (!configs[0]) {
    console.warn('No reddit source_config for Chimes — inserting defaults');
    const config = {
      queries: [org.name.toLowerCase(), `${org.name.toLowerCase()} review`],
      context_queries: ['cadet pilot', 'CPL training India', 'DGCA pilot training'],
      subreddits: ['aviation', 'flying', 'india', 'IndianAviation', 'pilottraining', 'CadetPilotProgram'],
    };
    await pool.query(
      `INSERT INTO source_configs (org_id, source, enabled, credentials, config)
       VALUES ($1, 'reddit', true, '{}', $2)
       ON CONFLICT (org_id, source) DO UPDATE SET config = EXCLUDED.config, enabled = true`,
      [org.id, JSON.stringify(config)]
    );
    console.log('Inserted reddit config with CadetPilotProgram');
    return org;
  }

  const cfg = configs[0].config || {};
  const subs = Array.isArray(cfg.subreddits) ? [...cfg.subreddits] : [];
  const lower = new Set(subs.map(s => String(s).toLowerCase()));
  if (!lower.has('cadetpilotprogram')) {
    subs.push('CadetPilotProgram');
    cfg.subreddits = subs;
    await pool.query(
      `UPDATE source_configs SET config = $1, updated_at = NOW() WHERE org_id = $2 AND source = 'reddit'`,
      [JSON.stringify(cfg), org.id]
    );
    console.log('Added CadetPilotProgram to reddit subreddits:', subs.join(', '));
  } else {
    console.log('CadetPilotProgram already present:', subs.join(', '));
  }
  return org;
}

async function overrideEdTimes(org) {
  // Prefer importing the application override helper when possible, but this
  // script may run without Next. Fall back to direct post+trace update.
  const { rows: traces } = await pool.query(
    `SELECT id, trace_key, decision, metadata, source, post_id
     FROM ai_traces
     WHERE org_id = $1
       AND (
         metadata::text ILIKE '%ed times%'
         OR metadata::text ILIKE '%edtimes%'
         OR metadata->>'title' ILIKE '%ed times%'
         OR metadata->>'title' ILIKE '%chimes%'
         OR metadata->>'url' ILIKE '%edtimes%'
       )
       AND decision IN ('rejected_irrelevant', 'suppressed_low_quality')
     ORDER BY created_at DESC
     LIMIT 20`,
    [org.id]
  );

  if (!traces.length) {
    console.log('No ED Times rejected traces found to override. Will rely on next refresh with enrichment + brand_query_hit.');
    // Also look for any google_news reject with aviation/ceo without chimes in title
    const { rows: soft } = await pool.query(
      `SELECT id, trace_key, decision, metadata, source
       FROM ai_traces
       WHERE org_id = $1
         AND source IN ('google_news', 'rss', 'bing_news', 'newsapi')
         AND decision = 'rejected_irrelevant'
       ORDER BY created_at DESC
       LIMIT 5`,
      [org.id]
    );
    if (soft.length) {
      console.log(`Found ${soft.length} recent news rejections (latest title: ${(soft[0].metadata?.title || '').slice(0, 80)})`);
    }
    return;
  }

  const target = traces.find(t =>
    /ed\s*times|edtimes/i.test(JSON.stringify(t.metadata || {}))
  ) || traces[0];

  console.log(`Override candidate: ${target.trace_key || target.id} decision=${target.decision}`);
  console.log(`  title: ${(target.metadata?.title || '').slice(0, 120)}`);

  const meta = target.metadata || {};
  const title = meta.title || 'External press coverage — Chimes Aviation Academy';
  const body = meta.body || meta.text || '';
  const url = meta.url || null;
  const author = meta.author || 'ED Times';
  const externalId = meta.external_id || `override-edtimes-${target.id}`;
  const source = target.source || 'google_news';

  if (target.post_id) {
    await pool.query(
      `UPDATE posts SET reviewed = true, manually_escalated = true, escalated = true,
         post_status = COALESCE(NULLIF(post_status,''), 'unread'),
         dismiss_reason = NULL, reasoning = COALESCE(reasoning, '') || ' [operator override: ED Times surface]'
       WHERE id = $1`,
      [target.post_id]
    );
    await pool.query(
      `UPDATE ai_traces SET decision = 'surfaced_override', post_id = $2 WHERE id = $1`,
      [target.id, target.post_id]
    );
    console.log('Updated existing post', target.post_id);
    return;
  }

  const { rows: [post] } = await pool.query(
    `INSERT INTO posts (
       org_id, source, external_id, title, body, author, url,
       raw_engagement, escalation_score, escalated, manually_escalated, reviewed,
       reasoning, post_created_at, ai_trace_id
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,
       0, 55, true, true, true,
       $8, NOW(), $9
     )
     ON CONFLICT (org_id, source, external_id) DO UPDATE SET
       title = EXCLUDED.title,
       body = EXCLUDED.body,
       url = COALESCE(EXCLUDED.url, posts.url),
       escalated = true,
       manually_escalated = true,
       reviewed = true,
       dismiss_reason = NULL,
       ai_trace_id = COALESCE(posts.ai_trace_id, EXCLUDED.ai_trace_id)
     RETURNING id`,
    [
      org.id, source, externalId, String(title).slice(0, 500), String(body).slice(0, 20000),
      author, url,
      'Operator override: force-surface ED Times external coverage of brand/CEO onto dashboard.',
      target.id,
    ]
  );

  await pool.query(
    `UPDATE ai_traces SET decision = 'surfaced_override', post_id = $2,
       decision_evidence = COALESCE(decision_evidence, '{}'::jsonb) || jsonb_build_object(
         'override', jsonb_build_object('reason', 'ED Times brand coverage', 'at', NOW()::text)
       )
     WHERE id = $1`,
    [target.id, post.id]
  );

  console.log(`Surfaced post ${post.id} from trace ${target.id}`);
}

try {
  const org = await ensureCadetSubreddit();
  if (org && WANT_OVERRIDE) {
    await overrideEdTimes(org);
  } else if (org) {
    console.log('Skipping ED Times override (pass --override-edtimes to force-surface).');
  }
  console.log('Done.');
} catch (err) {
  console.error('fix-chimes-monitoring failed:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
