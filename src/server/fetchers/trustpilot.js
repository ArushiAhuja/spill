// Trustpilot — public review RSS feeds, no auth required
// Each business has a public RSS at: https://www.trustpilot.com/review/{domain}/rss
// Falls back to scraping the review page via firecrawl if rss-parser fails

import { createHash } from 'crypto';
import Parser from 'rss-parser';
import { firecrawlScrape, getFirecrawlKey } from './firecrawl.js';

const TIMEOUT_MS = 12_000;
const parser = new Parser({ requestOptions: { timeout: TIMEOUT_MS } });

function normalize(item, domain) {
  const url = item.link ?? `https://www.trustpilot.com/review/${domain}`;
  const id = createHash('md5').update(url + (item.title ?? '')).digest('hex');
  // Trustpilot star rating is embedded in the title as "5 stars - ..." or in categories
  const starMatch = (item.title ?? '').match(/^(\d)\s*star/i);
  const rating = starMatch ? parseInt(starMatch[1], 10) : 0;
  return {
    id: `trustpilot_${id}`,
    source: 'trustpilot',
    author: item.creator ?? item.author ?? 'Anonymous',
    title: item.title ?? '',
    body: item.contentSnippet ?? item.content ?? '',
    url,
    score: rating,
    created_at: item.pubDate ? new Date(item.pubDate) : new Date(),
    raw: item,
  };
}

async function fetchViaRss(domain) {
  const feedUrl = `https://www.trustpilot.com/review/${domain}/rss`;
  const feed = await parser.parseURL(feedUrl);
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const all = (feed.items ?? []).map(item => normalize(item, domain));
  return all.filter(p => p.created_at.getTime() >= cutoff);
}

async function fetchViaFirecrawl(domain, apiKey) {
  const url = `https://www.trustpilot.com/review/${domain}`;
  const text = await firecrawlScrape(url, apiKey);
  if (!text) return [];
  // Parse basic review blocks from markdown
  const blocks = text.split(/---|\n\n/).filter(b => b.trim().length > 50);
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const results = [];
  for (const block of blocks.slice(0, 20)) {
    const dateMatch = block.match(/(\d{1,2}\s+\w+\s+\d{4})/);
    const created_at = dateMatch ? new Date(dateMatch[1]) : new Date();
    if (isNaN(created_at.getTime()) || created_at.getTime() < cutoff) continue;
    const idBase = createHash('md5').update(block.slice(0, 100)).digest('hex');
    results.push({
      id: `trustpilot_${idBase}`,
      source: 'trustpilot',
      author: 'Anonymous',
      title: block.slice(0, 80).trim(),
      body: block.trim(),
      url: `https://www.trustpilot.com/review/${domain}`,
      score: 0,
      created_at,
    });
  }
  return results;
}

// Accept { config } where config.domains is an array of business domains (e.g. ["example.com"])
export async function fetchTrustpilot({ config = {} } = {}) {
  const domains = Array.isArray(config.domains) && config.domains.length
    ? config.domains
    : [];

  if (!domains.length) {
    console.log('[trustpilot] no domains configured, skipping');
    return [];
  }

  const allPosts = [];
  const seen = new Set();

  for (const domain of domains) {
    // Strategy 1: RSS feed (most reliable, no auth, real-time)
    try {
      const posts = await fetchViaRss(domain);
      for (const p of posts) {
        if (!seen.has(p.id)) { seen.add(p.id); allPosts.push(p); }
      }
      console.log(`[trustpilot] ${domain} OK via RSS — ${posts.length} reviews`);
      continue;
    } catch (err) {
      console.warn(`[trustpilot] ${domain} RSS failed: ${err.message}`);
    }

    // Strategy 2: firecrawl scrape
    const firecrawlKey = getFirecrawlKey();
    if (firecrawlKey) {
      try {
        const posts = await fetchViaFirecrawl(domain, firecrawlKey);
        for (const p of posts) {
          if (!seen.has(p.id)) { seen.add(p.id); allPosts.push(p); }
        }
        console.log(`[trustpilot] ${domain} OK via firecrawl — ${posts.length} reviews`);
      } catch (err) {
        console.warn(`[trustpilot] ${domain} firecrawl failed: ${err.message}`);
      }
    }
  }

  console.log(`[trustpilot] OK — ${allPosts.length} total posts`);
  return allPosts;
}

export default fetchTrustpilot;
