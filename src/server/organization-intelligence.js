import { query } from './db.js';
import { safeMonitoringConfig } from './prompts.js';
import { buildAgentPolicyContext } from './organization-agent-config.js';

const MAX_ITEMS = 12;
const HUMAN_PROFILE_FIELDS = ['priority_issues', 'risk_categories', 'products_services', 'terminology', 'customer_segments', 'geographies', 'brand_voice', 'response_guidelines'];
const LEARNED_PROFILE_FIELDS = ['brandKeywords', 'productKeywords', 'customerPainPoints', 'typicalComplaints', 'operationalRiskQueries', 'customerIntentQueries', 'highRiskTopics', 'industryVocabulary', 'geographyTerms', 'exclusionTerms', 'icpDescription', 'brandVoice', 'competitorContext', 'boostTerms'];

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
