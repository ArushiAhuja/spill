import OpenAI from 'openai';

// Lazy singleton — instantiated on first use so build-time import doesn't throw
let _openai = null;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// categories: [{ id, name, description, severity }]
// posts: [{ id, source, title, body, score, created_at, ... }]
// feedbackContext: string from getOrgFeedbackContext() — injected into prompt
// orgName / orgDescription: used to judge whether posts are actually about this company
export async function classifyPosts(posts, categories, feedbackContext = null, orgName = null, orgDescription = null) {
  const results = [];
  const batchSize = 5;

  for (let i = 0; i < posts.length; i += batchSize) {
    const batch = posts.slice(i, i + batchSize);
    try {
      if (process.env.OPENAI_API_KEY) {
        const classified = await classifyBatch(batch, categories, feedbackContext, orgName, orgDescription);
        results.push(...classified);
      } else {
        results.push(...keywordClassify(batch, categories));
      }
    } catch (err) {
      // 429 / quota: fall back to keywords for this batch only, log for observability
      console.warn('[classifier] batch error (using keyword fallback):', err.status ?? '', err.message);
      results.push(...keywordClassify(batch, categories));
    }
  }

  return results;
}

// Keyword-based classification — used when OpenAI is unavailable
// is_relevant defaults to true: keyword fallback can't make a relevance judgment, trust the tier filters
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

    const negativeWords = ['complaint', 'problem', 'issue', 'error', 'crash', 'bad', 'worst', 'terrible', 'scam', 'fraud', 'lawsuit', 'violation', 'unsafe', 'danger', 'fail', 'broken', 'refund', 'delay', 'cancel'];
    const negativeCount = negativeWords.filter(w => text.includes(w)).length;
    const sentimentIntensity = Math.min(20, negativeCount * 4);

    return scorePost(post, bestCategory, sentimentIntensity, 'keyword-classified', null, null, true);
  });
}

async function classifyBatch(posts, categories, feedbackContext = null, orgName = null, orgDescription = null) {
  const categoryList = categories.map(c => `- ID: ${c.id} | Name: ${c.name} | Description: ${c.description}`).join('\n');

  const postsText = posts.map((p, idx) =>
    `POST ${idx + 1}:\nTitle: ${p.title || '(no title)'}\nBody: ${(p.body || '').slice(0, 500)}\nSource: ${p.source}`
  ).join('\n\n');

  const feedbackSection = feedbackContext
    ? `\nLearned from past user feedback — apply these patterns:\n${feedbackContext}\n`
    : '';

  const orgContext = orgName
    ? `Company being monitored: ${orgName}${orgDescription ? `\nContext: ${orgDescription}` : ''}\n\n`
    : '';

  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 2000,
    messages: [
      { role: 'system', content: 'You classify social media posts for a brand monitoring system. Return ONLY valid JSON, no explanation.' },
      { role: 'user', content: `${orgContext}Categories available:\n${categoryList}\n${feedbackSection}\nPosts to classify:\n${postsText}\n\nReturn a JSON array with exactly ${posts.length} objects:\n[{"category_id": "uuid or null", "sentiment_intensity": 0-20, "reasoning": "one sentence", "response_template": "string or null", "location_tag": "city name or null", "is_relevant": true}]\n\n- is_relevant: true ONLY if the post genuinely concerns ${orgName || 'this company'}'s products, services, customers, or brand reputation in a meaningful way. Set false if the company/keyword appears incidentally, if the post is about a different topic, or if there is no real commercial or operational signal for this company. When in doubt, set false.\n- category_id: best matching category ID, or null if the post is NOISE or not relevant (if feedback says EXCLUDE, set to null)\n- sentiment_intensity: 0=neutral/positive, 20=extremely negative/urgent (if feedback says PRIORITIZE, score higher)\n- reasoning: one sentence explaining the relevance and category decision\n- response_template: for negative posts (sentiment_intensity >= 10), a short 2-3 sentence empathetic public response. null for neutral/positive posts.\n- location_tag: if the post clearly mentions a city/region (Delhi, Mumbai, Bengaluru, Hyderabad, Chennai, Pune, Kolkata, etc.), extract it. Otherwise null.` },
    ],
  });

  const text = response.choices[0].message.content.trim();
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('no JSON array in response');

  const classifications = JSON.parse(match[0]);

  return posts.map((post, idx) => {
    const cls = classifications[idx] || { category_id: null, sentiment_intensity: 0, reasoning: 'unclassified', response_template: null, is_relevant: true };
    const category = categories.find(c => c.id === cls.category_id);
    return scorePost(post, category, cls.sentiment_intensity || 0, cls.reasoning || '', cls.response_template || null, cls.location_tag || null, cls.is_relevant !== false);
  });
}

function scorePost(post, category, sentimentIntensity, reasoning, responseTemplate = null, locationTag = null, isRelevant = true) {
  const severity = category?.severity || 0;
  const engagementScore = Math.min(20, Math.log1p(post.score || 0) * 4);
  const ageHours = (Date.now() - new Date(post.created_at || Date.now())) / 3600000;
  const recencyScore = Math.max(0, 20 - ageHours * 2);
  const escalationScore = Math.round(engagementScore + recencyScore + severity + sentimentIntensity);
  const threshold = parseInt(process.env.ESCALATE_THRESHOLD) || 60;

  return {
    ...post,
    category_id: category?.id || null,
    sentiment_intensity: sentimentIntensity,
    reasoning,
    response_template: responseTemplate,
    location_tag: locationTag,
    escalation_score: Math.min(100, escalationScore),
    escalated: escalationScore >= threshold,
    is_relevant: isRelevant,
  };
}
