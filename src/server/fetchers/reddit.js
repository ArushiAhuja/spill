// Strategy (in priority order):
// 1. Internal edge endpoint  — runs on Cloudflare, bypasses AWS IP blocks
// 2. Apify Reddit scraper    — if APIFY_API_KEY is set
// 3. Direct public API       — fallback, works from non-datacenter IPs

const USER_AGENT = 'spill-social-watch/1.0 by Certain-Lie2741';
const TIMEOUT_MS = 10_000;

function timedFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function normalize(child) {
  const d = child.data ?? child;
  const ts = d.created_utc ?? 0;
  const created_at = d.created_at ? new Date(d.created_at) : new Date(ts * 1000);
  return {
    id: d.id?.startsWith('reddit_') ? d.id : `reddit_${d.id}`,
    source: 'reddit',
    author: d.author ?? 'unknown',
    title: d.title ?? '',
    body: d.selftext ?? d.body ?? '',
    url: d.url ?? (d.permalink
      ? `https://www.reddit.com${d.permalink}`
      : `https://www.reddit.com/r/${d.subreddit}/comments/${d.id}/`),
    score: d.score ?? d.ups ?? 0,
    created_at,
  };
}

// Parse a Reddit URL into { type: 'subreddit'|'post', subreddit, postId? }
function parseRedditUrl(rawUrl) {
  try {
    const u = new URL(rawUrl.trim());
    const parts = u.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
    if (parts[0] === 'r' && parts[1]) {
      if (parts[2] === 'comments' && parts[3]) {
        return { type: 'post', subreddit: parts[1], postId: parts[3] };
      }
      return { type: 'subreddit', subreddit: parts[1] };
    }
    // redd.it/POSTID short links — subreddit unknown, skip for now
  } catch {}
  return null;
}

// ── Strategy 1: internal edge endpoint ───────────────────────────────────────
async function fetchViaEdge(queries, subreddits, customThreads, operationalQueries) {
  const appUrl = process.env.APP_URL || 'https://getspill.vercel.app';
  const secret = process.env.CRON_SECRET || '';
  const res = await timedFetch(`${appUrl}/api/internal/reddit-fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
    body: JSON.stringify({ queries, subreddits, custom_threads: customThreads, context_queries: operationalQueries, operational_queries: operationalQueries }),
  });
  if (!res.ok) throw new Error(`edge endpoint returned ${res.status}`);
  const { posts = [] } = await res.json();
  return posts.map(p => normalize({ ...p, created_at: p.created_at }));
}

// ── Strategy 2: Apify Reddit scraper ─────────────────────────────────────────
async function fetchViaApify(queries, subreddits, apiKey, operationalQueries) {
  const brandWord = queries[0]?.split(/\s+/)[0] || queries[0] || 'company';
  const subredditTerms = operationalQueries.length > 0
    ? [brandWord, ...operationalQueries.slice(0, 3)]
    : [brandWord];
  const startUrls = [
    ...queries.map(q => ({
      url: `https://www.reddit.com/search/?q=${encodeURIComponent(q)}&sort=new&t=day`,
    })),
    // Recent posts from monitored subs so soft brand mentions don't depend on search hits
    ...subreddits.map(sr => ({
      url: `https://www.reddit.com/r/${sr}/new/?limit=50`,
    })),
    ...subreddits.flatMap(sr =>
      subredditTerms.map(term => ({
        url: `https://www.reddit.com/r/${sr}/search/?q=${encodeURIComponent(term)}&restrict_sr=1&sort=new&t=week`,
      }))
    ),
  ];

  const res = await timedFetch(
    `https://api.apify.com/v2/acts/trudax~reddit-scraper-lite/run-sync-get-dataset-items?token=${apiKey}&timeout=45`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startUrls, maxItems: 150 }),
    }
  );
  if (!res.ok) throw new Error(`Apify returned ${res.status}`);
  const items = await res.json();
  return (Array.isArray(items) ? items : []).map(item => ({
    id: `reddit_${item.id ?? item.postId ?? Math.random().toString(36).slice(2)}`,
    source: 'reddit',
    author: item.author ?? item.username ?? 'unknown',
    title: item.title ?? '',
    body: item.body ?? item.text ?? '',
    url: item.url ?? item.postUrl ?? '',
    score: item.score ?? item.ups ?? 0,
    created_at: item.createdAt ? new Date(item.createdAt) : new Date(),
  }));
}

// ── Strategy 3: direct public API ────────────────────────────────────────────
async function fetchDirect(queries, subreddits, customThreads, operationalQueries) {
  const brandWord = queries[0]?.split(/\s+/)[0] || queries[0] || 'company';
  // Use up to 3 operational queries for subreddit searches so we find topically relevant posts
  const subredditSearchTerms = operationalQueries.length > 0
    ? [brandWord, ...operationalQueries.slice(0, 3)]
    : [brandWord];

  const endpoints = [
    // Global search: new (last 24h) + top (last week) for brand queries
    ...queries.flatMap(q => [
      `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=new&t=day&limit=100`,
      `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=top&t=week&limit=25`,
    ]),
    // Poll /new on configured subs so soft brand mentions become candidates even
    // without a successful sitewide brand-search hit.
    ...subreddits.map(sr =>
      `https://www.reddit.com/r/${sr}/new.json?limit=50`
    ),
    // Search each subreddit with brand word + context queries for broader topical coverage
    ...subreddits.flatMap(sr =>
      subredditSearchTerms.flatMap(term => [
        `https://www.reddit.com/r/${sr}/search.json?q=${encodeURIComponent(term)}&restrict_sr=1&sort=new&t=week&limit=25`,
        `https://www.reddit.com/r/${sr}/search.json?q=${encodeURIComponent(term)}&restrict_sr=1&sort=top&t=week&limit=25`,
      ])
    ),
  ];

  // Add custom thread endpoints
  for (const rawUrl of customThreads) {
    const parsed = parseRedditUrl(rawUrl);
    if (!parsed) continue;
    if (parsed.type === 'subreddit') {
      endpoints.push(
        `https://www.reddit.com/r/${parsed.subreddit}/new.json?limit=50`
      );
    } else if (parsed.type === 'post') {
      endpoints.push(
        `https://www.reddit.com/r/${parsed.subreddit}/comments/${parsed.postId}.json?limit=10`
      );
    }
  }

  async function fetchEndpoint(url) {
    const res = await timedFetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return [];
    const json = await res.json();
    // Post thread JSON returns [postListing, commentsListing]
    if (Array.isArray(json)) {
      return (json[0]?.data?.children ?? []).map(normalize);
    }
    return (json?.data?.children ?? []).map(normalize);
  }

  const results = await Promise.allSettled(endpoints.map(fetchEndpoint));
  const seen = new Set();
  const posts = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      for (const p of r.value) {
        if (!seen.has(p.id)) { seen.add(p.id); posts.push(p); }
      }
    }
  }
  return posts;
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function fetchReddit({ config = {}, credentials = {} } = {}) {
  const cfg = config || {};
  const queries = Array.isArray(cfg.queries) && cfg.queries.length ? cfg.queries : ['company'];

  // Merge manual subreddits + auto-discovered subreddits (deduped)
  const manualSubreddits = Array.isArray(cfg.subreddits) ? cfg.subreddits : [];
  const autoSubreddits = Array.isArray(cfg.auto_subreddits) ? cfg.auto_subreddits : [];
  const subredditSet = new Set([...manualSubreddits, ...autoSubreddits].map(s => s.toLowerCase()));
  // Reconstruct preserving original casing from manual list first
  const subreddits = [
    ...manualSubreddits,
    ...autoSubreddits.filter(s => !manualSubreddits.some(m => m.toLowerCase() === s.toLowerCase())),
  ];

  const customThreads = Array.isArray(cfg.custom_threads)
    ? cfg.custom_threads.filter(Boolean)
    : [];

  const contextQueries = Array.isArray(cfg.context_queries)
    ? cfg.context_queries.filter(Boolean)
    : [];

  const intelProfile = cfg.intel_profile || {};
  // Build operational search terms: context_queries + operationalRiskQueries + customerIntentQueries
  const operationalQueries = [
    ...contextQueries,
    ...(intelProfile.operationalRiskQueries || []),
    ...(intelProfile.customerIntentQueries || []),
  ].filter((q, i, arr) => arr.indexOf(q) === i); // dedupe

  // Strategy 1: edge endpoint
  try {
    const posts = await fetchViaEdge(queries, subreddits, customThreads, operationalQueries);
    console.log(`[reddit] OK via edge — ${posts.length} posts`);
    return posts;
  } catch (err) {
    console.warn('[reddit] edge failed, trying next strategy:', err.message);
  }

  // Strategy 2: Apify
  const apifyKey = process.env.APIFY_API_KEY;
  if (apifyKey) {
    try {
      const posts = await fetchViaApify(queries, subreddits, apifyKey, operationalQueries);
      console.log(`[reddit] OK via Apify — ${posts.length} posts`);
      return posts;
    } catch (err) {
      console.warn('[reddit] Apify failed, falling back to direct:', err.message);
    }
  }

  // Strategy 3: direct (works from non-datacenter IPs)
  const posts = await fetchDirect(queries, subreddits, customThreads, operationalQueries);
  console.log(`[reddit] OK via direct — ${posts.length} posts`);
  return posts;
}

export default fetchReddit;
