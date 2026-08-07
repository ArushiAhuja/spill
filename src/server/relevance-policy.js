/**
 * Org-agnostic relevance helpers used by the scheduler before LLM gates.
 * Keep these pure and deterministic so they can be unit-tested without OpenAI/DB.
 */

const SKIP_PREFIXES = new Set([
  'the', 'a', 'an', 'my', 'our', 'for', 'and', 'by', 'of', 'in', 'at',
  'india', 'indian', 'pvt', 'ltd', 'inc', 'llc', 'co', 'corp', 'academy',
  'company', 'group', 'private', 'limited',
]);

const SOCIAL_HOST_PATTERNS = [
  { host: /(?:^|\.)twitter\.com$/i, pathRe: /^\/@?([^/?#]+)/i },
  { host: /(?:^|\.)x\.com$/i, pathRe: /^\/@?([^/?#]+)/i },
  { host: /(?:^|\.)linkedin\.com$/i, pathRe: /^\/(?:company|in|school)\/([^/?#]+)/i },
  { host: /(?:^|\.)instagram\.com$/i, pathRe: /^\/([^/?#]+)/i },
  { host: /(?:^|\.)facebook\.com$/i, pathRe: /^\/([^/?#]+)/i },
  { host: /(?:^|\.)youtube\.com$/i, pathRe: /^\/(?:@|c\/|channel\/|user\/)?([^/?#]+)/i },
  { host: /(?:^|\.)reddit\.com$/i, pathRe: /^\/(?:u|user)\/([^/?#]+)/i },
];

export function brandKeyword(orgName) {
  const words = (orgName || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  const significant = words.filter(w => w.length >= 4 && !SKIP_PREFIXES.has(w));
  if (significant.length >= 2) return significant.slice(0, 2).join(' ');
  if (significant.length === 1) return significant[0];
  return words.sort((a, b) => b.length - a.length)[0] || null;
}

export function normalizeHostname(raw) {
  if (!raw) return null;
  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const host = new URL(withProto).hostname.toLowerCase().replace(/^www\./, '');
    return host || null;
  } catch {
    return String(raw).toLowerCase().replace(/^www\./, '').split('/')[0] || null;
  }
}

export function buildBrandTerms({ name, website }, intel = {}) {
  const terms = new Set();
  const brand = brandKeyword(name);
  if (brand) terms.add(brand);
  if (name) {
    const full = name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    if (full.length >= 4) terms.add(full);
  }
  for (const kw of (intel.brandKeywords || [])) {
    const t = String(kw || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    if (t.length >= 3) terms.add(t);
  }
  // Soft aliases: multi-word parent brands (e.g. "chimes aviation academy" → "chimes aviation").
  // Intentionally skip single common first words ("chimes") — those cause homonym false positives.
  if (name) {
    const words = name.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length >= 3 && !SKIP_PREFIXES.has(w));
    if (words.length >= 2) terms.add(words.slice(0, 2).join(' '));
    if (words.length >= 3) terms.add(words.slice(0, 3).join(' '));
  }
  // Distinct website root (chimesaviation) is safer than the English word "chimes".
  const host = normalizeHostname(website);
  if (host) {
    const root = host.split('.')[0];
    if (root && root.length >= 6) terms.add(root);
  }
  return [...terms].filter(Boolean);
}

export function textMentionsBrand(text, brandTerms = []) {
  if (!text || !brandTerms.length) return false;
  return brandTerms.some((term) => {
    if (!term || term.length < 3) return false;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
  });
}

export function collectOfficialHandles(org = {}, sourceConfigs = [], intel = {}) {
  const handles = new Set();
  const push = (v) => {
    const h = String(v || '').trim().toLowerCase().replace(/^@/, '').replace(/\/+$/, '');
    if (h && h.length >= 2) handles.add(h);
  };

  for (const h of (intel.companyHandles || intel.official_handles || [])) push(h);
  for (const h of (org.official_handles || [])) push(h);

  // Derive a handle from name/website when not configured
  const nameSlug = (org.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
  if (nameSlug.length >= 4) push(nameSlug);
  const hostRoot = normalizeHostname(org.website)?.split('.')[0];
  if (hostRoot) push(hostRoot);

  for (const sc of sourceConfigs || []) {
    const cfg = sc.config || {};
    for (const h of (cfg.company_handles || [])) push(h);
    for (const h of (cfg.handles || [])) push(h);
    for (const h of (cfg.official_handles || [])) push(h);
    if (cfg.username) push(cfg.username);
    if (cfg.account) push(cfg.account);
  }
  return handles;
}

export function collectOfficialDomains(org = {}, intel = {}) {
  const domains = new Set();
  const host = normalizeHostname(org.website);
  if (host) domains.add(host);
  for (const d of (intel.officialDomains || intel.owned_domains || [])) {
    const n = normalizeHostname(d);
    if (n) domains.add(n);
  }
  for (const d of (org.official_domains || [])) {
    const n = normalizeHostname(d);
    if (n) domains.add(n);
  }
  return domains;
}

function hostMatchesOfficial(host, officialDomains) {
  if (!host || !officialDomains?.size) return false;
  for (const d of officialDomains) {
    if (host === d || host.endsWith(`.${d}`)) return true;
  }
  return false;
}

function socialPathIsOfficial(url, officialHandles) {
  if (!url || !officialHandles?.size) return false;
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    for (const { host: hostRe, pathRe } of SOCIAL_HOST_PATTERNS) {
      if (!hostRe.test(host)) continue;
      const m = u.pathname.match(pathRe);
      if (!m?.[1]) continue;
      const handle = m[1].toLowerCase().replace(/^@/, '');
      if (officialHandles.has(handle)) return true;
    }
  } catch { /* ignore bad urls */ }
  return false;
}

/**
 * Self-published content is material the organisation itself published
 * (own website, own social accounts). External press and third-party posts
 * that mention the brand remain relevant.
 */
export function isSelfPublished(post = {}, org = {}, sourceConfigs = [], intel = {}) {
  const officialDomains = collectOfficialDomains(org, intel);
  const officialHandles = collectOfficialHandles(org, sourceConfigs, intel);

  const urlHost = normalizeHostname(post.url);
  if (hostMatchesOfficial(urlHost, officialDomains)) return true;

  // Publisher/author domain fields from news items
  const authorHost = normalizeHostname(post.author_domain || post.publisher_domain || '');
  if (hostMatchesOfficial(authorHost, officialDomains)) return true;

  if (socialPathIsOfficial(post.url, officialHandles)) return true;

  const author = String(post.author || '').toLowerCase().replace(/^@/, '').trim();
  if (author && officialHandles.has(author)) return true;
  // Author that clearly embeds the official domain root (e.g. "Chimes Aviation Academy")
  // is NOT treated as self-published unless also on official domain/handle —
  // external op-eds often name the company in the byline area.

  // Google News / RSS: if the final article host is the org site
  const canonicalHost = normalizeHostname(post.canonical_url || '');
  if (hostMatchesOfficial(canonicalHost, officialDomains)) return true;

  return false;
}

/**
 * Brand-query positive: item arrived via an explicit brand search (Google News
 * query, brand RSS label, etc.). Used as a strong tier-1 signal even when the
 * publisher title has been truncated or the brand token stripped.
 */
export function isBrandQueryPositive(post = {}, brandTerms = [], brandQueries = []) {
  if (post.brand_query_hit === true || post.query_brand_positive === true) return true;
  const q = String(post.matched_query || post.detected_query || '').toLowerCase();
  if (!q) return false;
  if (brandQueries.some(bq => bq && q.includes(String(bq).toLowerCase()))) return true;
  return textMentionsBrand(q, brandTerms);
}

export function isExternalBrandMention(post = {}, brandTerms = [], org = {}, sourceConfigs = [], intel = {}) {
  if (isSelfPublished(post, org, sourceConfigs, intel)) return false;
  const text = `${post.title || ''} ${post.body || ''} ${post.publisher || ''}`;
  return textMentionsBrand(text, brandTerms) || isBrandQueryPositive(post, brandTerms);
}
