import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { query } from '../../../../server/db.js';
import { ensureMigrations } from '../../../../server/migrate.js';

let _openai = null;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

function isAuthorized(request) {
  const incoming = request.headers.get('x-internal-secret') || '';
  const expected = process.env.CRON_SECRET || '';
  return incoming === expected;
}

async function fetchWebsiteText(url, maxChars = 4000) {
  if (!url) return '';
  try {
    const normalized = url.startsWith('http') ? url : `https://${url}`;
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 8000);
    const res = await fetch(normalized, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; spill-monitor/1.0)' },
    });
    if (!res.ok) return '';
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ')
      .replace(/\s+/g, ' ').trim().slice(0, maxChars);
  } catch {
    return '';
  }
}

async function generateWithAI(org, competitorsList) {
  const websiteText = await fetchWebsiteText(org.website);
  if (websiteText) console.log(`[reprocess] fetched ${websiteText.length} chars from ${org.website}`);

  const websiteSection = websiteText
    ? `\nWebsite content (use this to understand exact services, target audience, and terminology):\n"""\n${websiteText}\n"""`
    : '';

  const userMessage = `Company: ${org.name}
Website: ${org.website || 'not provided'}
Description: ${org.description || '(see website content below)'}
Competitors: ${competitorsList || 'none'}${websiteSection}

Generate a JSON response with this EXACT structure (no markdown, no explanation, raw JSON only):
{
  "categories": [
    {"name": "2-3 word name", "description": "one sentence describing what this category tracks", "severity": 0, "color": "#60a5fa"}
  ],
  "sources": {
    "reddit": {
      "queries": ["brand-specific search term"],
      "context_queries": ["topic-based search term without brand name"],
      "subreddits": ["subreddit"]
    },
    "hackernews": { "queries": ["search term"] },
    "google_news": { "rss_urls": ["https://news.google.com/rss/search?q=TERM&hl=en-US&gl=US&ceid=US:en"] },
    "twitter": { "queries": ["@handle OR #brand"] },
    "playstore": { "app_ids": [] }
  },
  "intel_profile": {
    "brandKeywords": ["exact brand names people use when discussing this company"],
    "productKeywords": ["specific services/products this company offers"],
    "customerPainPoints": ["common complaint vocabulary customers use"],
    "operationalRiskQueries": ["searches that would surface operational failures for this type of company"],
    "customerIntentQueries": ["what potential/current customers search when looking for or discussing this company's services"],
    "highRiskTopics": ["industry-specific risk terms — regulatory issues, safety concerns, fraud patterns"],
    "geographyTerms": ["city/country terms relevant to this company"],
    "exclusionTerms": ["words that when present indicate the post is NOT about this company"]
  }
}

Rules for categories: 6-8 specific to THIS company's risks, severity 0-30, color from: #f87171 #818cf8 #4ade80 #60a5fa #9b8ff7 #38bdf8 #c084fc.
Rules for reddit: queries=3-5 brand terms, context_queries=5-8 topic queries WITHOUT brand name, subreddits=4-8 (include "india" for Indian companies).
Rules for intel_profile:
- brandKeywords: 2-5 exact phrases/names (include abbreviations, misspellings)
- productKeywords: 3-8 specific services (e.g. for aviation academy: "cadet pilot program", "CPL training", "ground school India")
- customerPainPoints: 5-10 complaint phrases (e.g. "refund not received", "placement not delivered", "hostel complaint")
- operationalRiskQueries: 5-8 searches for relevant failures (e.g. "aviation academy scam india", "pilot training fraud")
- customerIntentQueries: 5-8 prospect searches (e.g. "best pilot training india cost", "how to become pilot india")
- highRiskTopics: 3-6 regulatory/safety/fraud terms (e.g. "DGCA violation", "license fraud")
- geographyTerms: 2-4 geographic terms (city, country, region)
- exclusionTerms: 1-5 false positive indicators (homonyms etc.)
Think like an ops lead: what internet conversations would matter operationally, reputationally, competitively?`;

  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 3000,
    temperature: 0.3,
    messages: [
      { role: 'system', content: 'You are a monitoring expert. Return ONLY valid JSON with no markdown, no explanation.' },
      { role: 'user', content: userMessage },
    ],
  });

  const text = response.choices[0].message.content.trim();
  const cleaned = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  return JSON.parse(cleaned);
}

// POST /api/internal/reprocess
// Body: { orgId?: uuid, orgSlug?: string, clearPosts?: bool, listOrgs?: bool, intelProfileOverride?: object, sourcesOverride?: object }
// Header: x-internal-secret: CRON_SECRET
export async function POST(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    await ensureMigrations();

    const body = await request.json();
    const { listOrgs = false } = body;

    // Support listing all orgs with post counts
    if (listOrgs) {
      const { rows: allOrgs } = await query(`
        SELECT o.id, o.name, o.slug, o.onboarded,
               COUNT(p.id) as post_count,
               (SELECT rl.status FROM refresh_logs rl WHERE rl.org_id = o.id ORDER BY rl.started_at DESC LIMIT 1) as last_refresh_status
        FROM organizations o
        LEFT JOIN posts p ON p.org_id = o.id
        GROUP BY o.id, o.name, o.slug, o.onboarded
        ORDER BY o.created_at DESC
      `);
      return NextResponse.json({ orgs: allOrgs });
    }

    const { orgId, orgSlug, clearPosts = false, intelProfileOverride = null, sourcesOverride = null } = body;
    // Quick post check mode
    const { checkPosts } = body;
    if (checkPosts) {
      const { rows: posts } = await query(
        `SELECT source, title, escalation_score FROM posts WHERE org_id = $1 ORDER BY post_created_at DESC LIMIT 30`,
        [checkPosts]
      );
      return NextResponse.json({ posts: posts.map(p => ({ source: p.source, title: p.title, score: p.escalation_score })) });
    }

    if (!orgId && !orgSlug) return NextResponse.json({ error: 'orgId or orgSlug required' }, { status: 400 });

    const { rows: orgRows } = await query(
      orgId
        ? 'SELECT id, name, description, competitors, website FROM organizations WHERE id = $1'
        : 'SELECT id, name, description, competitors, website FROM organizations WHERE slug = $1',
      [orgId || orgSlug]
    );
    if (!orgRows.length) return NextResponse.json({ error: 'org not found' }, { status: 404 });
    const org = orgRows[0];
    const actualOrgId = org.id;

    const competitorsList = Array.isArray(org.competitors) ? org.competitors.join(', ') : '';

    let parsed;
    let aiGenerated = false;

    if (intelProfileOverride && sourcesOverride) {
      // Use provided values directly — skip AI
      parsed = { intel_profile: intelProfileOverride, sources: sourcesOverride, categories: [] };
    } else if (process.env.OPENAI_API_KEY && (org.description || org.website)) {
      parsed = await generateWithAI(org, competitorsList);
      aiGenerated = true;
    } else {
      return NextResponse.json({ error: 'No OPENAI_API_KEY or org has no description/website. Provide intelProfileOverride + sourcesOverride.' }, { status: 400 });
    }

    // Save intel_profile
    const intelProfile = parsed.intel_profile || null;
    if (intelProfile) {
      await query('UPDATE organizations SET intel_profile = $1 WHERE id = $2', [JSON.stringify(intelProfile), actualOrgId]);
    }

    // Update categories (only if AI generated them)
    const insertedCategories = [];
    if (Array.isArray(parsed.categories) && parsed.categories.length) {
      await query('DELETE FROM categories WHERE org_id = $1', [actualOrgId]);
      for (const cat of parsed.categories) {
        const { rows } = await query(
          `INSERT INTO categories (org_id, name, description, severity, color) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [actualOrgId, cat.name, cat.description || null,
           typeof cat.severity === 'number' ? Math.min(30, Math.max(0, cat.severity)) : 10,
           cat.color || '#60a5fa']
        );
        insertedCategories.push(rows[0]);
      }
    }

    // Update source configs, embedding intel_profile in reddit config
    const sources = parsed.sources || {};
    if (intelProfile && sources.reddit) sources.reddit.intel_profile = intelProfile;

    const insertedSources = [];
    for (const [source, sourceConfig] of Object.entries(sources)) {
      const { rows } = await query(
        `INSERT INTO source_configs (org_id, source, enabled, credentials, config)
         VALUES ($1, $2, false, '{}', $3)
         ON CONFLICT (org_id, source) DO UPDATE SET config = $3, updated_at = NOW()
         RETURNING *`,
        [actualOrgId, source, JSON.stringify(sourceConfig || {})]
      );
      insertedSources.push(rows[0]);
    }

    // Enable all source configs that were just created/updated
    await query(
      `UPDATE source_configs SET enabled = true WHERE org_id = $1`,
      [actualOrgId]
    );

    // Clear posts if requested
    let clearedCount = 0;
    if (clearPosts) {
      const { rowCount } = await query('DELETE FROM posts WHERE org_id = $1', [actualOrgId]);
      clearedCount = rowCount || 0;
    }

    await query('UPDATE organizations SET onboarded = true, updated_at = NOW() WHERE id = $1', [actualOrgId]);

    return NextResponse.json({
      org: org.name,
      orgId: actualOrgId,
      categories: insertedCategories.length,
      sources: insertedSources.length,
      intel_profile: intelProfile,
      cleared_posts: clearedCount,
      ai_generated: aiGenerated,
    });
  } catch (err) {
    console.error('[reprocess]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
