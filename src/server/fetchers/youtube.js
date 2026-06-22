// YouTube Data API v3 — requires YOUTUBE_API_KEY env var
// Searches for videos mentioning the brand within the last 24h
// Quota: each search costs 100 units; free tier = 10,000 units/day = ~100 searches/day

const TIMEOUT_MS = 10_000;
const MAX_RESULTS = 25;

function timedFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function normalize(item) {
  const snippet = item.snippet ?? {};
  const videoId = item.id?.videoId;
  if (!videoId) return null;
  return {
    id: `youtube_${videoId}`,
    source: 'youtube',
    author: snippet.channelTitle ?? 'Unknown',
    title: snippet.title ?? '',
    body: snippet.description ?? '',
    url: `https://www.youtube.com/watch?v=${videoId}`,
    score: 0,
    created_at: snippet.publishedAt ? new Date(snippet.publishedAt) : new Date(),
    raw: item,
  };
}

export async function fetchYouTube({ config = {}, credentials = {} } = {}) {
  const apiKey = process.env.YOUTUBE_API_KEY || credentials.api_key;
  if (!apiKey) {
    console.log('[youtube] YOUTUBE_API_KEY not set, skipping');
    return [];
  }

  const queries = Array.isArray(config.queries) && config.queries.length
    ? config.queries
    : [];

  if (!queries.length) {
    console.log('[youtube] no queries configured, skipping');
    return [];
  }

  // publishedAfter must be RFC 3339 format
  const publishedAfter = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const allPosts = [];
  const seen = new Set();

  for (const q of queries) {
    const params = new URLSearchParams({
      part: 'snippet',
      q,
      type: 'video',
      order: 'date',
      publishedAfter,
      maxResults: String(MAX_RESULTS),
      key: apiKey,
    });
    const url = `https://www.googleapis.com/youtube/v3/search?${params}`;

    try {
      const res = await timedFetch(url);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.warn(`[youtube] query "${q}" HTTP ${res.status}: ${body.slice(0, 200)}`);
        continue;
      }
      const json = await res.json();
      const items = json.items ?? [];
      for (const item of items) {
        const post = normalize(item);
        if (post && !seen.has(post.id)) {
          seen.add(post.id);
          allPosts.push(post);
        }
      }
      console.log(`[youtube] query "${q}" OK — ${items.length} videos`);
    } catch (err) {
      console.warn(`[youtube] query "${q}" failed: ${err.message}`);
    }
  }

  console.log(`[youtube] OK — ${allPosts.length} total posts`);
  return allPosts;
}

export default fetchYouTube;
