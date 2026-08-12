/**
 * Backfill Chimes hard-keep learning + normalize past override posts + surface ICP13 reject.
 * Usage: node scripts/fix-chimes-learning-and-overrides.mjs
 */
import pg from 'pg';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  buildKeepRuleFromPost,
  stripHtmlNoise,
  buildBrandTerms,
  isExternalBrandMention,
} from '../src/server/relevance-policy.js';

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

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  ssl: { rejectUnauthorized: false },
});
const c = await pool.connect();

try {
  const { rows: [org] } = await c.query(
    `SELECT id, name, website, intel_profile FROM organizations WHERE slug='chimes-aviation-academy'`
  );
  if (!org) throw new Error('chimes org not found');
  const intel = { ...(org.intel_profile || {}) };

  // Enrich brand/product keywords for ICP/ADAPT
  const brandKeywords = [...new Set([
    ...(intel.brandKeywords || []),
    'Chimes Aviation',
    'chimes aviation academy',
    'CAA',
    'ICPP',
    'ICP',
  ])];
  const productKeywords = [...new Set([
    ...(intel.productKeywords || []),
    'ICPP',
    'ICP',
    'ADAPT',
    'cadet pilot',
    'pilot training',
  ])];

  // Build keep rules from past should_have_surfaced feedback + override traces
  const { rows: past } = await c.query(
    `SELECT p.title, p.body, p.url, p.source, f.explanation
     FROM post_feedback f
     JOIN posts p ON p.id = f.post_id
     WHERE f.org_id=$1 AND f.label='should_have_surfaced'
     ORDER BY f.created_at DESC LIMIT 25`,
    [org.id]
  );
  const rules = [];
  for (const row of past) {
    rules.push(buildKeepRuleFromPost({
      post: { title: row.title, body: row.body, url: row.url, source: row.source },
      org,
      note: row.explanation || 'backfilled from operator override',
    }));
  }
  // Explicit ICP13 / ADAPT rule
  rules.unshift(buildKeepRuleFromPost({
    post: {
      title: 'Chimes Icp13- Adapt dates',
      body: 'ADAPT assessment dates are from 12–25 August for fresh applicants',
      url: 'https://www.reddit.com/r/indianaviation/comments/1vm7xbb/chimes_icp13_a',
    },
    org,
    note: 'ICP/ADAPT admissions threads naming Chimes',
  }));

  const existing = Array.isArray(intel.learnedKeepRules) ? intel.learnedKeepRules : [];
  const merged = [...rules, ...existing].slice(0, 40);
  const boostTerms = [...new Set([
    ...(intel.boostTerms || []),
    'chimes',
    'icpp',
    'icp',
    'adapt',
    'admission process',
    'chimes aviation academy',
  ])].slice(0, 20);

  await c.query(
    `UPDATE organizations SET intel_profile = COALESCE(intel_profile,'{}'::jsonb) || $1::jsonb, updated_at=NOW() WHERE id=$2`,
    [JSON.stringify({
      brandKeywords,
      productKeywords,
      learnedKeepRules: merged,
      boostTerms,
      feedbackUpdatedAt: new Date().toISOString(),
    }), org.id]
  );
  console.log('keep rules written:', merged.length);

  await c.query(
    `UPDATE organization_agent_configs c
     SET priority_instructions = $1,
         version = c.version + 1,
         updated_at = NOW()
     FROM organizations o
     WHERE o.id = c.org_id AND o.slug='chimes-aviation-academy' AND c.agent_name='relevance'`,
    [`ALWAYS include third-party Reddit/news posts that name Chimes, CAA, ICPP, ICP, ADAPT, or admissions/application intent for Chimes Aviation Academy. Titles like "Chimes Icp13- Adapt dates" are relevant. Only exclude true homonyms (bells/chimes of a clock) with zero aviation/admissions context, or self-published official Chimes pages.`]
  );

  // Normalize existing override posts so they look like normal feed items
  const cleaned = await c.query(
    `UPDATE posts SET
       manually_escalated = false,
       saved_at = NULL,
       reviewed = false,
       notes = CASE
         WHEN notes ILIKE 'Override note:%' OR notes ILIKE 'Surfaced by operator override%' THEN NULL
         ELSE notes
       END,
       reasoning = CASE
         WHEN reasoning ILIKE 'Operator override:%' THEN COALESCE(
           NULLIF(regexp_replace(reasoning, 'Operator override:[^.]*\\.\\s*(Note:[^.]*\\.\\s*)?', '', 'i'), ''),
           'Related to admission process.'
         )
         ELSE reasoning
       END,
       body = regexp_replace(
         regexp_replace(
           regexp_replace(body, '&lt;', '<', 'gi'),
           '&gt;', '>', 'gi'
         ),
         '<[^>]+>', ' ', 'g'
       )
     WHERE org_id=$1
       AND (
         manually_escalated = true
         OR notes ILIKE '%operator override%'
         OR reasoning ILIKE 'Operator override:%'
         OR body ILIKE '%&lt;!-- SC_OFF%'
       )
     RETURNING id, title`,
    [org.id]
  );
  console.log('normalized override posts:', cleaned.rowCount, cleaned.rows.map(r => r.title?.slice(0, 40)));

  // Surface the ICP13 reject if still rejected
  const { rows: rejects } = await c.query(
    `SELECT id, metadata, decision_evidence, quality
     FROM ai_traces
     WHERE org_id=$1 AND decision='rejected_irrelevant'
       AND (metadata->>'title' ILIKE '%Icp13%' OR metadata->>'title' ILIKE '%ADAPT%' OR metadata->>'title' ILIKE '%Chimes ICPP%')
     ORDER BY created_at DESC LIMIT 5`,
    [org.id]
  );
  console.log('open rejects to consider:', rejects.map(r => ({ id: r.id, title: r.metadata?.title })));

  for (const t of rejects) {
    const title = stripHtmlNoise(t.metadata?.title || '');
    const body = stripHtmlNoise(t.metadata?.body || '');
    const url = t.metadata?.url || null;
    const externalId = t.metadata?.external_id || `override-${t.id}`;
    const source = t.metadata?.source || 'reddit';
    const categoryId = t.decision_evidence?.category?.id || null;
    const score = Math.max(Number(t.decision_evidence?.severity?.escalation_score) || 0, 40);

    const { rows: [post] } = await c.query(
      `INSERT INTO posts (
         org_id, source, external_id, title, body, author, url, raw_engagement,
         escalation_score, category_id, sentiment_intensity, reasoning, escalated,
         post_created_at, manually_escalated, reviewed, ai_trace_id, signal_quality
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,
         $9,$10,0,$11,false,
         NOW(), false, false, $12, $13::jsonb
       )
       ON CONFLICT (org_id, source, external_id) DO UPDATE SET
         title = EXCLUDED.title,
         body = EXCLUDED.body,
         manually_escalated = false,
         reviewed = false,
         ai_trace_id = EXCLUDED.ai_trace_id,
         post_status = 'unread'
       RETURNING id`,
      [
        org.id,
        source,
        externalId,
        title,
        body,
        t.metadata?.author || null,
        url,
        Number(t.metadata?.engagement) || 0,
        score,
        categoryId,
        t.decision_evidence?.category?.reasoning || 'Related to admission process.',
        t.id,
        JSON.stringify({ score: 35, relevance: 1, confidence: 0.7, impact: 0.35, novelty: 1 }),
      ]
    );

    await c.query(
      `UPDATE ai_traces SET decision='surfaced_override', post_id=$2,
         decision_evidence = COALESCE(decision_evidence,'{}'::jsonb) || $3::jsonb
       WHERE id=$1`,
      [t.id, post.id, JSON.stringify({
        override: {
          at: new Date().toISOString(),
          by_email: 'system-backfill',
          previous_decision: 'rejected_irrelevant',
          note: 'Auto-surfaced: explicit Chimes + ICP/ADAPT admissions context',
        },
      })]
    );
    console.log('surfaced', title, '→', post.id);
  }

  // Verify policy on ICP13 sample
  const terms = buildBrandTerms(org, { ...intel, brandKeywords, productKeywords });
  const sample = {
    title: 'Chimes Icp13- Adapt dates',
    body: '&lt;!-- SC_OFF --&gt;&lt;div class=&quot;md&quot;&gt;&lt;p&gt;ADAPT assessment dates&lt;/p&gt;',
    url: 'https://www.reddit.com/r/indianaviation/comments/1vm7xbb/chimes_icp13_a',
  };
  console.log('policy check ICP13:', isExternalBrandMention(sample, terms, org, [], { brandKeywords, productKeywords, learnedKeepRules: merged }));
} finally {
  c.release();
  await pool.end();
}
