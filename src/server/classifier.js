import OpenAI from 'openai';
import { getPrompt } from './prompts.js';

let _openai = null;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// categories: [{ id, name, description, severity }]
// posts: [{ id, source, title, body, score, created_at, ... }]
// feedbackContext: string from getOrgFeedbackContext()
// intelProfile: full intel_profile JSONB from organizations table
export async function classifyPosts(posts, categories, feedbackContext = null, orgName = null, orgDescription = null, intelProfile = null, orgId = null) {
  const results = [];
  const batchSize = 5;

  for (let i = 0; i < posts.length; i += batchSize) {
    const batch = posts.slice(i, i + batchSize);
    try {
      if (process.env.OPENAI_API_KEY) {
        const classified = await classifyBatch(batch, categories, feedbackContext, orgName, orgDescription, intelProfile, orgId);
        results.push(...classified);
      } else {
        results.push(...keywordClassify(batch, categories));
      }
    } catch (err) {
      console.warn('[classifier] batch error (using keyword fallback):', err.status ?? '', err.message);
      results.push(...keywordClassify(batch, categories));
    }
  }

  return results;
}

// Keyword-based fallback — estimates escalation dimensions from vocabulary
function keywordClassify(posts, categories) {
  return posts.map(post => {
    const text = `${post.title || ''} ${post.body || ''}`.toLowerCase();

    let bestCategory = null;
    let bestScore = 0;

    for (const cat of categories) {
      const keywords = `${cat.name} ${cat.description || ''}`.toLowerCase().split(/\W+/).filter(w => w.length > 3);
      const matches = keywords.filter(kw => text.includes(kw)).length;
      const score = keywords.length > 0 ? matches / keywords.length : 0;
      if (score > bestScore) {
        bestScore = score;
        bestCategory = cat;
      }
    }

    const highImpactWords = ['injured', 'death', 'lawsuit', 'fraud', 'scam', 'unsafe', 'danger', 'emergency', 'violation', 'tragedy'];
    const urgencyWords = ['complaint', 'problem', 'issue', 'error', 'crash', 'broken', 'refund', 'delay', 'cancel', 'bad', 'terrible', 'worst'];
    const trustWords = ['scam', 'fraud', 'fake', 'misleading', 'cheat', 'deceive', 'lie'];

    const customerImpact = Math.min(10,
      highImpactWords.filter(w => text.includes(w)).length * 4 +
      urgencyWords.filter(w => text.includes(w)).length
    );
    const operationalUrgency = Math.min(10, urgencyWords.filter(w => text.includes(w)).length * 2);
    const trustRisk = Math.min(10, trustWords.filter(w => text.includes(w)).length * 4);
    const viralityPotential = Math.min(10, Math.round(Math.log1p(post.score || 0) * 2));

    const dimensions = { customer_impact: customerImpact, operational_urgency: operationalUrgency, trust_risk: trustRisk, virality_potential: viralityPotential };
    return scorePost(post, bestCategory, dimensions, 'keyword-classified', null, null, true);
  });
}

async function classifyBatch(posts, categories, feedbackContext = null, orgName = null, orgDescription = null, intelProfile = null, orgId = null) {
  const categoryList = categories.map(c =>
    `- ID: ${c.id} | Name: ${c.name} | Severity: ${c.severity || 0}/30 | Description: ${c.description || 'n/a'}`
  ).join('\n');

  const postsText = posts.map((p, idx) =>
    `POST ${idx + 1}:\nTitle: ${p.title || '(no title)'}\nBody: ${(p.body || '').slice(0, 500)}\nSource: ${p.source}${p.score ? `\nEngagement: ${p.score}` : ''}`
  ).join('\n\n');

  const feedbackSection = feedbackContext
    ? `\nLearned from past user feedback — apply these patterns:\n${feedbackContext}\n`
    : '';

  // Build rich company context from intel_profile + description
  const intel = intelProfile || {};
  const contextParts = [];

  if (orgDescription) contextParts.push(`Company overview: ${orgDescription}`);
  if (intel.icpDescription) contextParts.push(`Who their customers are: ${intel.icpDescription}`);
  if (intel.typicalComplaints?.length) contextParts.push(`Typical complaints to watch for: ${intel.typicalComplaints.slice(0, 7).join('; ')}`);
  if (intel.industryVocabulary?.length) contextParts.push(`Industry terminology: ${intel.industryVocabulary.slice(0, 8).join(', ')}`);
  if (intel.highRiskTopics?.length) contextParts.push(`High-risk topics: ${intel.highRiskTopics.slice(0, 5).join(', ')}`);
  if (intel.competitorContext) contextParts.push(`Competitive context: ${intel.competitorContext}`);

  const orgContext = orgName ? `Company being monitored: ${orgName}\n${contextParts.join('\n')}\n\n` : '';

  const [systemPrompt, scoringRules] = await Promise.all([
    orgId ? getPrompt(orgId, 'classifier_system') : null,
    orgId ? getPrompt(orgId, 'classifier_scoring') : null,
  ]);

  const systemContent = systemPrompt || `You are a brand intelligence classifier for a company monitoring system. Classify each post in the exact order given. Return ONLY a valid JSON array with one object per post, in the same order. No explanation, no markdown, no extra text. When in doubt about is_relevant, default to false — do not assume relevance if the connection to the monitored company is unclear.`;

  const defaultScoring = `Scoring guidance:
- customer_impact: 0=no direct customer harm, 5=significant frustration/financial loss, 8=hospitalisation or mass harm, 10=death/class-action/mass financial injury
- operational_urgency: 0=informational only, 5=team should review today, 7=formal government/regulatory action (SEBI probe, consumer court ruling, police complaint, regulatory notice, lawsuit) requiring leadership attention within hours, 10=requires immediate public response within the hour
- trust_risk: 0=neutral/positive, 5=notable credibility concern, 6=significant adverse product/service experience with viral potential (e.g., hospitalisation from product use, major service failure with evidence), 7=formal regulatory allegation or institutional investigation (SEBI inquiry, false-advertising ruling, exposé by journalist/NGO), 10=fraud allegation/active scandal/regulatory breach with confirmed penalties
- virality_potential: 0=niche or low-traffic post, 5=moderate engagement, 10=trending or likely to break into mainstream media

Rules:
- is_relevant: Set to FALSE when: (a) the company name "${orgName || 'this company'}" does not appear in the post AND there is no clear product/service connection, OR (b) the post is entirely about a different company with no mention of this one. Set TRUE only when this company is a named or obvious subject of the post.${feedbackContext ? ' Apply learned exclusions strictly.' : ''}
- category_id: best matching category ID. null if not relevant or no match.
- response_template: for posts with customer_impact >= 4 OR operational_urgency >= 4, write a 2-3 sentence empathetic public response the company could post. null otherwise.
- location_tag: if the post clearly mentions a city/region (Delhi, Mumbai, Bengaluru, Hyderabad, Chennai, Pune, etc.), extract it. null otherwise.`;

  const scoringContent = scoringRules || defaultScoring;

  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 2500,
    messages: [
      {
        role: 'system',
        content: systemContent,
      },
      {
        role: 'user',
        content: `${orgContext}Categories available:\n${categoryList}\n${feedbackSection}
Posts to classify:\n${postsText}

Return a JSON array with EXACTLY ${posts.length} objects. Include a "post_index" field (1-based) so results can be matched back to posts even if order shifts:
[{
  "post_index": 1,
  "category_id": "uuid or null",
  "customer_impact": 0-10,
  "operational_urgency": 0-10,
  "trust_risk": 0-10,
  "virality_potential": 0-10,
  "reasoning": "one sentence",
  "response_template": "string or null",
  "location_tag": "city name or null",
  "is_relevant": true_or_false
}]

${scoringContent}`,
      },
    ],
  });

  const raw = response.choices[0].message.content.trim();
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('no JSON array in classifier response');

  const rawClassifications = JSON.parse(match[0]);

  // Re-index by post_index (1-based) so batch drift doesn't cause mismatches.
  // Fall back to positional order if post_index is absent.
  const byIndex = {};
  for (const r of rawClassifications) {
    const idx = Number.isInteger(r.post_index) ? r.post_index - 1 : -1;
    if (idx >= 0 && idx < posts.length && !byIndex[idx]) byIndex[idx] = r;
  }
  // Fill any gaps positionally from results that had no valid post_index
  const orphans = rawClassifications.filter(r => {
    const idx = Number.isInteger(r.post_index) ? r.post_index - 1 : -1;
    return idx < 0 || idx >= posts.length;
  });
  let orphanPtr = 0;
  const classifications = posts.map((_, i) => {
    if (byIndex[i]) return byIndex[i];
    return orphans[orphanPtr++] || null;
  });

  // Build brand + intel keyword patterns for the relevance guard below
  const brandPhrase = (orgName || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const brandPattern = brandPhrase
    ? new RegExp(`\\b${brandPhrase.replace(/\s+/g, '\\s+')}\\b`, 'i')
    : null;
  const intelKws = [
    ...(intel.brandKeywords || []),
    ...(intel.productKeywords || []),
  ].map(k => k.toLowerCase()).filter(k => k.length >= 4);

  return posts.map((post, idx) => {
    const cls = classifications[idx] || {
      category_id: null,
      customer_impact: 0, operational_urgency: 0, trust_risk: 0, virality_potential: 0,
      reasoning: 'unclassified', response_template: null, is_relevant: true,
    };

    // Relevance guard: if the AI says relevant but neither the brand name nor any
    // intel keyword appears in the post, override to irrelevant.
    // This catches hallucinated relevance for generic or competitor-only posts.
    // Tier-2 posts (operational keyword match) always have intel keywords so they pass through.
    if (cls.is_relevant !== false && brandPattern) {
      const postText = `${post.title || ''} ${post.body || ''}`;
      const hasBrand = brandPattern.test(postText);
      const hasIntelKw = intelKws.some(kw => postText.toLowerCase().includes(kw));
      if (!hasBrand && !hasIntelKw) {
        cls.is_relevant = false;
      }
    }

    const category = categories.find(c => c.id === cls.category_id);
    const dimensions = {
      customer_impact:    clamp(cls.customer_impact    || 0, 0, 10),
      operational_urgency: clamp(cls.operational_urgency || 0, 0, 10),
      trust_risk:         clamp(cls.trust_risk         || 0, 0, 10),
      virality_potential: clamp(cls.virality_potential  || 0, 0, 10),
    };
    return scorePost(
      post, category, dimensions,
      cls.reasoning || '',
      cls.response_template || null,
      cls.location_tag || null,
      cls.is_relevant !== false,
    );
  });
}

function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

export function scorePost(post, category, dimensions, reasoning, responseTemplate = null, locationTag = null, isRelevant = true) {
  const { customer_impact = 0, operational_urgency = 0, trust_risk = 0, virality_potential = 0 } = dimensions;
  const severity = category?.severity || 0;
  const engagementScore = Math.min(20, Math.log1p(post.score || 0) * 4);
  const ageHours = (Date.now() - new Date(post.created_at || Date.now())) / 3600000;
  const recencyScore = Math.max(0, 20 - ageHours * 2);

  // Weighted urgency: customer impact carries the most weight, then operational, then trust
  const urgencyScore = Math.round(
    (customer_impact * 0.40 + operational_urgency * 0.35 + trust_risk * 0.25) * 2
  ); // 0-20

  const viralityBonus = Math.round(virality_potential * 1.5); // 0-15

  // Backward-compatible sentiment_intensity: worst single dimension scaled 0-20
  const sentimentIntensity = Math.round(
    Math.max(customer_impact, operational_urgency, trust_risk) * 2
  );

  const escalationScore = Math.min(100, Math.round(
    engagementScore + recencyScore + severity + urgencyScore + viralityBonus
  ));
  const threshold = parseInt(process.env.ESCALATE_THRESHOLD) || 60;

  return {
    ...post,
    category_id: category?.id || null,
    sentiment_intensity: sentimentIntensity,
    escalation_dimensions: dimensions,
    reasoning,
    response_template: responseTemplate,
    location_tag: locationTag,
    escalation_score: escalationScore,
    escalated: escalationScore >= threshold,
    is_relevant: isRelevant,
  };
}
