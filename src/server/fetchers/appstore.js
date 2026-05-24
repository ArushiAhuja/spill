const TIMEOUT_MS = 15_000

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)
  )])
}

function normalize(entry, appId) {
  const text = entry['im:name']?.label || entry.content?.label || ''
  const rating = parseInt(entry['im:rating']?.label || '0', 10)
  return {
    id: `appstore_${entry.id?.label || Math.random().toString(36).slice(2)}`,
    source: 'appstore',
    author: entry.author?.name?.label || 'Anonymous',
    title: (entry.title?.label || text).slice(0, 80),
    body: text,
    url: `https://apps.apple.com/app/id${appId}`,
    score: rating,
    created_at: entry.updated?.label ? new Date(entry.updated.label) : new Date(),
    raw: entry,
  }
}

export async function fetchAppstore({ config = {} } = {}) {
  const appIds = Array.isArray(config.app_ids) && config.app_ids.length ? config.app_ids : []
  if (!appIds.length) { console.log('[appstore] no app_ids configured, skipping'); return [] }

  const allPosts = []
  const seen = new Set()
  const country = config.country || 'in'

  for (const appId of appIds) {
    try {
      const url = `https://itunes.apple.com/${country}/rss/customerreviews/id=${appId}/sortBy=mostRecent/json`
      const res = await withTimeout(fetch(url), TIMEOUT_MS)
      if (!res.ok) { console.warn(`[appstore] ${appId} HTTP ${res.status}`); continue }
      const json = await res.json()
      const entries = json.feed?.entry || []
      const reviews = Array.isArray(entries) ? entries.slice(1) : []
      for (const entry of reviews) {
        const post = normalize(entry, appId)
        if (!seen.has(post.id)) { seen.add(post.id); allPosts.push(post) }
      }
      console.log(`[appstore] ${appId} OK — ${reviews.length} reviews`)
    } catch (err) {
      console.warn(`[appstore] ${appId} failed: ${err.message}`)
    }
  }

  console.log(`[appstore] OK — ${allPosts.length} total posts`)
  return allPosts
}

export default fetchAppstore
