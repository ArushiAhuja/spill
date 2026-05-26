import OpenAI from 'openai';
import { query } from './db.js';
import { fetchAll } from './fetchers/index.js';
import { classifyPosts } from './classifier.js';
import { fireEscalations } from './actions/index.js';
import { checkAnomalies } from './detectors/anomaly.js';
import { detectIncidents } from './detectors/incidents.js';
import { ensureMigrations } from './migrate.js';
import { getOrgFeedbackContext } from './feedback.js';

let _openai = null;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// AI relevance filter — runs only on posts from configured subreddits that
// didn't match the brand keyword. GPT decides if the post is genuinely about
// this company's industry/niche, using description + context_queries as context.
// Uses strict criteria: when in doubt, exclude.
async function aiRelevanceFilter(posts, orgName, orgDescription, contextQueries = [], intel = {}, feedbackContext = null) {
  if (!posts.length || !process.env.OPENAI_API_KEY) return [];

  const operationalContext = [
    intel.productKeywords?.length ? `Products/services: ${intel.productKeywords.slice(0, 5).join(', ')}` : '',
    intel.customerPainPoints?.length ? `Known customer pain points: ${intel.customerPainPoints.slice(0, 5).join(', ')}` : '',
    intel.highRiskTopics?.length ? `High-risk topics for this company: ${intel.highRiskTopics.slice(0, 4).join(', ')}` : '',
    contextQueries.length ? `Industry context: ${contextQueries.slice(0, 4).join(' / ')}` : '',
  ].filter(Boolean).join('\n');

  const BATCH = 20;
  const kept = [];

  for (let i = 0; i < posts.length; i += BATCH) {
    const batch = posts.slice(i, i + BATCH);
    const postList = batch.map((p, idx) => {
      const sr = p.url?.match(/reddit\.com\/r\/([^/?#]+)/i)?.[1] || '';
      const text = `${p.title || ''}${p.body ? ': ' + p.body.slice(0, 100) : ''}`.trim();
      return `[${idx}] r/${sr} — ${text}`;
    }).join('\n');

    try {
      const res = await getOpenAI().chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 60,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: 'You are an operational intelligence filter for a company monitoring system. Return ONLY a comma-separated list of 0-based indexes, or the word "none". No explanation.',
          },
          {
            role: 'user',
            content: `Company: ${orgName}
Description: ${orgDescription || orgName}
${operationalContext}
${feedbackContext ? `\nLearned exclusions from past feedback:\n${feedbackContext}\n` : ''}
For each post, ask: would this conversation MATTER to this company — operationally, reputationally, competitively, or commercially?

Include a post if it discusses:
- Customer pain, complaints, or frustrations relevant to this company's industry
- Operational failures (refunds, service quality, safety, delays) relevant to this type of company
- Industry events, regulations, or competitor news that would concern this company's leadership
- Purchasing intent, reviews, or comparisons in this company's space

Exclude if:
- It's about a completely different industry
- It's a different country/geography with no connection to this company
- It's generic life/personal content with no commercial/operational relevance
- The overlap is coincidental (same word, different context)

Posts:
${postList}

Relevant indexes (or "none"):`,
          },
        ],
      });

      const text = res.choices[0].message.content.trim().toLowerCase();
      if (text !== 'none') {
        const idxs = text.split(',')
          .map(s => parseInt(s.trim(), 10))
          .filter(n => !isNaN(n) && n >= 0 && n < batch.length);
        for (const idx of idxs) kept.push(batch[idx]);
      }
    } catch (err) {
      console.warn('[relevance] AI filter error, using keyword fallback:', err.message);
      // Keyword fallback: require 2+ significant words from intel profile or context_queries
      const fallbackTerms = [
        ...(intel.productKeywords || []),
        ...(intel.customerPainPoints || []),
        ...(intel.highRiskTopics || []),
        ...contextQueries,
      ];
      if (fallbackTerms.length >= 2) {
        const ctxWords = [...new Set(
          fallbackTerms.flatMap(q => q.toLowerCase().split(/\s+/).filter(w => w.length >= 5))
        )];
        for (const p of batch) {
          const t = `${p.title || ''} ${p.body || ''}`.toLowerCase();
          const hits = ctxWords.filter(w => new RegExp(`\\b${w}\\b`).test(t)).length;
          if (hits >= 2) kept.push(p);
        }
      }
      // If no fallback terms, drop the batch rather than flood the feed
    }
  }

  return kept;
}

const jobs = new Map(); // orgId → intervalId

export async function initScheduler() {
  await ensureMigrations();
  const { rows: orgs } = await query(`
    SELECT DISTINCT o.id, o.slug FROM organizations o
    JOIN source_configs sc ON sc.org_id = o.id AND sc.enabled = true
    WHERE o.onboarded = true
  `);
  for (const org of orgs) {
    startOrgJob(org.id);
  }
  console.log(`scheduler: started ${orgs.length} org jobs`);
}

export function startOrgJob(orgId, intervalMinutes = null) {
  if (jobs.has(orgId)) return;
  const interval = (intervalMinutes || parseInt(process.env.REFRESH_INTERVAL_MINUTES) || 5) * 60 * 1000;
  runOrgCycle(orgId).catch(err => console.error(`cycle error org ${orgId}:`, err.message));
  const id = setInterval(() => {
    runOrgCycle(orgId).catch(err => console.error(`cycle error org ${orgId}:`, err.message));
  }, interval);
  jobs.set(orgId, id);
}

export function stopOrgJob(orgId) {
  const id = jobs.get(orgId);
  if (id) {
    clearInterval(id);
    jobs.delete(orgId);
  }
}

export async function refreshOrg(orgId) {
  await ensureMigrations();
  return runOrgCycle(orgId);
}

export async function runAllOrgs() {
  await ensureMigrations();
  const { rows: orgs } = await query(`
    SELECT DISTINCT o.id FROM organizations o
    JOIN source_configs sc ON sc.org_id = o.id AND sc.enabled = true
    WHERE o.onboarded = true
  `);
  await Promise.allSettled(orgs.map(o => runOrgCycle(o.id)));
}

const SKIP_PREFIXES = new Set([
  'the', 'a', 'an', 'my', 'our', 'for', 'and', 'by', 'of', 'in', 'at',
  'india', 'indian', 'pvt', 'ltd', 'inc', 'llc', 'co', 'corp',
]);

// Returns a 1-2 word brand phrase. For "Chimes Aviation" → "chimes aviation",
// preventing single common words like "chimes" (a verb) from causing false positives.
function brandKeyword(orgName) {
  const words = (orgName || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  const significant = words.filter(w => w.length >= 4 && !SKIP_PREFIXES.has(w));
  if (significant.length >= 2) return significant.slice(0, 2).join(' ');
  if (significant.length === 1) return significant[0];
  // Fallback: longest word regardless of skip list
  return words.sort((a, b) => b.length - a.length)[0] || null;
}

const INFLUENCER_THRESHOLD = 500;

function detectInfluencer(post) {
  if (post.source === 'twitter') return (post.follower_count || 0) >= 10000
  if (post.source === 'hackernews') return (post.score || 0) > 100
  return (post.score || 0) > 500
}

function detectCompetitor(text, competitors) {
  if (!competitors?.length) return null;
  const lower = text.toLowerCase();
  for (const c of competitors) {
    const keyword = c.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    if (keyword && lower.includes(keyword)) return c;
  }
  return null;
}

export async function runOrgCycle(orgId) {
  let logId;
  try {
    const { rows: [log] } = await query(
      'INSERT INTO refresh_logs (org_id) VALUES ($1) RETURNING id',
      [orgId]
    );
    logId = log.id;

    const { rows: [org] } = await query(
      'SELECT name, description, industry_monitoring, industry_keywords, competitors, intel_profile, partner_brands, incident_threshold FROM organizations WHERE id = $1',
      [orgId]
    );
    const brand = brandKeyword(org?.name);
    const industryOn = !!org?.industry_monitoring;
    const industryKws = (org?.industry_keywords || []).map(k => k.toLowerCase()).filter(Boolean);
    const competitors = (org?.competitors || []).filter(Boolean);
    const partnerBrands = (org?.partner_brands || []).filter(Boolean)
    const incidentThreshold = org?.incident_threshold || 5

    const intel = org?.intel_profile || {};
    const feedbackContext = await getOrgFeedbackContext(orgId).catch(() => null);
    const intelBrandKws = (intel.brandKeywords || []).map(k => k.toLowerCase());
    const intelProductKws = (intel.productKeywords || []).map(k => k.toLowerCase());
    const intelPainKws = (intel.customerPainPoints || []).map(k => k.toLowerCase());
    const intelRiskKws = (intel.operationalRiskQueries || []).concat(intel.highRiskTopics || []).map(k => k.toLowerCase());
    const intelGeoTerms = (intel.geographyTerms || []).map(k => k.toLowerCase());
    const intelExclusionTerms = (intel.exclusionTerms || []).map(k => k.toLowerCase());

    const { rows: sourceConfigs } = await query(
      'SELECT source, enabled, credentials, config FROM source_configs WHERE org_id = $1 AND enabled = true',
      [orgId]
    );

    if (!sourceConfigs.length) {
      await query('UPDATE refresh_logs SET status=$1, completed_at=NOW() WHERE id=$2', ['completed', logId]);
      return;
    }

    const { rows: categories } = await query(
      'SELECT id, name, description, severity, color FROM categories WHERE org_id = $1',
      [orgId]
    );

    const orgConfig = { orgId, sources: {} };
    for (const sc of sourceConfigs) {
      orgConfig.sources[sc.source] = { enabled: true, config: sc.config, credentials: sc.credentials };
    }

    const rawPosts = await fetchAll(orgConfig);

    // Build set of explicitly configured subreddits + context_queries for AI filter context
    const redditCfg = orgConfig.sources?.reddit?.config || {};
    const configuredSubreddits = new Set([
      ...(redditCfg.subreddits || []),
      ...(redditCfg.auto_subreddits || []),
    ].map(s => s.toLowerCase()));
    const contextQueries = Array.isArray(redditCfg.context_queries) ? redditCfg.context_queries : [];

    function postSubreddit(p) {
      const m = p.url?.match(/reddit\.com\/r\/([^/?#]+)/i);
      return m ? m[1].toLowerCase() : null;
    }

    // Brand phrase check using word boundaries — "chimes aviation" won't match "a watch that chimes"
    function containsBrand(text) {
      if (!brand) return false;
      return new RegExp(`\\b${brand.replace(/\s+/g, '\\s+')}\\b`, 'i').test(text);
    }

    // Three-tier relevance system:
    // Tier 1 — Direct brand/product match: brand keyword, intel brand keywords, competitors → always include
    // Tier 2 — Operational risk match: product/pain/risk keywords from intel profile → include if from configured subreddit OR has geography match
    // Tier 3 — Configured subreddit posts without keyword match → AI operational relevance filter

    function containsExclusion(text) {
      if (!intelExclusionTerms.length) return false;
      const lower = text.toLowerCase();
      return intelExclusionTerms.some(ex => lower.includes(ex));
    }

    function tier1Match(p) {
      const text = `${p.title || ''} ${p.body || ''}`;
      if (containsExclusion(text)) return false;
      // Brand phrase match
      if (containsBrand(text)) return true;
      // Intel brand keywords
      const lower = text.toLowerCase();
      if (intelBrandKws.some(kw => kw.length >= 4 && new RegExp(`\\b${kw.replace(/\s+/g, '\\s+')}\\b`, 'i').test(text))) return true;
      // Competitor match
      if (competitors.length && detectCompetitor(lower, competitors)) return true;
      // Industry monitoring keywords
      if (industryOn && industryKws.length > 0 && industryKws.some(kw => lower.includes(kw))) return true;
      return false;
    }

    function tier2Match(p) {
      const text = `${p.title || ''} ${p.body || ''}`;
      if (containsExclusion(text)) return false;
      const lower = text.toLowerCase();

      // Must match at least one product/pain/risk keyword
      const allOperationalKws = [...intelProductKws, ...intelPainKws, ...intelRiskKws];
      if (!allOperationalKws.length) return false;
      const hasOperational = allOperationalKws.some(kw => kw.length >= 4 && lower.includes(kw));
      if (!hasOperational) return false;

      // Must also have geography match OR come from a configured subreddit
      const sr = postSubreddit(p);
      const inConfiguredSubreddit = sr && configuredSubreddits.has(sr);
      const hasGeo = intelGeoTerms.length === 0 || intelGeoTerms.some(g => lower.includes(g));

      return inConfiguredSubreddit || hasGeo;
    }

    const tier1 = rawPosts.filter(p => tier1Match(p));
    const tier1Ids = new Set(tier1.map(p => p.id));

    const tier2 = rawPosts.filter(p => {
      if (tier1Ids.has(p.id)) return false;
      return tier2Match(p);
    });
    const tier2Ids = new Set(tier2.map(p => p.id));

    // Tier 3: posts from configured subreddits that passed neither tier1 nor tier2 → AI filter
    const tier3Candidates = brand
      ? rawPosts.filter(p => {
          if (tier1Ids.has(p.id) || tier2Ids.has(p.id)) return false;
          const sr = postSubreddit(p);
          return sr && configuredSubreddits.has(sr);
        })
      : [];

    const tier3 = tier3Candidates.length > 0
      ? await aiRelevanceFilter(tier3Candidates, org.name, org.description, contextQueries, intel, feedbackContext)
      : [];

    const brandFiltered = [...tier1, ...tier2, ...tier3];

    if (rawPosts.length !== brandFiltered.length) {
      console.log(`[org ${orgId}] relevance: t1=${tier1.length} t2=${tier2.length} t3=${tier3.length} dropped=${rawPosts.length - brandFiltered.length}`);
    }

    // Dedupe
    const seen = new Set();
    if (brandFiltered.length > 0) {
      const { rows: existing } = await query(
        `SELECT source || '::' || external_id as key FROM posts WHERE org_id = $1`,
        [orgId]
      );
      existing.forEach(r => seen.add(r.key));
    }

    const newPosts = brandFiltered.filter(p => !seen.has(`${p.source}::${p.id}`));

    if (!newPosts.length) {
      await query(
        'UPDATE refresh_logs SET status=$1, completed_at=NOW(), posts_fetched=0 WHERE id=$2',
        ['completed', logId]
      );
      await query(
        `UPDATE source_configs SET last_fetch_at = NOW(), last_fetch_error = NULL WHERE org_id = $1 AND enabled = true`,
        [orgId]
      ).catch(() => {});
      return;
    }

    // Annotate competitor + influencer flags before classification
    for (const post of newPosts) {
      const text = `${post.title || ''} ${post.body || ''}`.toLowerCase();
      const matchedCompetitor = detectCompetitor(text, competitors);
      post.is_competitor = !!matchedCompetitor;
      post.competitor_name = matchedCompetitor || null;
      post.is_influencer = detectInfluencer(post);
      const matchedPartner = detectCompetitor(text, partnerBrands)
      post.is_partner = !!matchedPartner
      post.partner_name = matchedPartner || null
    }

    // Classify — pass feedbackContext so classifier learns from user corrections
    const classified = categories.length > 0
      ? await classifyPosts(newPosts, categories, feedbackContext)
      : newPosts.map(p => ({ ...p, category_id: null, escalation_score: 0, sentiment_intensity: 0, reasoning: 'no categories configured', escalated: false, response_template: null }));

    // Store in DB, tracking inserted IDs for incident detection
    const insertedIds = [];
    for (const post of classified) {
      try {
        const { rows: [inserted] } = await query(
          `INSERT INTO posts (org_id, source, external_id, title, body, author, url, raw_engagement, escalation_score, category_id, sentiment_intensity, reasoning, escalated, post_created_at, is_competitor, competitor_name, is_influencer, response_template, location_tag, is_partner, partner_name, follower_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
           ON CONFLICT (org_id, source, external_id) DO NOTHING
           RETURNING id`,
          [
            orgId, post.source, post.id, post.title, post.body, post.author, post.url,
            post.score || 0, post.escalation_score || 0, post.category_id || null,
            post.sentiment_intensity || 0, post.reasoning || null,
            post.escalated || false, post.created_at || new Date(),
            post.is_competitor || false, post.competitor_name || null,
            post.is_influencer || false, post.response_template || null,
            post.location_tag || null, post.is_partner || false,
            post.partner_name || null, post.follower_count || null,
          ]
        );
        // Attach DB id to post for downstream use
        if (inserted) {
          post.db_id = inserted.id;
          insertedIds.push(inserted.id);
        } else {
          insertedIds.push(null);
        }
      } catch (e) {
        console.error('post insert error:', e.message);
        insertedIds.push(null);
      }
    }

    const escalated = classified.filter(p => p.escalated);

    if (escalated.length > 0) {
      const { rows: rules } = await query(
        'SELECT * FROM escalation_rules WHERE org_id = $1 AND enabled = true',
        [orgId]
      );
      if (rules.length > 0) {
        await fireEscalations(escalated, { orgId, rules, categories });
      }
    }

    // Post-cycle detectors
    await checkAnomalies(orgId, newPosts.length).catch(err =>
      console.error('[anomaly] error:', err.message)
    );
    await detectIncidents(orgId, classified, insertedIds, incidentThreshold).catch(err =>
      console.error('[incidents] error:', err.message)
    );

    await query(
      'UPDATE refresh_logs SET status=$1, completed_at=NOW(), posts_fetched=$2, posts_escalated=$3 WHERE id=$4',
      ['completed', newPosts.length, escalated.length, logId]
    );

    await query(
      `UPDATE source_configs SET last_fetch_at = NOW(), last_fetch_error = NULL WHERE org_id = $1 AND enabled = true`,
      [orgId]
    ).catch(() => {})

    console.log(`[org ${orgId}] cycle done: ${newPosts.length} new, ${escalated.length} escalated`);
  } catch (err) {
    console.error(`[org ${orgId}] cycle failed:`, err.message);
    if (logId) {
      await query(
        'UPDATE refresh_logs SET status=$1, completed_at=NOW(), error=$2 WHERE id=$3',
        ['failed', err.message, logId]
      ).catch(() => {});
    }
    await query(
      `UPDATE source_configs SET last_fetch_at = NOW(), last_fetch_error = $1 WHERE org_id = $2 AND enabled = true`,
      [err.message.slice(0, 200), orgId]
    ).catch(() => {})
  }
}
