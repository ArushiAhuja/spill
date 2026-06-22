import gplay from 'google-play-scraper';

const TIMEOUT_MS = 15_000;
const DEFAULT_COUNTRIES = ['in', 'us', 'gb'];
const REVIEWS_PER_COUNTRY = 25;

function withTimeout(promise, ms) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]);
}

function normalize(review, appId, country) {
  const text = review.text ?? '';
  const appUrl = `https://play.google.com/store/apps/details?id=${appId}`;
  return {
    id: `playstore_${review.id}_${country}`,
    source: 'playstore',
    author: review.userName ?? 'Anonymous',
    title: text.slice(0, 80),
    body: text,
    url: appUrl,
    score: review.score ?? 0,
    created_at: new Date(review.date),
    raw: review,
  };
}

// Accept { config } where:
//   config.app_ids   — array of Play Store app IDs
//   config.countries — array of country codes (default: ['in', 'us', 'gb'])
//   config.num       — reviews per app per country (default: 25)
export async function fetchPlaystore({ config = {} } = {}) {
  const appIds = Array.isArray(config.app_ids) && config.app_ids.length
    ? config.app_ids
    : [];

  if (!appIds.length) {
    console.log('[playstore] no app_ids configured, skipping');
    return [];
  }

  const countries = Array.isArray(config.countries) && config.countries.length
    ? config.countries
    : DEFAULT_COUNTRIES;

  const num = Math.min(config.num ?? REVIEWS_PER_COUNTRY, 100);

  const allPosts = [];
  const seen = new Set();

  for (const appId of appIds) {
    for (const country of countries) {
      try {
        const result = await withTimeout(
          gplay.reviews({
            appId,
            sort: gplay.sort.NEWEST,
            num,
            lang: 'en',
            country,
          }),
          TIMEOUT_MS
        );

        const list = Array.isArray(result) ? result : (result.data ?? []);
        let added = 0;
        for (const review of list) {
          const post = normalize(review, appId, country);
          if (!seen.has(post.id)) {
            seen.add(post.id);
            allPosts.push(post);
            added++;
          }
        }
        console.log(`[playstore] ${appId}/${country} OK — ${added} reviews`);
      } catch (err) {
        console.warn(`[playstore] ${appId}/${country} failed: ${err.message}`);
      }
    }
  }

  console.log(`[playstore] OK — ${allPosts.length} total posts`);
  return allPosts;
}

export default fetchPlaystore;
