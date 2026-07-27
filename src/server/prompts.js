import { query } from './db.js';

export const PROMPT_KEYS = ['relevance_filter', 'classifier_system', 'classifier_scoring', 'response_writer', 'intel_extraction'];

export const DEFAULT_PROMPTS = {
  relevance_filter: {
    name: 'Relevance Filter',
    description: 'Criteria for deciding which posts are worth classifying. Applied before the classifier to drop noise early.',
    content: `Include a post ONLY if it:
- Directly mentions or is clearly about this company, its products, or its services
- Discusses customer experience (positive or negative) with this company specifically
- Covers operational failures — refunds, service quality, safety, delays, fraud — involving this company
- Reports industry events, regulations, or competitor moves that would concern this company's leadership
- Contains purchasing intent, reviews, or comparisons that involve this company

Exclude if:
- The company name or keyword appears only incidentally or in an unrelated context
- It's about a different company or industry with no connection to this one
- It's generic content that happens to share a keyword but is about something else entirely
- It's from a geography with no operational relevance to this company
- It's personal or lifestyle content with no commercial signal`,
  },

  classifier_system: {
    name: 'Classifier Role',
    description: 'System persona sent to the AI classifier. Sets the model\'s role and output format expectation.',
    content: `You are a brand intelligence classifier for a company monitoring system. Your job is to classify social media posts and assess their operational risk. Return ONLY valid JSON, no explanation.`,
  },

  classifier_scoring: {
    name: 'Scoring & Escalation Rules',
    description: 'Defines how the four escalation dimensions are scored and when response templates are generated. Raise or lower thresholds here.',
    content: `Scoring guidance:
- customer_impact: 0=no direct customer harm, 5=significant frustration/loss, 10=injury/mass financial harm/death
- operational_urgency: 0=informational only, 5=team should review today, 10=requires response within the hour
- trust_risk: 0=neutral or positive, 5=notable credibility concern, 10=viral scandal/fraud allegation/regulatory breach
- virality_potential: 0=niche or low-traffic post, 5=moderate engagement, 10=trending or likely to break into mainstream media

Rules:
- is_relevant: true ONLY if the post genuinely concerns this company's products, services, customers, or brand. Set false if the company appears incidentally or the post is about an unrelated topic. Apply learned exclusions strictly.
- category_id: best matching category ID from the list above. null if not relevant or no match.
- response_template: for posts with customer_impact >= 4 OR operational_urgency >= 4, write a 2-3 sentence empathetic public response the company could post. null otherwise.
- location_tag: if the post clearly mentions a city/region (Delhi, Mumbai, Bengaluru, Hyderabad, Chennai, Pune, etc.), extract it. null otherwise.`,
  },

  response_writer: {
    name: 'Response Writer',
    description: 'Instructions for generating customer-facing ticket responses. Tune tone, length, and approach here.',
    content: `Write a public-facing customer response. Keep it under 280 characters if the channel is Twitter/social media. Be specific — do not use canned phrases. Acknowledge the issue directly without minimising it. State what we are doing or will do next. Do not make promises you cannot keep. Match the urgency and formality of the original message.`,
  },

  intel_extraction: {
    name: 'Intelligence Extraction',
    description: 'Rules for deriving the company intelligence profile during onboarding. Determines what spill learns about the company.',
    content: `Rules for intel_profile:
- brandKeywords: 2-5 exact phrases/names people use online (include common misspellings, short names, old names)
- productKeywords: 3-8 specific product/service terms customers use when discussing this company
- customerPainPoints: 5-10 complaint phrases customers use verbatim (e.g. "refund not received", "support not responding")
- typicalComplaints: 5-10 recurring complaint patterns as short verb phrases (e.g. "refund not processed after 30 days", "app crashes on payment")
- operationalRiskQueries: 5-8 searches that surface operational failures for this type of company
- customerIntentQueries: 5-8 searches customers run when looking for or discussing this company's services
- highRiskTopics: 3-6 regulatory/safety/fraud terms specific to this industry
- industryVocabulary: 4-8 technical or industry-specific terms that appear in relevant posts but not in general conversation
- geographyTerms: 2-4 geographic terms relevant to this company's operations
- exclusionTerms: 1-5 words that when present indicate the post is NOT about this company (e.g. homonyms, unrelated brands with same name)
- icpDescription: ONE sentence — who their ideal customer is, what they need, and why they choose this company
- brandVoice: ONE sentence — tone and approach for public communications
- competitorContext: ONE sentence — main competitors and this company's positioning`,
  },
};

// In-memory cache: orgId → { key → { content, cachedAt } }
const _cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKey(orgId, key) { return `${orgId}:${key}`; }

export function clearPromptCache(orgId, key = null) {
  if (key) {
    _cache.delete(cacheKey(orgId, key));
  } else {
    for (const k of _cache.keys()) {
      if (k.startsWith(`${orgId}:`)) _cache.delete(k);
    }
  }
}

// Returns the prompt content string. Falls back to DEFAULT_PROMPTS if no org override exists.
// Reads from DB and caches for CACHE_TTL_MS. Never throws — falls back to default on error.
export async function getPrompt(orgId, key) {
  const def = DEFAULT_PROMPTS[key];
  if (!def) return '';

  const ck = cacheKey(orgId, key);
  const cached = _cache.get(ck);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.content;

  try {
    const { rows } = await query(
      'SELECT content FROM prompts WHERE org_id = $1 AND prompt_key = $2',
      [orgId, key]
    );
    const content = rows[0]?.content ?? def.content;
    _cache.set(ck, { content, cachedAt: Date.now() });
    return content;
  } catch {
    return def.content;
  }
}

// Used by the trace layer. Keep this separate from getPrompt so the hot path
// retains its small string-only cache contract.
export async function getPromptMetadata(orgId, key) {
  const def = DEFAULT_PROMPTS[key];
  if (!def) return { content: '', version: 0, isDefault: true };
  try {
    const { rows } = await query('SELECT content, version FROM prompts WHERE org_id=$1 AND prompt_key=$2', [orgId, key]);
    return rows[0] ? { content: rows[0].content, version: rows[0].version, isDefault: false } : { content: def.content, version: 0, isDefault: true };
  } catch {
    return { content: def.content, version: 0, isDefault: true };
  }
}

// Fetch all prompts for an org — merges DB overrides with defaults.
// Returns array of { prompt_key, name, description, content, version, updated_by, updated_at, is_default }
export async function listPrompts(orgId) {
  const { rows: dbRows } = await query(
    'SELECT prompt_key, name, description, content, version, updated_by, updated_at FROM prompts WHERE org_id = $1',
    [orgId]
  );
  const dbMap = Object.fromEntries(dbRows.map(r => [r.prompt_key, r]));

  return PROMPT_KEYS.map(key => {
    const def = DEFAULT_PROMPTS[key];
    const db = dbMap[key];
    return {
      prompt_key: key,
      name: def.name,
      description: def.description,
      content: db?.content ?? def.content,
      version: db?.version ?? 0,
      updated_by: db?.updated_by ?? null,
      updated_at: db?.updated_at ?? null,
      is_default: !db,
    };
  });
}

// Save a new version of a prompt. Creates a version history entry.
// Returns the updated row.
export async function savePrompt(orgId, key, content, authorEmail = null, changeSummary = null) {
  const def = DEFAULT_PROMPTS[key];
  if (!def) throw new Error(`unknown prompt key: ${key}`);

  const { rows: existing } = await query(
    'SELECT content, version FROM prompts WHERE org_id = $1 AND prompt_key = $2',
    [orgId, key]
  );

  const oldContent = existing[0]?.content ?? def.content;
  const oldVersion = existing[0]?.version ?? 0;
  const newVersion = oldVersion + 1;

  if (existing.length) {
    await query(
      `UPDATE prompts SET content = $1, version = $2, updated_by = $3, updated_at = NOW()
       WHERE org_id = $4 AND prompt_key = $5`,
      [content, newVersion, authorEmail, orgId, key]
    );
  } else {
    await query(
      `INSERT INTO prompts (org_id, prompt_key, name, description, content, version, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [orgId, key, def.name, def.description, content, newVersion, authorEmail]
    );
  }

  await query(
    `INSERT INTO prompt_versions (org_id, prompt_key, version, author_email, change_summary, old_content, new_content)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [orgId, key, newVersion, authorEmail, changeSummary, oldContent, content]
  );

  clearPromptCache(orgId, key);

  const { rows: [updated] } = await query(
    'SELECT * FROM prompts WHERE org_id = $1 AND prompt_key = $2',
    [orgId, key]
  );
  return updated;
}

// Reset a prompt to its default content. Creates a version entry for audit.
export async function resetPrompt(orgId, key, authorEmail = null) {
  const def = DEFAULT_PROMPTS[key];
  if (!def) throw new Error(`unknown prompt key: ${key}`);
  return savePrompt(orgId, key, def.content, authorEmail, 'reset to default');
}

// Get version history for a prompt key.
export async function getPromptVersions(orgId, key, limit = 30) {
  const { rows } = await query(
    `SELECT id, version, author_email, change_summary, old_content, new_content, created_at
     FROM prompt_versions
     WHERE org_id = $1 AND prompt_key = $2
     ORDER BY version DESC
     LIMIT $3`,
    [orgId, key, limit]
  );
  return rows;
}

// Rollback a prompt to a specific historical version.
export async function rollbackPrompt(orgId, key, targetVersion, authorEmail = null) {
  const { rows } = await query(
    'SELECT new_content FROM prompt_versions WHERE org_id = $1 AND prompt_key = $2 AND version = $3',
    [orgId, key, targetVersion]
  );
  if (!rows.length) throw new Error(`version ${targetVersion} not found`);
  return savePrompt(orgId, key, rows[0].new_content, authorEmail, `rolled back to v${targetVersion}`);
}
