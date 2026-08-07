import { createHash } from 'crypto';
import Parser from 'rss-parser';

const TIMEOUT_MS = 12_000;
const NEWSAPI_TIMEOUT = 10_000;
const ENRICH_TIMEOUT_MS = 6_000;
const MAX_ENRICH = 25;

const parser = new Parser({
  customFields: { item: [['dc:creator', 'dcCreator'], ['source', 'sourceLabel']] },
  requestOptions: { timeout: TIMEOUT_MS },
});

function stripHtml(html = '') {
  return html.replace(/<[^>]*>/g, '').trim();
}

function makeNormalizer(source, matchedQuery = null, brandQueryHit = false) {
  return function (item) {
    const url = item.link ?? item.guid ?? '';
    const id = createHash('md5').update(url).digest('hex');
    const publisher = item.sourceLabel || item.creator || item.dcCreator || item.author || 'Unknown';
    return {
      id: `${source}_${id}`,
      source,
      author: item.creator ?? item.dcCreator ?? item.author ?? publisher ?? 'Unknown',
      title: item.title ?? '',
      body: stripHtml(item.contentSnippet ?? item.content ?? ''),
      url,
      score: 0,
      created_at: item.pubDate ? new Date(item.pubDate) : new Date(),
      raw: item,
      publisher: typeof publisher === 'string' ? publisher : (publisher?._ || 'Unknown'),
      matched_query: matchedQuery,
      brand_query_hit: brandQueryHit,
      query_brand_positive: brandQueryHit,
    };
  };
}

async function parseFeed(url, source, label, matchedQuery = null, brandQueryHit = false) {
  const feed = await parser.parseURL(url);
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const all = (feed.items ?? []).map(makeNormalizer(source, matchedQuery, brandQueryHit));
  const posts = all.filter(p => p.created_at >= cutoff);
  console.log(`[rss:${label}] OK — ${posts.length}/${all.length} posts (last 24h) brand_hit=${brandQueryHit}`);
  return posts;
}

// Generate Google News RSS URL for a search query
function googleNewsRssUrl(query, lang = 'en', geo = '') {
  const encoded = encodeURIComponent(query);
  const geoParam = geo ? `&geo=${encodeURIComponent(geo)}` : '';
  return `https://news.google.com/rss/search?q=${encoded}&hl=${lang}&gl=US&ceid=US:${lang}${geoParam}`;
}

// Bing News RSS — free, no key required
function bingNewsRssUrl(query) {
  return `https://news.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss`;
}

function extractMeta(html, prop) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']` +
    `|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,
    'i'
  );
  const m = html.match(re);
  return (m?.[1] || m?.[2] || '').trim();
}

function extractTitleTag(html) {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? stripHtml(m[1]).replace(/\s+/g, ' ').trim() : '';
}

/**
 * Google News RSS often truncates/strips the brand from the title and wraps the
 * real publisher URL. Resolve redirects + HTML meta so relevance sees the real
 * headline and canonical host (e.g. ED Times op-ed).
 */
export async function enrichNewsArticle(post) {
  if (!post?.url) return post;
  const isGoogle = /news\.google\.com/i.test(post.url) || post.source === 'google_news';
  const titleLooksThin = !post.title || post.title.length < 40 || / - [A-Z][A-Za-z0-9 .]+$/.test(post.title);
  if (!isGoogle && !titleLooksThin) return post;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENRICH_TIMEOUT_MS);
  try {
    const res = await fetch(post.url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'spill-social-watch/2.0 (+https://getspill.vercel.app)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) return post;
    const finalUrl = res.url || post.url;
    const html = await res.text();
    const ogTitle = extractMeta(html, 'og:title') || extractMeta(html, 'twitter:title') || extractTitleTag(html);
    const ogDesc = extractMeta(html, 'og:description') || extractMeta(html, 'description');
    const siteName = extractMeta(html, 'og:site_name');

    const enriched = { ...post };
    if (finalUrl && finalUrl !== post.url && !/news\.google\.com/i.test(finalUrl)) {
      enriched.canonical_url = finalUrl;
      // Prefer stable id from canonical when we only had a Google wrapper URL,
      // but keep original id for dedupe with prior cycles that used google hash.
      try {
        enriched.publisher_domain = new URL(finalUrl).hostname.replace(/^www\./, '');
      } catch { /* ignore */ }
    }
    if (ogTitle && ogTitle.length > 8) {
      // Keep original title in raw; replace display title when richer.
      if (!post.title || ogTitle.length >= post.title.length - 5 || isGoogle) {
        enriched.title = ogTitle.slice(0, 500);
        enriched.title_enriched = true;
      }
    }
    if (ogDesc && (!post.body || post.body.length < 40 || isGoogle)) {
      enriched.body = (ogDesc || post.body || '').slice(0, 2000);
    }
    if (siteName && (!post.publisher || post.publisher === 'Unknown')) {
      enriched.publisher = siteName;
      if (!post.author || post.author === 'Unknown') enriched.author = siteName;
    }
    return enriched;
  } catch {
    return post;
  } finally {
    clearTimeout(timer);
  }
}

async function enrichPosts(posts) {
  const toEnrich = posts
    .filter(p => p.source === 'google_news' || /news\.google\.com/i.test(p.url || ''))
    .slice(0, MAX_ENRICH);
  if (!toEnrich.length) return posts;

  const enrichedById = new Map();
  // Bound concurrency to 5
  const queue = [...toEnrich];
  const workers = Array.from({ length: Math.min(5, queue.length) }, async () => {
    while (queue.length) {
      const p = queue.shift();
      const e = await enrichNewsArticle(p);
      enrichedById.set(p.id, e);
    }
  });
  await Promise.all(workers);

  return posts.map(p => enrichedById.get(p.id) || p);
}

// NewsAPI.org — requires NEWSAPI_KEY env var; free tier = 100 requests/day
async function fetchNewsApi(queries, apiKey, brandQuerySet) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NEWSAPI_TIMEOUT);

  const results = [];
  const seenUrls = new Set();

  for (const q of queries) {
    try {
      const params = new URLSearchParams({
        q,
        from: cutoff,
        sortBy: 'publishedAt',
        language: 'en',
        pageSize: '20',
        apiKey,
      });
      const res = await fetch(`https://newsapi.org/v2/everything?${params}`, {
        signal: controller.signal,
        headers: { 'User-Agent': 'spill-social-watch/2.0' },
      });
      if (!res.ok) {
        console.warn(`[newsapi] query "${q}" HTTP ${res.status}`);
        continue;
      }
      const json = await res.json();
      const articles = json.articles ?? [];
      const brandHit = brandQuerySet.has(q.toLowerCase());
      for (const a of articles) {
        if (!a.url || seenUrls.has(a.url)) continue;
        seenUrls.add(a.url);
        const id = createHash('md5').update(a.url).digest('hex');
        results.push({
          id: `newsapi_${id}`,
          source: 'newsapi',
          author: a.author ?? a.source?.name ?? 'Unknown',
          title: a.title ?? '',
          body: a.description ?? a.content ?? '',
          url: a.url,
          score: 0,
          created_at: a.publishedAt ? new Date(a.publishedAt) : new Date(),
          raw: a,
          publisher: a.source?.name || 'Unknown',
          matched_query: q,
          brand_query_hit: brandHit,
          query_brand_positive: brandHit,
        });
      }
      console.log(`[newsapi] query "${q}" OK — ${articles.length} articles brand_hit=${brandHit}`);
    } catch (err) {
      console.warn(`[newsapi] query "${q}" failed: ${err.message}`);
    }
  }

  clearTimeout(timer);
  return results;
}

function isBrandQuery(query, brandQueries = []) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return false;
  if (brandQueries.some(b => b && q.includes(String(b).toLowerCase()))) return true;
  // Default: treat the first query (and exact brand-ish phrases) as brand-positive
  return false;
}

// Accept { config } where:
//   config.rss_urls     — manually specified RSS feed URLs
//   config.queries      — generates Google News + Bing RSS per query (auto)
//   config.brand_queries — optional subset of queries that are brand searches
//   config.auto_google_news — bool (default true) — auto-generate Google News RSS from queries
//   config.auto_bing    — bool (default true) — auto-generate Bing News RSS from queries
//   config.newsapi      — bool (default: depends on NEWSAPI_KEY env) — use NewsAPI.org
export async function fetchNews({ config = {} } = {}) {
  const manualUrls = Array.isArray(config.rss_urls) ? config.rss_urls : [];
  const queries = Array.isArray(config.queries) ? config.queries.filter(Boolean) : [];
  const brandQueries = Array.isArray(config.brand_queries) && config.brand_queries.length
    ? config.brand_queries.filter(Boolean)
    : queries.slice(0, Math.max(1, Math.ceil(queries.length / 2))); // first half / first query treated as brand
  const brandQuerySet = new Set(brandQueries.map(q => String(q).toLowerCase()));
  // Also treat google news url ?q= as brand if it overlaps brand queries
  for (const q of queries) {
    // First query is almost always the org name
    if (queries[0] && q === queries[0]) brandQuerySet.add(q.toLowerCase());
  }

  const autoGoogle = config.auto_google_news !== false;
  const autoBing = config.auto_bing !== false;
  const useNewsApi = config.newsapi !== false && !!process.env.NEWSAPI_KEY;

  // Build the full list of RSS feeds to parse
  const feeds = []; // [{ url, source, label, matchedQuery, brandHit }]

  // Manual RSS feeds
  for (const url of manualUrls) {
    let label = url;
    let matchedQuery = null;
    try {
      const u = new URL(url);
      label = u.searchParams.get('q') || u.hostname;
      matchedQuery = u.searchParams.get('q');
    } catch {}
    const brandHit = matchedQuery
      ? isBrandQuery(matchedQuery, brandQueries) || brandQuerySet.has(String(matchedQuery).toLowerCase())
        || (queries[0] && String(matchedQuery).toLowerCase().includes(String(queries[0]).toLowerCase()))
      : false;
    feeds.push({ url, source: 'rss', label, matchedQuery, brandHit });
  }

  // Auto-generated Google News RSS from queries
  if (autoGoogle && queries.length) {
    for (const q of queries) {
      const brandHit = brandQuerySet.has(q.toLowerCase()) || q === queries[0];
      feeds.push({
        url: googleNewsRssUrl(q),
        source: 'google_news',
        label: `google:${q.slice(0, 30)}`,
        matchedQuery: q,
        brandHit,
      });
    }
  }

  // Auto-generated Bing News RSS from queries
  if (autoBing && queries.length) {
    for (const q of queries) {
      const brandHit = brandQuerySet.has(q.toLowerCase()) || q === queries[0];
      feeds.push({
        url: bingNewsRssUrl(q),
        source: 'bing_news',
        label: `bing:${q.slice(0, 30)}`,
        matchedQuery: q,
        brandHit,
      });
    }
  }

  if (!feeds.length && !useNewsApi) {
    console.log('[news] no sources configured, skipping');
    return [];
  }

  const seenIds = new Set();
  const results = [];

  // Parse all RSS feeds
  for (const { url, source, label, matchedQuery, brandHit } of feeds) {
    try {
      const posts = await parseFeed(url, source, label, matchedQuery, !!brandHit);
      for (const post of posts) {
        if (!seenIds.has(post.id)) {
          seenIds.add(post.id);
          // If same url already seen via industry query, prefer brand-hit flag
          results.push(post);
        } else if (brandHit) {
          const existing = results.find(p => p.id === post.id);
          if (existing && !existing.brand_query_hit) {
            existing.brand_query_hit = true;
            existing.query_brand_positive = true;
            existing.matched_query = matchedQuery || existing.matched_query;
          }
        }
      }
    } catch (err) {
      console.warn(`[rss:${label}] FAILED: ${err.message}`);
    }
  }

  // NewsAPI.org
  if (useNewsApi && queries.length) {
    try {
      const apiPosts = await fetchNewsApi(queries, process.env.NEWSAPI_KEY, brandQuerySet);
      for (const post of apiPosts) {
        if (!seenIds.has(post.id)) {
          seenIds.add(post.id);
          results.push(post);
        }
      }
    } catch (err) {
      console.warn(`[newsapi] failed: ${err.message}`);
    }
  }

  const enriched = await enrichPosts(results);
  console.log(`[news] OK — ${enriched.length} total posts (${enriched.filter(p => p.title_enriched).length} titles enriched)`);
  return enriched;
}

export default fetchNews;
