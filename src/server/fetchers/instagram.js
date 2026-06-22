// Instagram fetcher — multi-strategy
// Strategy 1: Google News RSS — site:instagram.com "{brand}"  (always works, no auth)
// Strategy 2: Firecrawl scrape of public profile pages        (needs FIRECRAWL_API_KEY)
// Strategy 3: Firecrawl scrape of hashtag explore pages       (needs FIRECRAWL_API_KEY, best-effort)
//
// config.queries:  ['brand name']              — used for Google News RSS search
// config.profiles: ['username1', 'username2']  — public Instagram profiles to scrape
// config.hashtags: ['tag1', 'tag2']            — hashtags to explore

import { createHash } from 'crypto';
import Parser from 'rss-parser';
import { firecrawlScrape, getFirecrawlKey } from './firecrawl.js';

const parser = new Parser({ requestOptions: { timeout: 12_000 } });

function makeId(raw) {
  return `instagram_${createHash('md5').update(String(raw)).digest('hex')}`;
}

function stripMd(text = '') {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')  // remove images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // unwrap links
    .replace(/[#*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Strategy 1: Google News RSS ─────────────────────────────────────────────
async function fetchViaGoogleNews(queries) {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  const results = [];

  const buildRss = (term) =>
    `https://news.google.com/rss/search?q=${encodeURIComponent(term)}&hl=en-US&gl=US&ceid=US:en`;

  for (const q of queries.slice(0, 3)) {
    const term = `"${q}" site:instagram.com`;
    try {
      const feed = await parser.parseURL(buildRss(term));
      let added = 0;
      for (const item of feed.items || []) {
        const ts = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();
        if (ts < cutoff) continue;
        const url = item.link || item.guid || '';
        results.push({
          id: makeId(url || item.title),
          source: 'instagram',
          author: item.creator || item.author || 'Instagram',
          title: item.title || '',
          body: item.contentSnippet || item.content || '',
          url,
          score: 0,
          created_at: item.pubDate ? new Date(item.pubDate) : new Date(),
        });
        added++;
      }
      if (added) console.log(`[instagram] google news: ${added} items for "${q}"`);
    } catch (err) {
      console.warn(`[instagram] google news failed for "${q}":`, err.message);
    }
  }
  return results;
}

// ── Strategy 2: Firecrawl — public profile pages ─────────────────────────────
function parseProfileMarkdown(markdown, username) {
  const posts = [];
  // Instagram profile pages render post captions — extract paragraphs that look like captions
  const sections = markdown.split(/\n{2,}/);
  const seen = new Set();

  for (const section of sections) {
    const text = stripMd(section);
    // Skip nav text, short UI strings, and login prompts
    if (text.length < 30) continue;
    if (/log in|sign up|follow|followers|following|posts|tagged|reels/i.test(text) && text.length < 80) continue;
    if (seen.has(text)) continue;
    seen.add(text);

    posts.push({
      id: makeId(`${username}_${text.slice(0, 80)}`),
      source: 'instagram',
      author: `@${username}`,
      title: text.length > 160 ? text.slice(0, 160) + '…' : text,
      body: text,
      url: `https://www.instagram.com/${username}/`,
      score: 0,
      created_at: new Date(),
    });

    if (posts.length >= 5) break;
  }
  return posts;
}

async function fetchViaFirecrawlProfiles(profiles, apiKey) {
  const results = [];
  for (const username of profiles.slice(0, 5)) {
    try {
      const url = `https://www.instagram.com/${username}/`;
      const markdown = await firecrawlScrape(url, apiKey, { waitFor: 3000 });
      if (!markdown || markdown.includes('Log in') && markdown.length < 500) {
        console.warn(`[instagram] profile @${username} is login-gated, skipping`);
        continue;
      }
      const posts = parseProfileMarkdown(markdown, username);
      results.push(...posts);
      console.log(`[instagram] firecrawl profile @${username}: ${posts.length} posts`);
    } catch (err) {
      console.warn(`[instagram] firecrawl profile @${username} failed:`, err.message);
    }
  }
  return results;
}

// ── Strategy 3: Firecrawl — hashtag explore pages ────────────────────────────
function parseHashtagMarkdown(markdown, hashtag) {
  const posts = [];
  const sections = markdown.split(/\n{2,}/);
  const seen = new Set();

  for (const section of sections) {
    const text = stripMd(section);
    if (text.length < 30) continue;
    if (/explore|top posts|recent posts|Instagram/i.test(text) && text.length < 60) continue;
    if (seen.has(text)) continue;
    seen.add(text);

    posts.push({
      id: makeId(`hashtag_${hashtag}_${text.slice(0, 80)}`),
      source: 'instagram',
      author: 'Instagram',
      title: text.length > 160 ? text.slice(0, 160) + '…' : text,
      body: text,
      url: `https://www.instagram.com/explore/tags/${encodeURIComponent(hashtag)}/`,
      score: 0,
      created_at: new Date(),
    });

    if (posts.length >= 5) break;
  }
  return posts;
}

async function fetchViaFirecrawlHashtags(hashtags, apiKey) {
  const results = [];
  for (const tag of hashtags.slice(0, 3)) {
    try {
      const url = `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`;
      const markdown = await firecrawlScrape(url, apiKey, { waitFor: 3000 });
      if (!markdown || markdown.length < 200) continue;
      const posts = parseHashtagMarkdown(markdown, tag);
      results.push(...posts);
      console.log(`[instagram] firecrawl #${tag}: ${posts.length} posts`);
    } catch (err) {
      console.warn(`[instagram] firecrawl #${tag} failed:`, err.message);
    }
  }
  return results;
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function fetchInstagram({ config = {}, credentials = {} } = {}) {
  const queries = Array.isArray(config.queries) ? config.queries.filter(Boolean) : [];
  const profiles = Array.isArray(config.profiles) ? config.profiles.filter(Boolean) : [];
  const hashtags = Array.isArray(config.hashtags) ? config.hashtags.filter(Boolean) : [];

  if (!queries.length && !profiles.length && !hashtags.length) {
    console.log('[instagram] no queries, profiles, or hashtags configured, skipping');
    return [];
  }

  const seen = new Set();
  const allPosts = [];

  function addUnique(posts) {
    for (const p of posts) {
      if (!p.id || seen.has(p.id)) continue;
      seen.add(p.id);
      allPosts.push(p);
    }
  }

  // Strategy 1: Google News RSS (always runs)
  if (queries.length) {
    addUnique(await fetchViaGoogleNews(queries));
  }

  // Strategies 2 & 3: Firecrawl (when API key available)
  const apiKey = getFirecrawlKey(credentials);
  if (apiKey) {
    if (profiles.length) addUnique(await fetchViaFirecrawlProfiles(profiles, apiKey));
    if (hashtags.length) addUnique(await fetchViaFirecrawlHashtags(hashtags, apiKey));
  } else if (profiles.length || hashtags.length) {
    console.warn('[instagram] FIRECRAWL_API_KEY not set — profile/hashtag scraping skipped');
  }

  console.log(`[instagram] total ${allPosts.length} unique posts`);
  return allPosts;
}

export default fetchInstagram;
