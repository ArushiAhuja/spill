import { fetchReddit } from './reddit.js';
import { fetchHackernews } from './hackernews.js';
import { fetchNews } from './news.js';
import { fetchPlaystore } from './playstore.js';
import { fetchTwitter } from './twitter.js';
import { fetchAppstore } from './appstore.js';
import { fetchLinkedIn } from './linkedin.js';
import { fetchInstagram } from './instagram.js';
import { fetchYouTube } from './youtube.js';
import { fetchTrustpilot } from './trustpilot.js';

// Registry of all available fetchers with UI metadata.
// Each entry describes what the source is, what credentials it needs,
// and what config fields operators can set — so a settings UI can render
// the form for any source without hardcoding it.
export const FETCHER_MANIFEST = [
  {
    key: 'reddit',
    name: 'Reddit',
    description: 'Posts and threads mentioning your brand across Reddit',
    icon: '🔴',
    credentialFields: [],
    configFields: [
      { key: 'queries', label: 'Search queries', type: 'string[]', hint: 'Brand name, product names, common misspellings' },
      { key: 'subreddits', label: 'Subreddits to watch', type: 'string[]', hint: 'e.g. startups, ProductHunt' },
      { key: 'custom_threads', label: 'Custom thread URLs', type: 'string[]', hint: 'Direct Reddit post or subreddit URLs' },
    ],
    fetch: fetchReddit,
  },
  {
    key: 'hackernews',
    name: 'Hacker News',
    description: 'Stories and comments on news.ycombinator.com',
    icon: '🟠',
    credentialFields: [],
    configFields: [
      { key: 'queries', label: 'Search queries', type: 'string[]' },
    ],
    fetch: fetchHackernews,
  },
  {
    key: 'google_news',
    name: 'News & RSS',
    description: 'Google News, Bing News, NewsAPI.org, and any custom RSS feeds',
    icon: '📰',
    credentialFields: [
      { key: 'NEWSAPI_KEY', label: 'NewsAPI.org key', hint: 'Free tier: 100 requests/day at newsapi.org', env: true, optional: true },
    ],
    configFields: [
      { key: 'queries', label: 'Search queries', type: 'string[]', hint: 'Auto-generates Google News + Bing RSS per query' },
      { key: 'rss_urls', label: 'Custom RSS feed URLs', type: 'string[]', hint: 'Any valid RSS/Atom feed URL' },
      { key: 'auto_google_news', label: 'Auto Google News RSS', type: 'boolean', default: true },
      { key: 'auto_bing', label: 'Auto Bing News RSS', type: 'boolean', default: true },
      { key: 'newsapi', label: 'Use NewsAPI.org', type: 'boolean', default: true },
    ],
    fetch: fetchNews,
  },
  {
    key: 'twitter',
    name: 'X / Twitter',
    description: 'Tweets and replies mentioning your brand',
    icon: '𝕏',
    credentialFields: [
      { key: 'TWITTER_BEARER_TOKEN', label: 'Bearer token', env: true },
    ],
    configFields: [
      { key: 'queries', label: 'Search queries', type: 'string[]' },
      { key: 'hashtags', label: 'Hashtags', type: 'string[]' },
    ],
    fetch: fetchTwitter,
  },
  {
    key: 'youtube',
    name: 'YouTube',
    description: 'Videos mentioning your brand (YouTube Data API v3)',
    icon: '▶️',
    credentialFields: [
      { key: 'YOUTUBE_API_KEY', label: 'YouTube Data API v3 key', env: true, hint: 'Free quota: 10,000 units/day; each search = 100 units' },
    ],
    configFields: [
      { key: 'queries', label: 'Search queries', type: 'string[]' },
    ],
    fetch: fetchYouTube,
  },
  {
    key: 'trustpilot',
    name: 'Trustpilot',
    description: 'Public customer reviews from Trustpilot (no API key needed)',
    icon: '⭐',
    credentialFields: [],
    configFields: [
      { key: 'domains', label: 'Business domains', type: 'string[]', hint: 'e.g. ["example.com"] — your Trustpilot profile domain' },
    ],
    fetch: fetchTrustpilot,
  },
  {
    key: 'playstore',
    name: 'Google Play Store',
    description: 'App reviews from the Google Play Store',
    icon: '▶',
    credentialFields: [],
    configFields: [
      { key: 'app_ids', label: 'App IDs', type: 'string[]', hint: 'e.g. com.yourapp.android' },
      { key: 'countries', label: 'Countries', type: 'string[]', hint: 'ISO codes: in, us, gb (default: all three)', default: ['in', 'us', 'gb'] },
    ],
    fetch: fetchPlaystore,
  },
  {
    key: 'appstore',
    name: 'Apple App Store',
    description: 'App reviews from the Apple App Store',
    icon: '🍎',
    credentialFields: [],
    configFields: [
      { key: 'app_ids', label: 'App IDs', type: 'string[]', hint: 'Numeric App Store ID' },
      { key: 'countries', label: 'Countries', type: 'string[]', hint: 'ISO codes: in, us, gb (default: all three)', default: ['in', 'us', 'gb'] },
    ],
    fetch: fetchAppstore,
  },
  {
    key: 'linkedin',
    name: 'LinkedIn',
    description: 'Posts and company mentions on LinkedIn',
    icon: '🔵',
    credentialFields: [],
    configFields: [
      { key: 'queries', label: 'Search queries', type: 'string[]' },
      { key: 'company_urls', label: 'Company page URLs', type: 'string[]' },
    ],
    fetch: fetchLinkedIn,
  },
  {
    key: 'instagram',
    name: 'Instagram',
    description: 'Posts and hashtags mentioning your brand on Instagram',
    icon: '📷',
    credentialFields: [],
    configFields: [
      { key: 'hashtags', label: 'Hashtags', type: 'string[]' },
      { key: 'accounts', label: 'Accounts to monitor', type: 'string[]' },
    ],
    fetch: fetchInstagram,
  },
];

// Lookup map: key → manifest entry
export const FETCHER_BY_KEY = Object.fromEntries(
  FETCHER_MANIFEST.map(f => [f.key, f])
);

export async function fetchAll(orgConfig) {
  const tasks = [];
  const { sources } = orgConfig;

  for (const entry of FETCHER_MANIFEST) {
    const src = sources[entry.key];
    if (src?.enabled) {
      tasks.push(
        entry.fetch(src).catch(err => {
          console.error(`[fetchAll] ${entry.key} crashed: ${err.message}`);
          return [];
        })
      );
    }
  }

  const results = await Promise.allSettled(tasks);

  const allPosts = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      allPosts.push(...result.value);
    } else {
      console.error('[fetchAll] fetcher error:', result.reason?.message);
    }
  }

  // Drop anything older than 24 hours
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const fresh = allPosts.filter(p => {
    const ts = new Date(p.created_at).getTime();
    return !isNaN(ts) && ts >= cutoff;
  });

  // Dedupe by URL
  const seen = new Set();
  const unique = fresh.filter(p => {
    if (seen.has(p.url)) return false;
    seen.add(p.url);
    return true;
  });

  console.log(`[fetchAll] ${unique.length} fresh posts (from ${allPosts.length} total)`);
  return unique.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export default fetchAll;
