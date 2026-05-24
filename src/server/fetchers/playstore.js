import gplay from 'google-play-scraper';

const TIMEOUT_MS = 15_000; // Play Store scraper is slower than REST APIs

function withTimeout(promise, ms) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]);
}

function normalize(review, appId) {
  const text = review.text ?? '';
  const appUrl = `https://play.google.com/store/apps/details?id=${appId}`;
  return {
    id: `playstore_${review.id}`,
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

// Accept { config } where config.app_ids is an array of Play Store app IDs
export async function fetchPlaystore({ config = {} } = {}) {
  const appIds = Array.isArray(config.app_ids) && config.app_ids.length
    ? config.app_ids
    : [];

  if (!appIds.length) {
    console.log('[playstore] no app_ids configured, skipping');
    return [];
  }

  const allPosts = [];
  const seen = new Set();

  for (const appId of appIds) {
    try {
      const result = await withTimeout(
        gplay.reviews({
          appId,
          sort: gplay.sort.NEWEST,
          num: 25,
          lang: 'en',
          country: 'in',
        }),
        TIMEOUT_MS
      );

      const list = Array.isArray(result) ? result : (result.data ?? []);
      for (const review of list) {
        const post = normalize(review, appId);
        if (!seen.has(post.id)) {
          seen.add(post.id);
          allPosts.push(post);
        }
      }
      console.log(`[playstore] ${appId} OK — ${list.length} reviews`);
    } catch (err) {
      console.warn(`[playstore] ${appId} failed: ${err.message}`);
    }
  }

  console.log(`[playstore] OK — ${allPosts.length} total posts`);
  return allPosts;
}

export default fetchPlaystore;
