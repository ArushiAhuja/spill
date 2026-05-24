const TIMEOUT_MS = 10_000;

function timedFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

function normalize(story) {
  const url =
    story.url || `https://news.ycombinator.com/item?id=${story.objectID}`;

  return {
    id: `hn_${story.objectID}`,
    source: 'hackernews',
    author: story.author ?? 'unknown',
    title: story.title ?? '',
    body: story.text ?? '',
    url,
    score: story.points ?? 0,
    created_at: new Date(story.created_at),
    raw: story,
  };
}

// Accept { config } where config.queries is an array of search terms
export async function fetchHackernews({ config = {} } = {}) {
  const queries = Array.isArray(config.queries) && config.queries.length
    ? config.queries
    : ['startup'];

  const allPosts = [];
  const seen = new Set();

  const since = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);

  for (const q of queries) {
    const encoded = encodeURIComponent(q);
    const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encoded}&tags=story&hitsPerPage=25&numericFilters=created_at_i>${since}`;

    try {
      const res = await timedFetch(url, {
        headers: { 'User-Agent': 'spill-social-watch/2.0' },
      });
      if (!res.ok) {
        console.warn(`[hackernews] HTTP ${res.status} for query "${q}"`);
        continue;
      }
      const json = await res.json();
      const hits = json.hits ?? [];
      for (const story of hits) {
        const post = normalize(story);
        if (!seen.has(post.id)) {
          seen.add(post.id);
          allPosts.push(post);
        }
      }
    } catch (err) {
      console.warn(`[hackernews] query "${q}" failed: ${err.message}`);
    }
  }

  console.log(`[hackernews] OK — ${allPosts.length} posts`);
  return allPosts;
}

export default fetchHackernews;
