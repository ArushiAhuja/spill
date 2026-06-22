import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { query } from '../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../server/api-auth.js';
import { ensureMigrations } from '../../../../../server/migrate.js';
import { getPrompt } from '../../../../../server/prompts.js';

export const maxDuration = 60;

let _openai = null;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// Industry keyword → relevant subreddits mapping
const INDUSTRY_SUBREDDITS = {
  aviation:    ['aviation', 'flying', 'india', 'IndianAviation', 'pilottraining', 'ATC'],
  food:        ['india', 'bangalore', 'delhi', 'mumbai', 'FoodIndia', 'IndianFood'],
  fintech:     ['india', 'personalfinance', 'IndiaInvestments', 'startups'],
  ecommerce:   ['india', 'IndiaOnlineShopping', 'startups'],
  edtech:      ['india', 'learnprogramming', 'cscareerquestions', 'IITAdmissions'],
  health:      ['india', 'HealthcareIndia', 'medicine'],
  travel:      ['india', 'travel', 'solotravel'],
  startup:     ['startups', 'india', 'entrepreneur', 'SaaS'],
  default:     ['india', 'startups'],
};

function detectIndustry(description = '', name = '') {
  const text = `${name} ${description}`.toLowerCase();
  if (/aviation|aircraft|pilot|flight|airline|airways|airport/.test(text)) return 'aviation';
  if (/food|restaurant|delivery|zomato|swiggy|eat/.test(text)) return 'food';
  if (/fintech|payment|bank|loan|credit|upi|neobank/.test(text)) return 'fintech';
  if (/ecommerce|shop|store|marketplace|retail/.test(text)) return 'ecommerce';
  if (/edtech|education|learning|course|tutor|school|academy/.test(text)) return 'edtech';
  if (/health|medical|doctor|hospital|pharma|wellness/.test(text)) return 'health';
  if (/travel|hotel|holiday|trip|booking/.test(text)) return 'travel';
  return 'default';
}

function buildFallbackConfig(org) {
  const name = org.name || 'company';
  const nameLC = name.toLowerCase();

  const categories = [
    { name: 'negative mentions',   description: `critical or negative posts about ${name}`, severity: 22, color: '#f87171' },
    { name: 'product complaint',   description: 'direct complaints about products or services', severity: 25, color: '#818cf8' },
    { name: 'safety & quality',    description: 'safety, reliability, or quality concerns', severity: 28, color: '#f87171' },
    { name: 'competitor mention',  description: 'comparisons or attacks involving competitors', severity: 14, color: '#818cf8' },
    { name: 'regulatory / legal',  description: 'compliance, legal, or policy-related issues', severity: 20, color: '#60a5fa' },
    { name: 'positive coverage',   description: 'praise, features, or positive community mentions', severity: 5, color: '#4ade80' },
    { name: 'noise',               description: 'low-signal or irrelevant mentions', severity: 0, color: '#334155' },
  ];

  const industry = detectIndustry(org.description, name);
  const subreddits = INDUSTRY_SUBREDDITS[industry] || INDUSTRY_SUBREDDITS.default;

  const sources = {
    reddit:      { queries: [nameLC, `${nameLC} review`, `${nameLC} complaint`], context_queries: [], subreddits },
    hackernews:  { queries: [nameLC, `${nameLC} review`] },
    google_news: { rss_urls: [`https://news.google.com/rss/search?q=${encodeURIComponent(name)}&hl=en-US&gl=US&ceid=US:en`] },
    twitter:     { queries: [`"${nameLC}"`, `#${name.replace(/\s+/g, '')}`] },
    playstore:   { app_ids: [] },
    linkedin:    { queries: [name, `${name} review`], company_handles: [nameLC.replace(/\s+/g, '-')] },
  };

  return { categories, sources };
}

// Fetch and extract readable text from a company website.
// Used to enrich the onboarding AI prompt with real product/service copy.
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
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.slice(0, maxChars);
  } catch {
    return '';
  }
}

// Discover relevant subreddits by searching Reddit with the primary query.
// Returns up to maxResults subreddit names not already in existingList.
async function discoverSubreddits(primaryQuery, existingList = [], maxResults = 4) {
  const existing = new Set(existingList.map(s => s.toLowerCase()));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(primaryQuery)}&sort=new&t=week&limit=100`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'spill-social-watch/1.0 by Certain-Lie2741' },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const json = await res.json();
    const counts = {};
    for (const child of (json?.data?.children ?? [])) {
      const sr = child.data?.subreddit;
      if (sr && !existing.has(sr.toLowerCase())) {
        counts[sr] = (counts[sr] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxResults)
      .map(([sr]) => sr);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// POST /api/orgs/[slug]/onboard
export async function POST(request, { params }) {
  try {
    await ensureMigrations();
    const { slug } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { rows: orgRows } = await query(
      'SELECT id, name, description, competitors, website FROM organizations WHERE id = $1',
      [access.orgId]
    );
    if (!orgRows.length) return NextResponse.json({ error: 'org not found' }, { status: 404 });
    const org = orgRows[0];

    const competitorsList = Array.isArray(org.competitors) ? org.competitors.join(', ') : '';
    let aiSucceeded = false;
    let generatedCategories = [];
    let generatedSources = {};
    let generatedIntelProfile = null;

    // Fetch website content to enrich the AI prompt with real product/service copy
    const websiteText = await fetchWebsiteText(org.website);
    if (websiteText) {
      console.log(`[onboarding] fetched ${websiteText.length} chars from ${org.website}`);
    }

    const intelRules = await getPrompt(access.orgId, 'intel_extraction');

    // Try AI generation
    if (process.env.OPENAI_API_KEY && (org.description || websiteText)) {
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
    {
      "name": "2-3 word name",
      "description": "one sentence describing what this category tracks",
      "severity": 0,
      "color": "#60a5fa"
    }
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
    "playstore": { "app_ids": [] },
    "linkedin": { "queries": ["brand name", "brand review"], "company_handles": ["linkedin-url-slug"] }
  },
  "intel_profile": {
    "brandKeywords": ["exact brand names people use when discussing this company"],
    "productKeywords": ["specific services/products this company offers"],
    "customerPainPoints": ["common complaint vocabulary customers use"],
    "typicalComplaints": ["recurring complaint patterns stated as short phrases, e.g. 'refund not processed', 'booking cancelled last minute'"],
    "operationalRiskQueries": ["searches that would surface operational failures for this type of company"],
    "customerIntentQueries": ["what potential/current customers search when looking for or discussing this company's services"],
    "highRiskTopics": ["industry-specific risk terms — regulatory issues, safety concerns, fraud patterns"],
    "industryVocabulary": ["technical or industry-specific terms this company uses, that would appear in relevant posts"],
    "geographyTerms": ["city/country terms relevant to this company's operations"],
    "exclusionTerms": ["words that when present indicate the post is NOT about this company (e.g. homonyms, unrelated brands with same name)"],
    "icpDescription": "one sentence describing the ideal customer: who they are, what they need, and why they come to this company",
    "brandVoice": "one sentence describing how the company communicates publicly: tone, personality, and approach to customer issues",
    "competitorContext": "one sentence naming the main competitors and how this company is positioned differently"
  }
}

Rules for categories:
- Generate 6-8 categories specific to THIS company's risks (not generic)
- severity: integer 0-30 (30 = most critical)
- color: one of #f87171 #818cf8 #4ade80 #60a5fa #9b8ff7 #38bdf8 #c084fc

Rules for sources.reddit:
- queries: 3-5 brand-specific terms (include brand name)
- context_queries: 5-8 topic/industry queries WITHOUT brand name — what customers discuss online
- subreddits: 4-8 relevant subreddits (no r/ prefix), include "india" for Indian companies

Rules for sources.linkedin:
- queries: 2-4 brand search terms for LinkedIn post search
- company_handles: 1-2 LinkedIn company page slugs (the part after linkedin.com/company/) — use the actual slug from the company's LinkedIn URL

${intelRules}

Be specific to this company's actual industry. Think like an ops lead at this company — what internet conversations would they want to know about?`;

      try {
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
        const parsed = JSON.parse(cleaned);

        if (Array.isArray(parsed.categories) && parsed.categories.length > 0) {
          generatedCategories = parsed.categories;
          generatedSources = parsed.sources || {};
          generatedIntelProfile = parsed.intel_profile || null;
          aiSucceeded = true;
        }
      } catch (err) {
        console.warn('[onboarding] AI failed, using fallback:', err.message);
      }
    }

    // Fallback if AI failed, quota exceeded, or no website/description to work from
    if (!aiSucceeded) {
      const fallback = buildFallbackConfig(org);
      generatedCategories = fallback.categories;
      generatedSources = fallback.sources;
    }

    // Delete existing categories and insert new ones
    await query('DELETE FROM categories WHERE org_id = $1', [access.orgId]);

    const insertedCategories = [];
    for (const cat of generatedCategories) {
      try {
        const { rows } = await query(
          `INSERT INTO categories (org_id, name, description, severity, color)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [access.orgId, cat.name, cat.description || null,
           typeof cat.severity === 'number' ? Math.min(30, Math.max(0, cat.severity)) : 10,
           cat.color || '#60a5fa']
        );
        insertedCategories.push(rows[0]);
      } catch (e) {
        console.error('[onboarding] category insert error:', e.message);
      }
    }

    // Store intel_profile on the organization for use in relevance filtering
    if (generatedIntelProfile && aiSucceeded) {
      await query(
        'UPDATE organizations SET intel_profile = $1 WHERE id = $2',
        [JSON.stringify(generatedIntelProfile), access.orgId]
      ).catch(e => console.warn('[onboarding] intel_profile save failed:', e.message));
    }

    // Embed intel_profile into reddit source config for query expansion during fetch
    if (generatedIntelProfile && generatedSources.reddit) {
      generatedSources.reddit.intel_profile = generatedIntelProfile;
    }

    // Auto-discover relevant subreddits by searching Reddit with the primary query
    if (generatedSources?.reddit) {
      const primaryQuery = generatedSources.reddit.queries?.[0] || org.name;
      const existingSubreddits = generatedSources.reddit.subreddits || [];
      const autoSubreddits = await discoverSubreddits(primaryQuery, existingSubreddits);
      if (autoSubreddits.length > 0) {
        generatedSources.reddit.auto_subreddits = autoSubreddits;
        generatedSources.reddit.custom_threads = generatedSources.reddit.custom_threads || [];
        console.log(`[onboarding] auto-discovered subreddits: ${autoSubreddits.join(', ')}`);
      }
    }

    // Update source configs with generated queries (merge with existing enabled state)
    const insertedSources = [];
    if (generatedSources && typeof generatedSources === 'object') {
      for (const [source, sourceConfig] of Object.entries(generatedSources)) {
        try {
          const { rows } = await query(
            `INSERT INTO source_configs (org_id, source, enabled, credentials, config)
             VALUES ($1, $2, false, '{}', $3)
             ON CONFLICT (org_id, source) DO UPDATE SET
               config = $3,
               updated_at = NOW()
             RETURNING *`,
            [access.orgId, source, JSON.stringify(sourceConfig || {})]
          );
          insertedSources.push(rows[0]);
        } catch (e) {
          console.error(`[onboarding] source upsert error for ${source}:`, e.message);
        }
      }
    }

    // Mark org as onboarded
    await query('UPDATE organizations SET onboarded = true, updated_at = NOW() WHERE id = $1', [access.orgId]);

    // Note: Do NOT call startOrgJob — no persistent scheduler on Vercel.
    // The cron endpoint at /api/cron/refresh handles periodic refreshes.

    return NextResponse.json({
      categories: insertedCategories,
      sources: insertedSources,
      ai_generated: aiSucceeded,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
