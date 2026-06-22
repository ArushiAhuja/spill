import OpenAI from 'openai';
import { query } from './db.js';
import { fetchAll } from './fetchers/index.js';
import { classifyPosts } from './classifier.js';
import { fireEscalations } from './actions/index.js';
import { sendEmail } from './agentmail.js';
import { checkAnomalies } from './detectors/anomaly.js';
import { detectIncidents } from './detectors/incidents.js';
import { ensureMigrations } from './migrate.js';
import { getOrgFeedbackContext, updateOrgIntelligence } from './feedback.js';

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
    intel.icpDescription ? `Target customers: ${intel.icpDescription}` : '',
    intel.productKeywords?.length ? `Products/services: ${intel.productKeywords.slice(0, 6).join(', ')}` : '',
    intel.typicalComplaints?.length ? `Typical complaints: ${intel.typicalComplaints.slice(0, 6).join('; ')}` : '',
    intel.customerPainPoints?.length ? `Customer pain points: ${intel.customerPainPoints.slice(0, 5).join(', ')}` : '',
    intel.highRiskTopics?.length ? `High-risk topics: ${intel.highRiskTopics.slice(0, 4).join(', ')}` : '',
    intel.industryVocabulary?.length ? `Industry terminology: ${intel.industryVocabulary.slice(0, 6).join(', ')}` : '',
    contextQueries.length ? `Industry context terms: ${contextQueries.slice(0, 4).join(' / ')}` : '',
  ].filter(Boolean).join('\n');

  const BATCH = 20;
  const kept = [];

  for (let i = 0; i < posts.length; i += BATCH) {
    const batch = posts.slice(i, i + BATCH);
    const postList = batch.map((p, idx) => {
      let sourceLabel;
      if (p.source === 'reddit') {
        const sr = p.url?.match(/reddit\.com\/r\/([^/?#]+)/i)?.[1] || 'reddit';
        sourceLabel = `r/${sr}`;
      } else {
        sourceLabel = p.source || 'web';
      }
      const text = `${p.title || ''}${p.body ? ': ' + p.body.slice(0, 120) : ''}`.trim();
      return `[${idx}] [${sourceLabel}] — ${text}`;
    }).join('\n');

    try {
      const res = await getOpenAI().chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 80,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: 'You are an operational intelligence filter. Return ONLY a JSON array of relevant 0-based indexes, or an empty array. No explanation. Example: [0,2,5] or []',
          },
          {
            role: 'user',
            content: `Company: ${orgName}
Description: ${orgDescription || orgName}
${operationalContext}
${feedbackContext ? `\nLearned exclusions from past feedback:\n${feedbackContext}\n` : ''}
Posts come from Reddit, Hacker News, Google News, Twitter, and app store reviews. Some matched keyword filters but may not be genuinely about this company. Verify each one actually matters to this company's operations or reputation.

Include a post ONLY if it:
- Directly mentions or is clearly about this company, its products, or its services
- Discusses customer experience (positive or negative) with this company specifically
- Covers operational failures — refunds, service quality, safety, delays, fraud — involving this company
- Reports industry events, regulations, or competitor moves that would concern this company's leadership
- Contains purchasing intent, reviews, or comparisons that involve this company

Exclude if:
- The company name or keyword appears only incidentally or in an unrelated context
- It's about a different company or industry with no connection to this one
- It's generic content that happens to share a keyword but is about something else entirely
- It's from a geography with no operational relevance to this company
- It's personal or lifestyle content with no commercial signal

Posts:
${postList}

Return JSON array of relevant indexes (e.g. [0,2,5]) or [] if none:`,
          },
        ],
      });

      const raw = res.choices[0].message.content.trim();
      const match = raw.match(/\[[\s\S]*?\]/);
      if (match) {
        const idxs = JSON.parse(match[0]);
        if (Array.isArray(idxs)) {
          for (const idx of idxs) {
            if (Number.isInteger(idx) && idx >= 0 && idx < batch.length) {
              kept.push(batch[idx]);
            }
          }
        }
      }
    } catch (err) {
      console.warn('[relevance] AI filter error, dropping tier3 batch:', err.message);
      // Tier 3 posts have no keyword signal — without AI validation there is no safe
      // fallback, so drop them. They will be re-evaluated on the next cycle.
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
      'SELECT name, description, industry_monitoring, industry_keywords, competitors, intel_profile, partner_brands, incident_threshold, plan, sla_first_response_minutes, alert_influencer_threshold, alert_viral_likes FROM organizations WHERE id = $1',
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
      const cfg = sc.config || {};
      // Inject brand as default query so sources work out-of-the-box without user configuration
      const effectiveConfig = (!cfg.queries?.length && brand) ? { ...cfg, queries: [brand] } : cfg;
      orgConfig.sources[sc.source] = { enabled: true, config: effectiveConfig, credentials: sc.credentials };
    }

    const rawPosts = await fetchAll(orgConfig);
    const bySource = rawPosts.reduce((acc, p) => { acc[p.source] = (acc[p.source] || 0) + 1; return acc; }, {});
    console.log(`[org ${orgId}] fetched ${rawPosts.length} raw posts:`, JSON.stringify(bySource));

    // Build set of explicitly configured subreddits + context_queries for AI filter context
    const redditCfg = orgConfig.sources?.reddit?.config || {};
    const configuredSubreddits = new Set([
      ...(redditCfg.subreddits || []),
      ...(redditCfg.auto_subreddits || []),
    ].map(s => s.toLowerCase()));
    const contextQueries = Array.isArray(redditCfg.context_queries) ? redditCfg.context_queries : [];
    const redditQueries = Array.isArray(redditCfg.queries) ? redditCfg.queries.filter(q => q && q.length >= 3) : [];

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
      // User-configured Reddit search queries + context queries (e.g. "MMT booking", "make my trip", "MMT")
      // Use word boundaries to avoid substring false positives ("MMT" matching "commitment")
      const allRedditTerms = [...new Set([...redditQueries, ...contextQueries.filter(q => q && q.length >= 3)])];
      if (allRedditTerms.some(q => new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\b`, 'i').test(text))) return true;
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

    // Tier 3: remaining posts from configured subreddits
    const tier3Candidates = brand
      ? rawPosts.filter(p => {
          if (tier1Ids.has(p.id) || tier2Ids.has(p.id)) return false;
          const sr = postSubreddit(p);
          return sr && configuredSubreddits.has(sr);
        })
      : [];

    // Tier 1 + Tier 2 (keyword matches) always pass through — no AI gate, no LLM classification.
    // Tier 3 (subreddit-only posts with no keyword match) still go through the AI relevance gate.
    const directPosts = [...tier1, ...tier2];
    const tier3Filtered = tier3Candidates.length > 0
      ? await aiRelevanceFilter(tier3Candidates, org.name, org.description, contextQueries, intel, feedbackContext)
      : [];

    console.log(`[org ${orgId}] relevance: direct=${directPosts.length} (t1=${tier1.length} t2=${tier2.length}) tier3_candidates=${tier3Candidates.length} tier3_passed=${tier3Filtered.length}`);

    // Dedupe all candidates together against existing DB posts
    const seen = new Set();
    if (directPosts.length > 0 || tier3Filtered.length > 0) {
      const { rows: existing } = await query(
        `SELECT source || '::' || external_id as key FROM posts WHERE org_id = $1`,
        [orgId]
      );
      existing.forEach(r => seen.add(r.key));
    }

    const newDirect = directPosts.filter(p => !seen.has(`${p.source}::${p.id}`));
    const newTier3 = tier3Filtered.filter(p => !seen.has(`${p.source}::${p.id}`));
    const newPosts = [...newDirect, ...newTier3];

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

    const noCategories = p => ({ ...p, category_id: null, escalation_score: 0, sentiment_intensity: 0, escalation_dimensions: null, reasoning: 'no categories configured', escalated: false, response_template: null, is_relevant: true });

    let classifiedDirect;
    try {
      classifiedDirect = categories.length > 0 && newDirect.length > 0
        ? await classifyPosts(newDirect, categories, feedbackContext, org.name, org.description, intel)
        : newDirect.map(noCategories);
    } catch (err) {
      console.warn('[scheduler] classifyPosts failed for tier1+tier2, storing keyword-matched posts with score 0:', err.message);
      classifiedDirect = newDirect.map(p => ({ ...p, category_id: null, escalation_score: 0, sentiment_intensity: 0, escalation_dimensions: null, reasoning: 'keyword match', escalated: false, response_template: null, is_relevant: true }));
    }

    const classifiedTier3 = categories.length > 0 && newTier3.length > 0
      ? await classifyPosts(newTier3, categories, feedbackContext, org.name, org.description, intel)
      : newTier3.map(noCategories);

    // Drop posts the classifier flagged as not genuinely about this company.
    // Tier 1+2 pass keyword filters but can still mention the brand incidentally.
    const allClassified = [...classifiedDirect, ...classifiedTier3];
    const irrelevant = allClassified.filter(p => p.is_relevant === false);
    if (irrelevant.length > 0) {
      console.log(`[org ${orgId}] filtered ${irrelevant.length} irrelevant posts after classification:`, irrelevant.map(p => p.title?.slice(0, 60)).join(' | '));
    }
    const classified = allClassified.filter(p => p.is_relevant !== false);

    // Store in DB, tracking inserted IDs for incident detection
    const insertedIds = [];
    for (const post of classified) {
      try {
        const { rows: [inserted] } = await query(
          `INSERT INTO posts (org_id, source, external_id, title, body, author, url, raw_engagement, escalation_score, category_id, sentiment_intensity, reasoning, escalated, post_created_at, is_competitor, competitor_name, is_influencer, response_template, location_tag, is_partner, partner_name, follower_count, escalation_dimensions)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
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
            post.escalation_dimensions ? JSON.stringify(post.escalation_dimensions) : null,
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

    // Command-center: auto-create tickets for influencer/viral posts
    const isCommandCenter = ['coordinate', 'command_center', 'enterprise'].includes(org?.plan);
    if (isCommandCenter) {
      const influencerThreshold = org?.alert_influencer_threshold || 10000;
      const viralLikes = org?.alert_viral_likes || 500;
      const slaMinutes = org?.sla_first_response_minutes || 60;

      const alertPosts = classified.filter(p =>
        p.db_id &&
        ((p.source === 'twitter' && (p.follower_count || 0) >= influencerThreshold) ||
         (p.source !== 'twitter' && (p.score || 0) >= viralLikes) ||
         (p.escalation_score || 0) >= 80)
      );

      for (const post of alertPosts) {
        const isInfluencer = (p => (p.source === 'twitter' && (p.follower_count || 0) >= influencerThreshold))(post);
        const isViral = !isInfluencer && (post.score || 0) >= viralLikes;
        const isHighEscalation = (post.escalation_score || 0) >= 80;
        const reason = isInfluencer ? 'influencer post' : isViral ? 'viral post' : 'high escalation';

        try {
          const slaAt = new Date(Date.now() + slaMinutes * 60 * 1000);
          const channel = post.source === 'playstore' ? 'playstore' : post.source === 'twitter' ? 'twitter' : 'manual';

          await query(
            `INSERT INTO tickets (org_id, post_id, source, channel, title, body, author, author_handle, follower_count, url, priority, sla_first_response_at, tags)
             VALUES ($1,$2,'auto',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             ON CONFLICT DO NOTHING`,
            [
              orgId, post.db_id, channel,
              (post.title || 'Untitled post').slice(0, 200),
              post.body?.slice(0, 1000) || null,
              post.author || null, null,
              post.follower_count || 0,
              post.url || null,
              isHighEscalation ? 'urgent' : isInfluencer ? 'high' : 'normal',
              slaAt,
              [reason],
            ]
          );

          // Instant alert email for influencer / viral
          if (isInfluencer || isViral) {
            const { rows: emailRows } = await query(
              `SELECT u.email FROM users u
               JOIN org_members om ON om.user_id = u.id
               WHERE om.org_id = $1 AND om.role IN ('owner','admin')`,
              [orgId]
            );
            if (emailRows.length) {
              const followerDisplay = post.follower_count ? ` (${post.follower_count.toLocaleString()} followers)` : '';
              const scoreDisplay = (post.score || 0) > 0 ? ` · ${post.score} likes/upvotes` : '';
              await sendEmail({
                to: emailRows.map(r => r.email),
                subject: `[${org.name}] ${isInfluencer ? '🔥 Influencer' : '📈 Viral'} post alert`,
                html: `<p><strong>${isInfluencer ? 'High-follower influencer' : 'Rapidly trending post'} detected</strong>${followerDisplay}${scoreDisplay}</p>
<p><strong>Post:</strong> ${post.title || 'Untitled'}</p>
${post.body ? `<p>${post.body.slice(0, 300)}</p>` : ''}
${post.url ? `<p><a href="${post.url}">View post</a></p>` : ''}
<p style="color:#888;font-size:12px">Auto-ticket created in Spill · ${reason}</p>`,
                labels: ['instant-alert', reason.replace(' ', '-')],
              }).catch(e => console.error('[alert email]', e.message));
            }
          }
        } catch (e) {
          console.error('[auto-ticket]', e.message);
        }
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

    // Run intelligence update once per cycle (debounced inside — skips if updated < 2h ago).
    // This replaces per-feedback-submission calls, eliminating redundant LLM calls when
    // users submit multiple pieces of feedback in the same session.
    updateOrgIntelligence(orgId).catch(err =>
      console.warn(`[org ${orgId}] intelligence update error:`, err.message)
    );

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
