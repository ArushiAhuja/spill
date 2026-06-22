const TIMEOUT_MS = 15_000;
const DEFAULT_COUNTRIES = ['in', 'us', 'gb'];

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)
  )]);
}

function normalize(entry, appId, country) {
  const text = entry['im:name']?.label || entry.content?.label || '';
  const rating = parseInt(entry['im:rating']?.label || '0', 10);
  const entryId = entry.id?.label || '';
  return {
    id: `appstore_${entryId || appId}_${country}`,
    source: 'appstore',
    author: entry.author?.name?.label || 'Anonymous',
    title: (entry.title?.label || text).slice(0, 80),
    body: text,
    url: `https://apps.apple.com/${country}/app/id${appId}`,
    score: rating,
    created_at: entry.updated?.label ? new Date(entry.updated.label) : new Date(),
    raw: entry,
  };
}

// Accept { config } where:
//   config.app_ids   — array of App Store numeric IDs
//   config.countries — array of country codes (default: ['in', 'us', 'gb'])
export async function fetchAppstore({ config = {} } = {}) {
  const appIds = Array.isArray(config.app_ids) && config.app_ids.length ? config.app_ids : [];
  if (!appIds.length) { console.log('[appstore] no app_ids configured, skipping'); return []; }

  const countries = Array.isArray(config.countries) && config.countries.length
    ? config.countries
    : DEFAULT_COUNTRIES;

  const allPosts = [];
  const seen = new Set();

  for (const appId of appIds) {
    for (const country of countries) {
      try {
        const url = `https://itunes.apple.com/${country}/rss/customerreviews/id=${appId}/sortBy=mostRecent/json`;
        const res = await withTimeout(fetch(url), TIMEOUT_MS);
        if (!res.ok) { console.warn(`[appstore] ${appId}/${country} HTTP ${res.status}`); continue; }
        const json = await res.json();
        const entries = json.feed?.entry || [];
        // First entry is the app itself, not a review
        const reviews = Array.isArray(entries) ? entries.slice(1) : [];
        let added = 0;
        for (const entry of reviews) {
          const post = normalize(entry, appId, country);
          if (!seen.has(post.id)) { seen.add(post.id); allPosts.push(post); added++; }
        }
        console.log(`[appstore] ${appId}/${country} OK — ${added} reviews`);
      } catch (err) {
        console.warn(`[appstore] ${appId}/${country} failed: ${err.message}`);
      }
    }
  }

  console.log(`[appstore] OK — ${allPosts.length} total posts`);
  return allPosts;
}

export default fetchAppstore;
