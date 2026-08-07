export const runtime = 'edge';

const USER_AGENT = 'spill-social-watch/1.0 by Certain-Lie2741';
const TIMEOUT_MS = 10_000;

// Reddit RSS (Atom) — returns 200 from Cloudflare edge; JSON returns 403.
// Parses the Atom XML with regex (no XML parser available in edge runtime).
function parseAtom(xml) {
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => m[1]);
  return entries.map(entry => {
    const get = (tag) => {
      const m = entry.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, 'i'));
      return m ? m[1].trim() : '';
    };
    const id = entry.match(/\/comments\/([a-z0-9]+)\//i)?.[1] ?? Math.random().toString(36).slice(2);
    const link = entry.match(/<link[^>]+href="([^"]+)"/)?.[1] ?? '';
    const author = entry.match(/<name>([^<]+)<\/name>/)?.[1]?.replace(/^\/u\//, '') ?? 'unknown';
    const updated = entry.match(/<updated>([^<]+)<\/updated>/)?.[1] ?? '';
    const title = get('title').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const content = get('content').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
    const score = parseInt(entry.match(/(\d+)\s+point/)?.[1] ?? '0', 10);
    return {
      id: `reddit_${id}`,
      source: 'reddit',
      author,
      title,
      body: content,
      url: link,
      score,
      created_at: updated ? new Date(updated).toISOString() : new Date().toISOString(),
    };
  });
}

async function fetchRss(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseAtom(xml);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// Parse a Reddit URL into a fetchable RSS URL
function redditUrlToRss(rawUrl) {
  try {
    const u = new URL(rawUrl.trim());
    const parts = u.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
    if (parts[0] === 'r' && parts[1]) {
      if (parts[2] === 'comments' && parts[3]) {
        return `https://www.reddit.com/r/${parts[1]}/comments/${parts[3]}/.rss`;
      }
      return `https://www.reddit.com/r/${parts[1]}/new.rss?limit=50`;
    }
  } catch {}
  return null;
}

// POST /api/internal/reddit-fetch
// Runs on Cloudflare edge where Reddit RSS returns 200 (vs 403 from AWS).
export async function POST(request) {
  // Symmetric auth: allow empty-matches-empty for local dev, enforce match otherwise
  const incoming = request.headers.get('x-internal-secret') || '';
  const expected = process.env.CRON_SECRET || '';
  if (incoming !== expected) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { queries = ['company'], subreddits = [], custom_threads = [], context_queries = [], operational_queries = [] } = await request.json();
  // Merge both for backwards compat
  const allContextQueries = [...new Set([...context_queries, ...operational_queries])];

  const brandWord = queries[0]?.split(/\s+/)[0] || queries[0] || 'company';
  // Use brand word + up to 3 operational/context queries for subreddit searches.
  // These are topic-based (e.g. "DGCA CPL training India") and surface
  // relevant posts in a subreddit even when the brand name isn't in the title.
  const subredditTerms = allContextQueries.length > 0
    ? [brandWord, ...allContextQueries.slice(0, 3)]
    : [brandWord];

  const endpoints = [
    // Global search: full brand-specific queries
    ...queries.map(q =>
      `https://www.reddit.com/search.rss?q=${encodeURIComponent(q)}&sort=new&t=day&limit=100`
    ),
    // Recent posts from monitored subreddits (soft brand mentions)
    ...subreddits.map(sr =>
      `https://www.reddit.com/r/${sr}/new.rss?limit=50`
    ),
    // Subreddit search: brand word + context queries for topical coverage
    ...subreddits.flatMap(sr =>
      subredditTerms.map(term =>
        `https://www.reddit.com/r/${sr}/search.rss?q=${encodeURIComponent(term)}&restrict_sr=1&sort=new&t=week&limit=25`
      )
    ),
    // Custom thread URLs: fetched as-is (user explicitly subscribed)
    ...custom_threads.map(redditUrlToRss).filter(Boolean),
  ];

  const results = await Promise.allSettled(endpoints.map(fetchRss));

  const seen = new Set();
  const posts = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const post of result.value) {
        if (!seen.has(post.id)) { seen.add(post.id); posts.push(post); }
      }
    }
  }

  return Response.json({ posts, count: posts.length });
}
