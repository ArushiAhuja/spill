import { Buffer } from 'buffer';
import { createHash } from 'crypto';
import { firecrawlScrape, getFirecrawlKey } from './firecrawl.js';

const TIMEOUT_MS = 10_000;
const MAX_RESULTS = '10'; // free tier safe; bump to 100 on Basic tier

// Nitter instances (Twitter public mirrors — no auth required)
const NITTER_INSTANCES = [
  'https://nitter.poast.org',
  'https://nitter.privacydev.net',
  'https://nitter.catsarch.com',
];

function makeFirecrawlId(raw) {
  return `twitter_fc_${createHash('md5').update(String(raw)).digest('hex')}`;
}

function parseNitterMarkdown(markdown, query) {
  if (!markdown || markdown.length < 100) return [];
  const posts = [];
  // Nitter separates tweets with horizontal rules or double newlines between post blocks
  const blocks = markdown.split(/\n---+\n|\n\*\*\*+\n/);

  for (const block of blocks.slice(0, 15)) {
    // Extract @username
    const authorMatch = block.match(/@([A-Za-z0-9_]+)/);
    if (!authorMatch) continue;

    // Strip markdown formatting and image refs to get tweet text
    const text = block
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/^#+\s*/gm, '')
      .replace(/[*_`]/g, '')
      .replace(/@[A-Za-z0-9_]+/g, '')    // remove @mentions noise
      .replace(/\d+\s*(likes?|retweets?|replies?|reposts?)/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (text.length < 20) continue;

    // Prefer individual tweet URLs (/status/ID) — never fall back to search pages
    const statusMatch = block.match(/https?:\/\/[^\s)]+\/status\/(\d+)/i);
    const url = statusMatch
      ? statusMatch[0].replace(/nitter\.[^/]+/, 'twitter.com').replace(/x\.com/, 'twitter.com')
      : `https://twitter.com/${authorMatch[1]}`;

    posts.push({
      id: makeFirecrawlId(block.slice(0, 120)),
      source: 'twitter',
      author: `@${authorMatch[1]}`,
      title: text.length > 120 ? text.slice(0, 120) + '…' : text,
      body: text,
      url,
      score: 0,
      follower_count: 0,
      created_at: new Date(),
    });
  }
  return posts;
}

async function fetchViaFirecrawl(queries, apiKey) {
  const allPosts = [];
  const seen = new Set();

  for (const query of queries.slice(0, 3)) {
    let gotResults = false;
    for (const instance of NITTER_INSTANCES) {
      try {
        const url = `${instance}/search?q=${encodeURIComponent(query)}&f=tweets`;
        const markdown = await firecrawlScrape(url, apiKey, { waitFor: 2000 });
        const posts = parseNitterMarkdown(markdown, query);
        for (const p of posts) {
          if (!seen.has(p.id)) { seen.add(p.id); allPosts.push(p); }
        }
        if (posts.length) {
          console.log(`[twitter] firecrawl nitter (${instance}): ${posts.length} tweets for "${query}"`);
          gotResults = true;
          break;
        }
      } catch (err) {
        console.warn(`[twitter] firecrawl nitter ${instance} failed for "${query}":`, err.message);
      }
    }
    if (!gotResults) {
      console.warn(`[twitter] firecrawl: all nitter instances failed for "${query}"`);
    }
  }
  return allPosts;
}

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
  const queries = Array.isArray(config.queries) && config.queries.length
    ? config.queries
    : [];

  let token;
  try {
    token = await getBearerToken(credentials);
  } catch (err) {
    console.error(`[twitter] Auth failed: ${err.message}`);
  }

  if (!token) {
    // No API token — try Firecrawl/nitter directly
    const fcKey = getFirecrawlKey(credentials);
    if (fcKey && queries.length) {
      console.log('[twitter] No API token — using Firecrawl/nitter');
      const posts = await fetchViaFirecrawl(queries, fcKey);
      console.log(`[twitter] firecrawl OK — ${posts.length} tweets`);
      return posts;
    }
    console.warn('[twitter] Skipped — set bearer_token or api_key + api_secret in credentials (or FIRECRAWL_API_KEY for nitter fallback)');
    return [];
  }

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

  if (allPosts.length) {
    console.log(`[twitter] API OK — ${allPosts.length} tweets`);
    return allPosts;
  }

  // Fallback: Firecrawl + nitter when API returns nothing or no token configured
  const fcKey = getFirecrawlKey(credentials);
  if (fcKey) {
    console.log('[twitter] API returned 0 results — trying Firecrawl/nitter');
    const fcPosts = await fetchViaFirecrawl(queries, fcKey);
    console.log(`[twitter] firecrawl OK — ${fcPosts.length} tweets`);
    return fcPosts;
  }

  console.log(`[twitter] OK — ${allPosts.length} tweets`);
  return allPosts;
}

export default fetchTwitter;
