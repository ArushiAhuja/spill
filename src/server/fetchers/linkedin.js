// LinkedIn crawler — multi-strategy
// Strategy 1: Google News RSS — "{brand} linkedin"         (news mentioning LinkedIn — always works)
// Strategy 2: Google News RSS — site:linkedin.com/pulse    (indexed LinkedIn Pulse articles — always works)
// Strategy 3: Apify harvestapi~linkedin-post-search        (actual post text — needs li_at cookie in credentials)
// Strategy 4: Direct scrape of LinkedIn company page       (best-effort JSON-LD, often gated)
//
// company_handles config is OPTIONAL — enriches Apify and enables direct page scraping.
// Strategies 1 & 2 work with just a brand name query, no auth required.

import { createHash } from 'crypto';
import Parser from 'rss-parser';

const TIMEOUT_MS = 12_000;

const parser = new Parser({
  customFields: { item: [['dc:creator', 'dcCreator']] },
  requestOptions: { timeout: TIMEOUT_MS },
});

function timedFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function makeId(raw) {
  return `linkedin_${createHash('md5').update(String(raw)).digest('hex')}`;
}

function stripHtml(html = '') {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeRssItem(item) {
  const url = item.link || item.guid || '';
  return {
    id: makeId(url || item.title || Math.random()),
    source: 'linkedin',
    author: item.creator || item.dcCreator || item.author || 'LinkedIn',
    title: item.title || '',
    body: stripHtml(item.contentSnippet || item.content || ''),
    url,
    score: 0,
    created_at: item.pubDate ? new Date(item.pubDate) : new Date(),
  };
}

// ── Strategy 3: Apify LinkedIn post search (needs li_at cookie) ──────────────
// harvestapi~linkedin-post-search requires a LinkedIn session cookie to return posts.
// Without li_at, the actor runs and exits with 0 results.
async function fetchViaApify(queries, companyHandles, apiKey, liAt) {
  const searchUrls = queries.slice(0, 3).map(q =>
    `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(q)}&sortBy=date_posted`
  );
  const companyUrls = companyHandles.slice(0, 2).map(h =>
    `https://www.linkedin.com/company/${h}/posts/?feedView=all`
  );
  const allUrls = [...searchUrls, ...companyUrls];
  if (!allUrls.length) return [];

  const input = {
    startUrls: allUrls.map(url => ({ url })),
    maxPosts: 50,
    ...(liAt ? { cookies: [{ name: 'li_at', value: liAt, domain: '.linkedin.com' }] } : {}),
  };

  const endpoint = `https://api.apify.com/v2/acts/harvestapi~linkedin-post-search/run-sync-get-dataset-items?token=${apiKey}&timeout=90&memory=256`;
  const res = await timedFetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Apify LinkedIn ${res.status}`);
  const items = await res.json();
  if (!Array.isArray(items) || !items.length) throw new Error('no items from Apify');

  return items
    .filter(item => item.text || item.content || item.description)
    .map(item => {
      const text = item.text || item.content || item.description || '';
      const url = item.url || item.postUrl || item.linkedInUrl || '';
      return {
        id: makeId(url || text.slice(0, 80)),
        source: 'linkedin',
        author: item.author?.name || item.authorName || item.companyName || 'LinkedIn',
        title: text.slice(0, 160),
        body: text,
        url,
        score: (item.numLikes || item.likesCount || 0) + (item.numComments || item.commentsCount || 0) * 2,
        created_at: item.postedAt ? new Date(item.postedAt) : new Date(),
        follower_count: item.author?.followersCount || item.followersCount || 0,
      };
    });
}

// ── Strategy 2 & 3: Google News RSS ───────────────────────────────────────────
// Two complementary searches per brand query:
//   a) "{brand} linkedin"               — news articles covering the brand's LinkedIn activity
//   b) "{brand}" site:linkedin.com/pulse — LinkedIn Pulse articles Google has indexed
async function fetchViaGoogleNews(queries) {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000; // 48h window (LinkedIn content is slower)
  const results = [];

  const buildRss = (term) =>
    `https://news.google.com/rss/search?q=${encodeURIComponent(term)}&hl=en-US&gl=US&ceid=US:en`;

  for (const q of queries.slice(0, 3)) {
    const searches = [
      { term: `"${q}" linkedin`, label: 'news+linkedin' },
      { term: `"${q}" site:linkedin.com/pulse`, label: 'pulse' },
    ];

    for (const { term, label } of searches) {
      try {
        const feed = await parser.parseURL(buildRss(term));
        let added = 0;
        for (const item of feed.items || []) {
          const ts = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();
          if (ts < cutoff) continue;
          results.push(normalizeRssItem(item));
          added++;
        }
        if (added > 0) console.log(`[linkedin] google news (${label}): ${added} items for "${q}"`);
      } catch (err) {
        console.warn(`[linkedin] google news (${label}) failed for "${q}":`, err.message);
      }
    }
  }
  return results;
}

// ── Strategy 4: Direct public company page scrape ─────────────────────────────
async function fetchViaDirectScrape(companyHandles) {
  const results = [];

  for (const handle of companyHandles.slice(0, 2)) {
    // Try the /about page — more likely to serve HTML before the login wall
    const urls = [
      `https://www.linkedin.com/company/${handle}/`,
      `https://www.linkedin.com/company/${handle}/about/`,
    ];

    for (const pageUrl of urls) {
      try {
        const res = await timedFetch(pageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          redirect: 'follow',
        });
        if (!res.ok) continue;

        const html = await res.text();

        // JSON-LD structured data (LinkedIn sometimes includes this for company pages)
        const jsonLdRe = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
        let match;
        while ((match = jsonLdRe.exec(html)) !== null) {
          try {
            const data = JSON.parse(match[1]);
            const entries = Array.isArray(data) ? data : [data];
            for (const entry of entries) {
              const text = entry.text || entry.description || entry.headline || '';
              if (!text) continue;
              results.push({
                id: makeId(entry.url || entry.identifier || text.slice(0, 60)),
                source: 'linkedin',
                author: entry.author?.name || entry.publisher?.name || handle,
                title: text.slice(0, 160),
                body: text,
                url: entry.url || pageUrl,
                score: 0,
                created_at: entry.datePublished ? new Date(entry.datePublished) : new Date(),
              });
            }
          } catch {}
        }

        if (results.length) {
          console.log(`[linkedin] direct scrape: ${results.length} items from ${handle}`);
          break; // got something, no need to try /about as well
        }
      } catch (err) {
        console.warn(`[linkedin] direct scrape failed for ${handle}:`, err.message);
      }
    }
  }
  return results;
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function fetchLinkedIn({ config = {}, credentials = {} } = {}) {
  const queries = Array.isArray(config.queries) && config.queries.length ? config.queries : [];
  const companyHandles = Array.isArray(config.company_handles) ? config.company_handles.filter(Boolean) : [];

  if (!queries.length && !companyHandles.length) {
    console.log('[linkedin] no queries or company_handles configured, skipping');
    return [];
  }

  const seen = new Set();
  const allPosts = [];

  function addUnique(posts) {
    for (const p of posts) {
      if (!p.id || seen.has(p.id)) continue;
      seen.add(p.id);
      allPosts.push(p);
    }
  }

  // Strategy 1 & 2: Google News RSS (always runs — no auth, real data)
  if (queries.length) {
    const posts = await fetchViaGoogleNews(queries);
    addUnique(posts);
  }

  // Strategy 3: Apify — only if li_at cookie is configured (actors return nothing without it)
  const apifyKey = process.env.APIFY_API_KEY || credentials.apify_api_key;
  const liAt = credentials.li_at;
  if (apifyKey && liAt) {
    try {
      const posts = await fetchViaApify(queries, companyHandles, apifyKey, liAt);
      addUnique(posts);
      console.log(`[linkedin] Apify OK — ${posts.length} posts`);
    } catch (err) {
      console.warn('[linkedin] Apify failed:', err.message);
    }
  }

  // Strategy 4: Direct company page (only if handles configured)
  if (companyHandles.length) {
    const posts = await fetchViaDirectScrape(companyHandles);
    addUnique(posts);
  }

  console.log(`[linkedin] total ${allPosts.length} unique posts`);
  return allPosts;
}

export default fetchLinkedIn;
