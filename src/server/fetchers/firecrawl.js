const ENDPOINT = 'https://api.firecrawl.dev/v1/scrape';
const TIMEOUT_MS = 30_000;

export function getFirecrawlKey(credentials = {}) {
  return process.env.FIRECRAWL_API_KEY || credentials.firecrawl_api_key || null;
}

export async function firecrawlScrape(url, apiKey, { waitFor = 2000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, formats: ['markdown'], waitFor }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Firecrawl ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.data?.markdown || data.markdown || '';
  } finally {
    clearTimeout(timer);
  }
}
