/**
 * Smoke-test each fetcher type to confirm data is flowing.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(__dirname, '../.env.local');
for (const line of readFileSync(envFile, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
  if (m) process.env[m[1]] = m[2];
}

// Test Google News RSS
console.log('\n=== Google News RSS ===');
try {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent('Swiggy India food delivery')}&hl=en-IN&gl=IN&ceid=IN:en`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const xml = await res.text();
  const items = xml.match(/<item>/g) || [];
  const titles = [...xml.matchAll(/<title><!\[CDATA\[([^\]]+)\]/)].slice(0, 3).map(m => m[1]);
  console.log(`✓ ${items.length} items. Sample: ${titles.join(' | ')}`);
} catch (e) {
  console.log(`✗ ${e.message}`);
}

// Test Twitter bearer
console.log('\n=== Twitter API ===');
try {
  const token = process.env.TWITTER_BEARER_TOKEN;
  const q = encodeURIComponent('"Swiggy" -is:retweet lang:en');
  const res = await fetch(
    `https://api.twitter.com/2/tweets/search/recent?query=${q}&max_results=10&tweet.fields=public_metrics,created_at&expansions=author_id&user.fields=public_metrics`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) }
  );
  const data = await res.json();
  if (data.data) {
    console.log(`✓ ${data.data.length} tweets. Sample: "${data.data[0]?.text?.slice(0, 80)}..."`);
  } else {
    console.log(`✗ API error: ${JSON.stringify(data).slice(0, 200)}`);
  }
} catch (e) {
  console.log(`✗ ${e.message}`);
}

// Test Reddit
console.log('\n=== Reddit RSS ===');
try {
  const url = `https://www.reddit.com/search.json?q=swiggy&sort=new&limit=5&t=day`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'SpillBot/1.0' },
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json();
  const posts = data?.data?.children || [];
  console.log(`✓ ${posts.length} posts. Sample: "${posts[0]?.data?.title?.slice(0, 80)}"`);
} catch (e) {
  console.log(`✗ ${e.message}`);
}

// Test Play Store (quick check with Swiggy)
console.log('\n=== Play Store ===');
try {
  const { default: gplay } = await import('google-play-scraper');
  const reviews = await Promise.race([
    gplay.reviews({ appId: 'in.swiggy.android', num: 5, sort: gplay.sort.NEWEST }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000)),
  ]);
  const list = reviews?.data || reviews || [];
  console.log(`✓ ${list.length} reviews. Sample: "${(list[0]?.text || '').slice(0, 80)}"`);
} catch (e) {
  console.log(`✗ ${e.message}`);
}

console.log('\n=== HackerNews ===');
try {
  const res = await fetch('https://hn.algolia.com/api/v1/search?query=swiggy&tags=story&numericFilters=created_at_i>1700000000&hitsPerPage=5', {
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json();
  console.log(`✓ ${data.hits?.length || 0} hits. Sample: "${data.hits?.[0]?.title?.slice(0, 80) || 'none'}"`);
} catch (e) {
  console.log(`✗ ${e.message}`);
}
