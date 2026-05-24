import { createHash } from 'crypto';
import Parser from 'rss-parser';

const TIMEOUT_MS = 10_000;

const parser = new Parser({
  customFields: { item: [['dc:creator', 'dcCreator']] },
  requestOptions: { timeout: TIMEOUT_MS },
});

function stripHtml(html = '') {
  return html.replace(/<[^>]*>/g, '').trim();
}

function makeNormalizer(source) {
  return function (item) {
    const url = item.link ?? item.guid ?? '';
    const id = createHash('md5').update(url).digest('hex');
    return {
      id: `${source}_${id}`,
      source,
      author: item.creator ?? item.dcCreator ?? item.author ?? 'Unknown',
      title: item.title ?? '',
      body: stripHtml(item.contentSnippet ?? item.content ?? ''),
      url,
      score: 0,
      created_at: item.pubDate ? new Date(item.pubDate) : new Date(),
      raw: item,
    };
  };
}

async function parseFeed(url, label) {
  const feed = await parser.parseURL(url);
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const all = (feed.items ?? []).map(makeNormalizer('google_news'));
  const posts = all.filter(p => p.created_at >= cutoff);
  console.log(`[rss:${label}] OK — ${posts.length}/${all.length} posts (last 24h)`);
  return posts;
}

// Accept { config } where config.rss_urls is an array of RSS feed URLs
export async function fetchNews({ config = {} } = {}) {
  const rssUrls = Array.isArray(config.rss_urls) && config.rss_urls.length
    ? config.rss_urls
    : [];

  if (!rssUrls.length) {
    console.log('[rss] no rss_urls configured, skipping');
    return [];
  }

  const results = [];
  const seenIds = new Set();

  for (const url of rssUrls) {
    let label = url;
    try { label = new URL(url).searchParams.get('q') || new URL(url).hostname; } catch {}
    try {
      const posts = await parseFeed(url, label);
      for (const post of posts) {
        if (!seenIds.has(post.id)) {
          seenIds.add(post.id);
          results.push(post);
        }
      }
    } catch (err) {
      console.warn(`[rss:${label}] FAILED: ${err.message}`);
    }
  }

  return results;
}

export default fetchNews;
