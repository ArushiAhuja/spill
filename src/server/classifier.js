import OpenAI from 'openai';

let _openai = null;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// categories: [{ id, name, description, severity }]
// posts: [{ id, source, title, body, score, created_at, ... }]
// feedbackContext: string from getOrgFeedbackContext()
// intelProfile: full intel_profile JSONB from organizations table
export async function classifyPosts(posts, categories, feedbackContext = null, orgName = null, orgDescription = null, intelProfile = null) {
  const results = [];
  const batchSize = 5;

  for (let i = 0; i < posts.length; i += batchSize) {
    const batch = posts.slice(i, i + batchSize);
    try {
      if (process.env.OPENAI_API_KEY) {
        const classified = await classifyBatch(batch, categories, feedbackContext, orgName, orgDescription, intelProfile);
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

async function classifyBatch(posts, categories, feedbackContext = null, orgName = null, orgDescription = null, intelProfile = null) {
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

  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 2500,
    messages: [
      {
        role: 'system',
        content: 'You are a brand intelligence classifier for a company monitoring system. Your job is to classify social media posts and assess their operational risk. Return ONLY valid JSON, no explanation.',
      },
      {
        role: 'user',
        content: `${orgContext}Categories available:\n${categoryList}\n${feedbackSection}
Posts to classify:\n${postsText}

Return a JSON array with exactly ${posts.length} objects:
[{
  "category_id": "uuid or null",
  "customer_impact": 0-10,
  "operational_urgency": 0-10,
  "trust_risk": 0-10,
  "virality_potential": 0-10,
  "reasoning": "one sentence",
  "response_template": "string or null",
  "location_tag": "city name or null",
  "is_relevant": true
}]

Scoring guidance:
- customer_impact: 0=no direct customer harm, 5=significant frustration/loss, 10=injury/mass financial harm/death
- operational_urgency: 0=informational only, 5=team should review today, 10=requires response within the hour
- trust_risk: 0=neutral or positive, 5=notable credibility concern, 10=viral scandal/fraud allegation/regulatory breach
- virality_potential: 0=niche or low-traffic post, 5=moderate engagement, 10=trending or likely to break into mainstream media

Rules:
- is_relevant: true ONLY if the post genuinely concerns ${orgName || 'this company'}'s products, services, customers, or brand. Set false if the company appears incidentally or the post is about an unrelated topic.${feedbackContext ? ' Apply learned exclusions strictly.' : ''}
- category_id: best matching category ID. null if not relevant or no match.
- response_template: for posts with customer_impact >= 4 OR operational_urgency >= 4, write a 2-3 sentence empathetic public response the company could post. null otherwise.
- location_tag: if the post clearly mentions a city/region (Delhi, Mumbai, Bengaluru, Hyderabad, Chennai, Pune, etc.), extract it. null otherwise.`,
      },
    ],
  });

  const raw = response.choices[0].message.content.trim();
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('no JSON array in classifier response');

  const classifications = JSON.parse(match[0]);

  return posts.map((post, idx) => {
    const cls = classifications[idx] || {
      category_id: null,
      customer_impact: 0, operational_urgency: 0, trust_risk: 0, virality_potential: 0,
      reasoning: 'unclassified', response_template: null, is_relevant: true,
    };
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
