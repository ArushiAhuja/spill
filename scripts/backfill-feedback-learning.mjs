#!/usr/bin/env node
/**
 * Replay historical post_feedback into immediate AI training:
 * reviewed agent examples, evaluation cases, assessments, and intel recompile.
 *
 * Usage:
 *   node scripts/backfill-feedback-learning.mjs
 *   node scripts/backfill-feedback-learning.mjs --env=.env.production
 *   node scripts/backfill-feedback-learning.mjs --org=<uuid>
 *   node scripts/backfill-feedback-learning.mjs --limit=50 --force
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
function flag(name, fallback = null) {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  if (hit === `--${name}`) return true;
  return hit.slice(name.length + 3);
}

const envFile = resolve(__dirname, '..', flag('env', '.env.local') || '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = value;
  }
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const { ensureMigrations } = await import('../src/server/migrate.js');
const { backfillFeedbackLearning } = await import('../src/server/feedback.js');
const { query } = await import('../src/server/db.js');

const orgId = typeof flag('org') === 'string' ? flag('org') : null;
const limitRaw = flag('limit');
const limit = limitRaw && limitRaw !== true ? Number(limitRaw) : null;
const skipLearned = !flag('force');

await ensureMigrations();

const { rows: [counts] } = await query(
  `SELECT
     COUNT(*)::int AS total,
     COUNT(*) FILTER (WHERE label IS NOT NULL)::int AS labelled
   FROM post_feedback
   ${orgId ? 'WHERE org_id = $1' : ''}`,
  orgId ? [orgId] : []
);
console.log(`[backfill] labelled feedback=${counts.labelled}/${counts.total} skip_learned=${skipLearned}`);

const summary = await backfillFeedbackLearning({
  orgId,
  limit: Number.isFinite(limit) ? limit : null,
  skipLearned,
});

console.log('[backfill] done', JSON.stringify(summary, null, 2));
process.exit(summary.failed > 0 ? 2 : 0);
