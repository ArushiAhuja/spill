import { createHash } from 'crypto';
import Parser from 'rss-parser';

const TIMEOUT_MS = 12_000;
const NEWSAPI_TIMEOUT = 10_000;

const parser = new Parser({
  customFields: { item: [['dc:creator', 'dcCreator']] },
  requestOptions: { timeout: TIMEOUT_MS },
});

function stripHtml(html = '') {
  return html.replace(/<[^>]*>/g, '').trim();
}

function makeNormalizer(source) {
  return function (item) {
    const url = item.link ?? item.guid ?? '';
    const id = createHash('md5').update(url).digest('hex');
    return {
      id: `${source}_${id}`,
      source,
      author: item.creator ?? item.dcCreator ?? item.author ?? 'Unknown',
      title: item.title ?? '',
      body: stripHtml(item.contentSnippet ?? item.content ?? ''),
      url,
      score: 0,
      created_at: item.pubDate ? new Date(item.pubDate) : new Date(),
      raw: item,
    };
  };
}

async function parseFeed(url, source, label) {
  const feed = await parser.parseURL(url);
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const all = (feed.items ?? []).map(makeNormalizer(source));
  const posts = all.filter(p => p.created_at >= cutoff);
  console.log(`[rss:${label}] OK — ${posts.length}/${all.length} posts (last 24h)`);
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

// NewsAPI.org — requires NEWSAPI_KEY env var; free tier = 100 requests/day
async function fetchNewsApi(queries, apiKey) {
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
        });
      }
      console.log(`[newsapi] query "${q}" OK — ${articles.length} articles`);
    } catch (err) {
      console.warn(`[newsapi] query "${q}" failed: ${err.message}`);
    }
  }

  clearTimeout(timer);
  return results;
}

// Accept { config } where:
//   config.rss_urls     — manually specified RSS feed URLs
//   config.queries      — generates Google News + Bing RSS per query (auto)
//   config.auto_google_news — bool (default true) — auto-generate Google News RSS from queries
//   config.auto_bing    — bool (default true) — auto-generate Bing News RSS from queries
//   config.newsapi      — bool (default: depends on NEWSAPI_KEY env) — use NewsAPI.org
export async function fetchNews({ config = {} } = {}) {
  const manualUrls = Array.isArray(config.rss_urls) ? config.rss_urls : [];
  const queries = Array.isArray(config.queries) ? config.queries.filter(Boolean) : [];
  const autoGoogle = config.auto_google_news !== false;
  const autoBing = config.auto_bing !== false;
  const useNewsApi = config.newsapi !== false && !!process.env.NEWSAPI_KEY;

  // Build the full list of RSS feeds to parse
  const feeds = []; // [{ url, source, label }]

  // Manual RSS feeds
  for (const url of manualUrls) {
    let label = url;
    try { label = new URL(url).searchParams.get('q') || new URL(url).hostname; } catch {}
    feeds.push({ url, source: 'rss', label });
  }

  // Auto-generated Google News RSS from queries
  if (autoGoogle && queries.length) {
    for (const q of queries) {
      feeds.push({
        url: googleNewsRssUrl(q),
        source: 'google_news',
        label: `google:${q.slice(0, 30)}`,
      });
    }
  }

  // Auto-generated Bing News RSS from queries
  if (autoBing && queries.length) {
    for (const q of queries) {
      feeds.push({
        url: bingNewsRssUrl(q),
        source: 'bing_news',
        label: `bing:${q.slice(0, 30)}`,
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
  for (const { url, source, label } of feeds) {
    try {
      const posts = await parseFeed(url, source, label);
      for (const post of posts) {
        if (!seenIds.has(post.id)) {
          seenIds.add(post.id);
          results.push(post);
        }
      }
    } catch (err) {
      console.warn(`[rss:${label}] FAILED: ${err.message}`);
    }
  }

  // NewsAPI.org
  if (useNewsApi && queries.length) {
    try {
      const apiPosts = await fetchNewsApi(queries, process.env.NEWSAPI_KEY);
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

  console.log(`[news] OK — ${results.length} total posts`);
  return results;
}

export default fetchNews;
