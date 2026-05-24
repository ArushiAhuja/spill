import { Buffer } from 'buffer';

const TIMEOUT_MS = 10_000;
const MAX_RESULTS = '10'; // free tier safe; bump to 100 on Basic tier

function timedFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

async function getBearerToken(credentials = {}) {
  // Prefer a pre-issued bearer token
  const direct = credentials.bearer_token?.trim();
  if (direct) return direct;

  // Derive from consumer key + secret (OAuth2 app-only flow)
  const apiKey = credentials.api_key?.trim();
  const apiSecret = credentials.api_secret?.trim();
  if (!apiKey || !apiSecret) return null;

  const creds = Buffer.from(
    `${encodeURIComponent(apiKey)}:${encodeURIComponent(apiSecret)}`
  ).toString('base64');

  const res = await timedFetch('https://api.twitter.com/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Twitter bearer token fetch failed HTTP ${res.status}: ${text}`);
  }

  const data = await res.json();
  if (!data.access_token) throw new Error('Twitter OAuth2: no access_token in response');
  return data.access_token;
}

function normalize(tweet, usersById) {
  const user = usersById[tweet.author_id];
  const metrics = tweet.public_metrics ?? {};
  const text = tweet.text ?? '';

  return {
    id: `twitter_${tweet.id}`,
    source: 'twitter',
    author: user?.username ? `@${user.username}` : tweet.author_id,
    title: text.length > 120 ? text.slice(0, 120) + '…' : text,
    body: text,
    url: `https://twitter.com/i/web/status/${tweet.id}`,
    score: (metrics.like_count ?? 0) + (metrics.retweet_count ?? 0) * 2,
    follower_count: user?.public_metrics?.followers_count ?? 0,
    created_at: new Date(tweet.created_at),
    raw: tweet,
  };
}

// Accept { config, credentials }
// config.queries: array of search queries
// credentials.bearer_token or credentials.api_key + credentials.api_secret
export async function fetchTwitter({ config = {}, credentials = {} } = {}) {
  let token;
  try {
    token = await getBearerToken(credentials);
  } catch (err) {
    console.error(`[twitter] Auth failed: ${err.message}`);
    return [];
  }

  if (!token) {
    console.warn('[twitter] Skipped — set bearer_token or api_key + api_secret in credentials');
    return [];
  }

  const queries = Array.isArray(config.queries) && config.queries.length
    ? config.queries
    : [];

  if (!queries.length) {
    console.warn('[twitter] No queries configured, skipping');
    return [];
  }

  const allPosts = [];
  const seen = new Set();

  for (const searchQuery of queries) {
    // Append -is:retweet and lang:en for cleaner results
    const fullQuery = `${searchQuery} -is:retweet lang:en`;
    const params = new URLSearchParams({
      query: fullQuery,
      max_results: MAX_RESULTS,
      'tweet.fields': 'created_at,author_id,public_metrics',
      expansions: 'author_id',
      'user.fields': 'name,username,public_metrics',
    });

    try {
      const res = await timedFetch(
        `https://api.twitter.com/2/tweets/search/recent?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (res.status === 429) {
        const reset = res.headers.get('x-rate-limit-reset');
        const resetAt = reset ? new Date(Number(reset) * 1000).toISOString() : 'unknown';
        console.warn(`[twitter] Rate limited — resets at ${resetAt}`);
        break;
      }

      if (res.status === 401) {
        console.warn('[twitter] 401 Unauthorized — bearer token invalid or expired');
        break;
      }

      if (res.status === 403) {
        console.warn('[twitter] 403 Forbidden — X API plan does not include search (Basic tier required)');
        break;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.warn(`[twitter] HTTP ${res.status} for query "${searchQuery}" — skipping: ${text.slice(0, 200)}`);
        continue;
      }

      const json = await res.json();
      const tweets = json.data ?? [];

      if (!tweets.length) continue;

      const usersById = Object.fromEntries(
        (json.includes?.users ?? []).map((u) => [u.id, u])
      );

      for (const tweet of tweets) {
        const post = normalize(tweet, usersById);
        if (!seen.has(post.id)) {
          seen.add(post.id);
          allPosts.push(post);
        }
      }
    } catch (err) {
      console.warn(`[twitter] query "${searchQuery}" failed: ${err.message}`);
    }
  }

  console.log(`[twitter] OK — ${allPosts.length} tweets`);
  return allPosts;
}

export default fetchTwitter;
