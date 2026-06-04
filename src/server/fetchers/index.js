import { fetchReddit } from './reddit.js';
import { fetchHackernews } from './hackernews.js';
import { fetchNews } from './news.js';
import { fetchPlaystore } from './playstore.js';
import { fetchTwitter } from './twitter.js';
import { fetchAppstore } from './appstore.js';
import { fetchLinkedIn } from './linkedin.js';

export async function fetchAll(orgConfig) {
  const tasks = [];
  const { sources } = orgConfig;

  if (sources.reddit?.enabled) tasks.push(fetchReddit(sources.reddit));
  if (sources.hackernews?.enabled) tasks.push(fetchHackernews(sources.hackernews));
  if (sources.google_news?.enabled) tasks.push(fetchNews(sources.google_news));
  if (sources.playstore?.enabled) tasks.push(fetchPlaystore(sources.playstore));
  if (sources.twitter?.enabled) tasks.push(fetchTwitter(sources.twitter));
  if (sources.appstore?.enabled) tasks.push(fetchAppstore(sources.appstore));
  if (sources.linkedin?.enabled) tasks.push(fetchLinkedIn(sources.linkedin));

  const results = await Promise.allSettled(tasks);

  const allPosts = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      allPosts.push(...result.value);
    } else {
      console.error('fetcher error:', result.reason?.message);
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
