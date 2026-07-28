import { query } from './db.js';
import { safeMonitoringConfig } from './prompts.js';
import { buildAgentPolicyContext } from './organization-agent-config.js';

const MAX_ITEMS = 12;
const BRIEFING_CACHE_MS = 5 * 60 * 1000;
const HUMAN_PROFILE_FIELDS = ['priority_issues', 'risk_categories', 'products_services', 'terminology', 'customer_segments', 'geographies', 'brand_voice', 'response_guidelines'];
const LEARNED_PROFILE_FIELDS = ['brandKeywords', 'productKeywords', 'customerPainPoints', 'typicalComplaints', 'operationalRiskQueries', 'customerIntentQueries', 'highRiskTopics', 'industryVocabulary', 'geographyTerms', 'exclusionTerms', 'icpDescription', 'brandVoice', 'competitorContext', 'boostTerms'];
const BRIEFING_STOPWORDS = new Set(['about', 'after', 'again', 'also', 'because', 'been', 'could', 'customer', 'customers', 'from', 'have', 'into', 'issue', 'just', 'more', 'notes', 'post', 'posts', 'should', 'that', 'their', 'there', 'they', 'this', 'user', 'with', 'would', 'your']);
const briefingCache = new Map();

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean).map(value => String(value).trim()).filter(Boolean).slice(0, MAX_ITEMS) : [];
}

function valueLines(profile, fields) {
  const lines = [];
  for (const field of fields) {
    const value = profile?.[field];
    const values = list(value);
    if (values.length) lines.push(`${field}: ${values.join('; ')}`);
    else if (typeof value === 'string' && value.trim()) lines.push(`${field}: ${value.trim().slice(0, 1200)}`);
  }
  return lines;
}

function compact(value, max = 420) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function redact(text) {
  return compact(text, 1000)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[phone]')
    .replace(/https?:\/\/[^\s)>]+/g, '[url]');
}

function topTerms(values, limit = 8) {
  const counts = new Map();
  for (const value of values || []) {
    for (const token of redact(value).toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || []) {
      if (!BRIEFING_STOPWORDS.has(token)) counts.set(token, (counts.get(token) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([term]) => term);
}

function roleDirective(agentName) {
  const directives = {
    source_understanding: 'Normalise source facts faithfully. Use organisation vocabulary to identify the company, but never infer missing source details.',
    relevance: 'Use the organisation boundary and reviewed outcomes to prioritise true customer/company signals while excluding recurring noise.',
    category: 'Use the organisation taxonomy and correction patterns to choose the most specific supported category; do not create categories from vague wording.',
    severity: 'Apply the organisation escalation policy, reviewed false-positive/under-escalation patterns, and category context. Never infer reach or impact without evidence.',
    summary: 'Write an executive summary in the organisation’s operating language. Focus on the recurring issue, customer impact, and next useful action; do not overstate causality.',
    trend: 'Detect repetition only among materially similar organisation-specific signals. Treat reviewed dismissals as counter-evidence, not a trend.',
    response_writer: 'Write a company-specific, empathetic response that reflects this organisation’s services, customer concerns, and voice. Acknowledge only evidenced concerns; never promise refunds, timelines, regulatory outcomes, or remediation that the organisation has not authorised.',
    intelligence_extraction: 'Turn current organisation evidence into structured monitoring intelligence. Preserve the distinction between human-approved information and Spill-inferred patterns.',
  };
  return directives[agentName] || 'Apply the organisation briefing only to the task assigned to this agent.';
}

function compactCompanyContext(org, categories) {
  const human = org.organization_profile || {};
  const learned = org.intel_profile || {};
  const lines = [];
  if (org.name) lines.push(`Organisation: ${compact(org.name, 160)}.`);
  if (org.description) lines.push(`Business context: ${compact(org.description, 520)}`);
  const approved = [
    ...list(human.priority_issues), ...list(human.risk_categories), ...list(human.products_services),
    ...list(human.terminology), ...list(human.response_guidelines),
  ].slice(0, 12);
  if (approved.length) lines.push(`Customer-approved focus: ${approved.join('; ')}.`);
  const inferred = [
    ...list(learned.customerPainPoints), ...list(learned.typicalComplaints), ...list(learned.highRiskTopics),
  ].slice(0, 12);
  if (inferred.length) lines.push(`Spill-inferred watch items: ${inferred.join('; ')}.`);
  const exclusions = list(learned.exclusionTerms).slice(0, 8);
  if (exclusions.length) lines.push(`Known exclusions: ${exclusions.join('; ')}.`);
  const taxonomy = categories.slice(0, 8).map(category => category.name).filter(Boolean);
  if (taxonomy.length) lines.push(`Configured categories: ${taxonomy.join('; ')}.`);
  return lines;
}

// Customer activity is intentionally converted into aggregate behavioural
// signals and deduplicated terms. Prompts get the learning, not a pasted dump
// of private post notes, feedback prose, or historic customer content.
export async function getOrganizationAgentBriefing({ orgId, agentName, org = null, categories = [], agentConfig = null } = {}) {
  if (!orgId) throw new Error('orgId is required for organisation briefing');
  const cacheKey = `${orgId}:${agentName}:${agentConfig?.version || 0}`;
  const cached = briefingCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < BRIEFING_CACHE_MS) return cached.value;

  const [activityResult, categoryResult, feedbackResult, noteResult] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE post_status='dismissed')::int AS dismissed,
         COUNT(*) FILTER (WHERE saved_at IS NOT NULL)::int AS saved,
         COUNT(*) FILTER (WHERE notes IS NOT NULL AND btrim(notes) <> '')::int AS noted,
         COUNT(*) FILTER (WHERE post_status='resolved')::int AS resolved,
         COUNT(*) FILTER (WHERE escalated=true)::int AS escalated
       FROM posts WHERE org_id=$1 AND created_at > NOW()-INTERVAL '180 days'`,
      [orgId]
    ),
    query(
      `SELECT COALESCE(c.name,'Uncategorised') AS category_name,COUNT(*)::int AS count,
         COUNT(*) FILTER (WHERE p.post_status='dismissed')::int AS dismissed,
         COUNT(*) FILTER (WHERE p.saved_at IS NOT NULL)::int AS saved
       FROM posts p LEFT JOIN categories c ON c.id=p.category_id
       WHERE p.org_id=$1 AND p.created_at > NOW()-INTERVAL '180 days'
       GROUP BY COALESCE(c.name,'Uncategorised') ORDER BY count DESC, category_name LIMIT 6`,
      [orgId]
    ),
    query(
      `SELECT f.label,COUNT(*)::int AS count,
         COALESCE(array_agg(DISTINCT c.name) FILTER (WHERE c.name IS NOT NULL),'{}') AS categories,
         COALESCE(array_agg(f.explanation) FILTER (WHERE f.explanation IS NOT NULL),'{}') AS reasons
       FROM post_feedback f
       LEFT JOIN posts p ON p.id=f.post_id LEFT JOIN categories c ON c.id=p.category_id
       WHERE f.org_id=$1 AND f.created_at > NOW()-INTERVAL '180 days'
       GROUP BY f.label ORDER BY count DESC LIMIT 10`,
      [orgId]
    ),
    query(
      `SELECT notes FROM posts WHERE org_id=$1 AND notes IS NOT NULL AND btrim(notes)<>''
       ORDER BY created_at DESC LIMIT 20`,
      [orgId]
    ),
  ]).catch(error => {
    console.warn('[organisation-briefing] behavioural context unavailable:', error.message);
    return [{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }];
  });

  const activity = activityResult.rows[0] || {};
  const lines = [
    'COMPACT ORGANISATION AGENT BRIEFING',
    `Agent role: ${roleDirective(agentName)}`,
    ...compactCompanyContext(org || {}, categories),
  ];
  const categoryPatterns = categoryResult.rows.map(row => {
    const outcomes = [row.dismissed ? `${row.dismissed} dismissed` : null, row.saved ? `${row.saved} saved` : null].filter(Boolean).join(', ');
    return `${row.category_name} (${row.count}${outcomes ? `; ${outcomes}` : ''})`;
  });
  if (categoryPatterns.length) lines.push(`Observed signal mix: ${categoryPatterns.join('; ')}.`);
  if (Number(activity.total || 0) > 0) {
    lines.push(`Operator outcomes (last 180 days): ${activity.total} signals; ${activity.dismissed || 0} dismissed; ${activity.saved || 0} saved; ${activity.noted || 0} noted; ${activity.resolved || 0} resolved; ${activity.escalated || 0} escalated.`);
  }
  const feedbackPatterns = feedbackResult.rows.map(row => {
    const categoryNames = Array.isArray(row.categories) && row.categories.length ? ` for ${row.categories.slice(0, 3).join(', ')}` : '';
    return `${String(row.label || 'unlabelled').replace(/_/g, ' ')} ×${row.count}${categoryNames}`;
  });
  if (feedbackPatterns.length) lines.push(`Reviewed feedback patterns: ${feedbackPatterns.join('; ')}.`);
  const feedbackThemes = topTerms(feedbackResult.rows.flatMap(row => row.reasons || []));
  if (feedbackThemes.length) lines.push(`Feedback themes (derived, not quoted): ${feedbackThemes.join(', ')}.`);
  const noteThemes = topTerms(noteResult.rows.map(row => row.notes));
  if (noteThemes.length) lines.push(`Operator note themes (derived, not quoted): ${noteThemes.join(', ')}.`);
  const policy = buildAgentPolicyContext(agentConfig);
  if (policy) lines.push(policy);
  lines.push('Use this as organisation-specific operating context. Treat it as guidance, not evidence about the individual customer; use runtime signal facts for claims about a case.');

  const value = lines.join('\n');
  briefingCache.set(cacheKey, { createdAt: Date.now(), value });
  return value;
}

export function invalidateOrganizationAgentBriefing(orgId) {
  for (const key of briefingCache.keys()) {
    if (key.startsWith(`${orgId}:`)) briefingCache.delete(key);
  }
}

export function buildOrganizationIntelligence({ org = {}, categories = [], sourceConfigs = [], agentConfig = null } = {}) {
  const humanProfile = org.organization_profile || {};
  const learnedProfile = org.intel_profile || {};
  const sections = [];

  const identity = [
    org.name ? `Company: ${org.name}` : null,
    org.description ? `Company description: ${org.description}` : null,
    org.website ? `Customer-supplied website: ${org.website}` : null,
    list(org.competitors).length ? `Competitors supplied by customer: ${list(org.competitors).join(', ')}` : null,
    list(org.partner_brands).length ? `Partners supplied by customer: ${list(org.partner_brands).join(', ')}` : null,
  ].filter(Boolean);
  if (identity.length) sections.push(`COMPANY IDENTITY\n${identity.map(line => `- ${line}`).join('\n')}`);

  const human = valueLines(humanProfile, HUMAN_PROFILE_FIELDS);
  if (human.length) sections.push(`HUMAN-APPROVED ORGANISATION INTELLIGENCE\n${human.map(line => `- ${line}`).join('\n')}`);

  const taxonomy = categories.slice(0, MAX_ITEMS).map(category => `${category.name}${category.description ? ` — ${category.description}` : ''}${category.severity != null ? ` (severity ${category.severity}/30)` : ''}`);
  if (taxonomy.length) sections.push(`MONITORING TAXONOMY\n${taxonomy.map(line => `- ${line}`).join('\n')}`);

  const learned = valueLines(learnedProfile, LEARNED_PROFILE_FIELDS);
  if (learned.length) sections.push(`SPILL-INFERRED INTELLIGENCE (use as evidence, not as an unsupported fact)\n${learned.map(line => `- ${line}`).join('\n')}`);

  const sources = sourceConfigs.slice(0, MAX_ITEMS).map(source => {
    const safe = safeMonitoringConfig(source.config || {});
    const context = Object.entries(safe).map(([key, values]) => `${key}: ${values.join(', ')}`).join(' | ');
    return `${source.source}${source.enabled === false ? ' (disabled)' : ''}${context ? ` — ${context}` : ''}`;
  });
  if (sources.length) sections.push(`ACTIVE MONITORING CONTEXT\n${sources.map(line => `- ${line}`).join('\n')}`);

  const policy = buildAgentPolicyContext(agentConfig);
  if (policy) sections.push(policy);
  return sections.join('\n\n');
}

export async function loadOrganizationIntelligence(orgId, agentConfig = null) {
  const [{ rows: orgRows }, { rows: categories }, { rows: sourceConfigs }] = await Promise.all([
    query('SELECT id,name,description,website,competitors,partner_brands,industry_keywords,organization_profile,intel_profile FROM organizations WHERE id=$1', [orgId]),
    query('SELECT id,name,description,severity FROM categories WHERE org_id=$1 ORDER BY severity DESC,name ASC', [orgId]),
    query('SELECT source,enabled,config FROM source_configs WHERE org_id=$1 ORDER BY source', [orgId]),
  ]);
  const org = orgRows[0];
  if (!org) throw new Error('organisation not found');
  return { org, categories, sourceConfigs, intelligence: buildOrganizationIntelligence({ org, categories, sourceConfigs, agentConfig }) };
}
