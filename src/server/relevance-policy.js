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

/**
 * First distinctive token of a multi-word org name (e.g. "chimes" from
 * "Chimes Aviation Academy"). Alone it is homonym-risky; only use via
 * contextualBrandMatch / isExternalBrandMention with co-signals.
 */
export function primaryBrandMoniker(orgName) {
  const words = (orgName || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  const significant = words.filter(w => w.length >= 5 && !SKIP_PREFIXES.has(w));
  // Only monikers from multi-word brands — single-word brands are already in brandKeyword.
  if (words.filter(w => w.length >= 3 && !SKIP_PREFIXES.has(w)).length < 2) return null;
  return significant[0] || null;
}

/** Strip Reddit/HTML noise so brand matchers and agents see readable text. */
export function stripHtmlNoise(text = '') {
  // Decode entities FIRST — Reddit often stores &lt;div&gt; instead of <div>
  let s = String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#\d+;/g, ' ');
  return s
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const GENERIC_INTENT_SIGNALS = [
  'applied', 'application', 'admission', 'admissions', 'enroll', 'enrolment', 'enrollment',
  'batch', 'result', 'results', 'interview', 'waitlist', 'waiting',
  'selection', 'intake', 'joining', 'fee', 'fees', 'campus', 'review',
  'experience', 'got in', 'rejected', 'shortlist', 'counselling', 'counseling',
  'icpp', 'icp', 'adapt', 'cadet', 'cpl', 'atpl', 'pilot', 'flying', 'aviation',
  'academy', 'dgca', 'training', 'ground school', 'flight school',
];

/** Industry / training URLs and text signals that make a moniker brand-safe. */
const INDUSTRY_URL_RE = /cadet|pilot|aviation|flying|dgca|igia|flight|cpl|atpl|academy|admission|icpp?|adapt|ground.?school|flight.?school|indianaviation/i;
const INDUSTRY_TEXT_RE = /\b(aviation|pilot|cadet|flying|flight school|ground school|dgca|cpl|atpl|icpp?|adapt|admission|admissions|academy|applicant|allotted)\b/i;

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
  const cleaned = stripHtmlNoise(text);
  return brandTerms.some((term) => {
    if (!term || term.length < 3) return false;
    // Programme codes: ICPP / ICP13 / ICP-13 should match intel term "icpp" or "icp"
    if (/^icpp?$/i.test(term)) {
      return /\bicp\s*p?\s*-?\s*\d*\b/i.test(cleaned);
    }
    if (/^adapt$/i.test(term)) {
      return /\badapt\b/i.test(cleaned);
    }
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(cleaned);
  });
}

/**
 * Co-signals that make a bare primary moniker ("Chimes") brand-safe rather
 * than an English homonym ("the church bell chimes").
 */
export function brandContextSignals(org = {}, intel = {}, brandTerms = []) {
  const signals = new Set();
  const push = (v) => {
    const t = String(v || '').toLowerCase().trim();
    if (t && t.length >= 3) signals.add(t);
  };
  const nameWords = String(org.name || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
  for (const w of nameWords) {
    if (w.length >= 4 && !SKIP_PREFIXES.has(w)) push(w);
  }
  // Multi-word brand terms are strong cosignals when co-present with moniker
  for (const term of brandTerms || []) {
    if (term && term.includes(' ')) push(term);
    else if (term && term.length >= 3) push(term);
  }
  for (const list of [
    intel.brandKeywords,
    intel.productKeywords,
    intel.industryVocabulary,
    intel.operationalRiskQueries,
    intel.typicalComplaints,
  ]) {
    for (const item of list || []) push(item);
  }
  // Intention verbs for academy / admissions orgs
  for (const g of GENERIC_INTENT_SIGNALS) signals.add(g);
  return [...signals];
}

/**
 * True when primary moniker appears with industry / product / admissions context
 * (or on an aviation/training URL path), not as a naked English word.
 */
export function contextualBrandMonikerMatch(post = {}, org = {}, intel = {}, brandTerms = []) {
  const moniker = primaryBrandMoniker(org.name);
  if (!moniker) return false;
  const blob = stripHtmlNoise(`${post.title || ''} ${post.body || ''} ${post.url || ''} ${post.publisher || ''}`);
  const monikerRe = new RegExp(`\\b${moniker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  if (!monikerRe.test(blob)) return false;

  const hostRoot = normalizeHostname(org.website)?.split('.')[0] || '';
  // Domain embeds moniker (chimesaviation) → brand site root backs moniker usage
  const domainEmbeds = hostRoot && hostRoot.includes(moniker);
  const title = stripHtmlNoise(post.title || '').toLowerCase();
  const titleIsMoniker = title === moniker
    || title === `${moniker}!`
    || new RegExp(`^${moniker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[!?.…\\s]*$`, 'i').test(title);
  const titleHasMoniker = monikerRe.test(title);
  const titleLeadsWithMoniker = new RegExp(`^${moniker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(title);

  const cosignals = brandContextSignals(org, intel, brandTerms)
    .filter(s => s !== moniker && !s.startsWith(moniker + ' '));
  const hasCosignal = cosignals.some((s) => {
    if (s.length < 3) return false;
    if (GENERIC_INTENT_SIGNALS.includes(s)) {
      return blob.toLowerCase().includes(s);
    }
    const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(escaped, 'i').test(blob);
  });

  const urlIndustry = INDUSTRY_URL_RE.test(post.url || '');
  const textIndustry = INDUSTRY_TEXT_RE.test(blob);

  if (hasCosignal) return true;
  // Moniker on industry forum / aviation URL (any moniker in title or body)
  if (urlIndustry) return true;
  // Moniker + industry wording anywhere in post
  if (textIndustry) return true;
  if (domainEmbeds && (titleIsMoniker || titleLeadsWithMoniker || titleHasMoniker)) return true;
  if ((titleIsMoniker || titleLeadsWithMoniker) && /appl|admiss|enroll|result|batch|wait|icpp|icp|\bcaa\b|feedback|review|fee|pilot|training/i.test(blob)) {
    return true;
  }
  return false;
}

/**
 * Deterministic keep rules written from operator overrides / feedback.
 * These are policy, not LLM few-shot — they always win.
 */
export function matchesLearnedKeepRule(post = {}, intel = {}) {
  const rules = Array.isArray(intel.learnedKeepRules) ? intel.learnedKeepRules : [];
  if (!rules.length) return false;
  const blob = stripHtmlNoise(`${post.title || ''} ${post.body || ''} ${post.url || ''}`).toLowerCase();
  const title = stripHtmlNoise(post.title || '').toLowerCase();

  for (const rule of rules) {
    if (!rule || rule.active === false) continue;

    if (rule.exact_title) {
      const et = String(rule.exact_title).toLowerCase().trim();
      if (et && title === et) return true;
      // Soft match: title contains exact historical title (handles punctuation drift)
      if (et.length >= 4 && title.includes(et)) return true;
    }

    if (rule.phrase) {
      const phrase = String(rule.phrase).toLowerCase().trim();
      if (phrase.length >= 3 && blob.includes(phrase)) {
        const req = Array.isArray(rule.requires) ? rule.requires.map(r => String(r).toLowerCase()) : [];
        if (!req.length || req.some(r => blob.includes(r))) return true;
      }
    }

    if (rule.moniker) {
      const m = String(rule.moniker).toLowerCase().trim();
      if (m.length < 4) continue;
      if (!new RegExp(`\\b${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(blob)) continue;
      const req = Array.isArray(rule.requires) ? rule.requires.map(r => String(r).toLowerCase()) : [];
      const industry = INDUSTRY_URL_RE.test(post.url || '') || INDUSTRY_TEXT_RE.test(blob);
      if (req.some(r => blob.includes(r))) return true;
      if (rule.force_moniker && industry) return true;
    }
  }
  return false;
}

/**
 * Build a keep-rule from an operator-surfaced post so the next cycle does not
 * need the LLM to rediscover it.
 */
export function buildKeepRuleFromPost({ post = {}, org = {}, note = '' } = {}) {
  const moniker = primaryBrandMoniker(org.name);
  const blob = stripHtmlNoise(`${post.title || ''} ${post.body || ''}`);
  const lower = blob.toLowerCase();
  const requires = GENERIC_INTENT_SIGNALS.filter(s => s.length >= 4 && lower.includes(s)).slice(0, 8);
  const title = stripHtmlNoise(post.title || '').slice(0, 200);
  const rule = {
    id: `keep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    source: 'operator_override',
    moniker: moniker || null,
    phrase: null,
    exact_title: title || null,
    requires,
    force_moniker: !!(moniker && (requires.length || INDUSTRY_URL_RE.test(post.url || '') || INDUSTRY_TEXT_RE.test(blob))),
    note: String(note || '').slice(0, 300) || null,
    sample_title: title || null,
    created_at: new Date().toISOString(),
    active: true,
  };
  // Also capture multi-word brand when present
  const full = String(org.name || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  if (full && lower.includes(full)) rule.phrase = full;
  else if (moniker && lower.includes(moniker)) {
    // secondary phrase from first two name words
    const two = brandKeyword(org.name);
    if (two && two.includes(' ') && lower.includes(two)) rule.phrase = two;
  }
  return rule;
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
  if (matchesLearnedKeepRule(post, intel)) return true;
  const text = `${post.title || ''} ${post.body || ''} ${post.publisher || ''}`;
  if (textMentionsBrand(text, brandTerms) || isBrandQueryPositive(post, brandTerms)) return true;
  return contextualBrandMonikerMatch(post, org, intel, brandTerms);
}
