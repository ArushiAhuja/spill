#!/usr/bin/env node
/**
 * Phase G — Classifier Test Harness
 *
 * Tests classifyPosts() against posts with known expected behavior:
 * - Safety/urgent complaints → high escalation_score
 * - Positive reviews → low urgency
 * - Irrelevant posts → is_relevant: false
 *
 * Shows old vs new behavior by comparing against saved baseline.
 *
 * Usage:
 *   node scripts/test-classifier.mjs              # run & compare vs baseline
 *   node scripts/test-classifier.mjs --save       # save as new baseline
 */

import OpenAI from 'openai';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, 'test-results');
const BASELINE_FILE = join(RESULTS_DIR, 'classifier-baseline.json');

// ── Load .env.local ───────────────────────────────────────────────────────────
try {
  const envPath = join(__dirname, '..', '.env.local');
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* use system env */ }

if (!process.env.OPENAI_API_KEY) {
  console.error('ERROR: OPENAI_API_KEY not set');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Mock classifier (mirrors classifyBatch in classifier.js exactly) ──────────

async function classifyBatch(posts, categories, orgName, orgDescription) {
  const categoryList = categories.map(c =>
    `- ID: ${c.id} | Name: ${c.name} | Severity: ${c.severity || 0}/30 | Description: ${c.description || 'n/a'}`
  ).join('\n');

  const postsText = posts.map((p, idx) =>
    `POST ${idx + 1}:\nTitle: ${p.title || '(no title)'}\nBody: ${(p.body || '').slice(0, 500)}\nSource: ${p.source}${p.score ? `\nEngagement: ${p.score}` : ''}`
  ).join('\n\n');

  const orgContext = `Company being monitored: ${orgName}\nCompany overview: ${orgDescription}\n\n`;

  // Keep in sync with defaultScoring in src/server/classifier.js
  const scoringContent = `Scoring guidance:
- customer_impact: 0=no direct customer harm, 5=significant frustration/financial loss, 8=hospitalisation or mass harm, 10=death/class-action/mass financial injury
- operational_urgency: 0=informational only, 5=team should review today, 7=formal government/regulatory action (SEBI probe, consumer court ruling, police complaint, regulatory notice, lawsuit) requiring leadership attention within hours, 10=requires immediate public response within the hour
- trust_risk: 0=neutral/positive, 5=notable credibility concern, 6=significant adverse product/service experience with viral potential (e.g., hospitalisation from product use, major service failure with evidence), 7=formal regulatory allegation or institutional investigation (SEBI inquiry, false-advertising ruling, exposé by journalist/NGO), 10=fraud allegation/active scandal/regulatory breach with confirmed penalties
- virality_potential: 0=niche or low-traffic post, 5=moderate engagement, 10=trending or likely to break into mainstream media

Rules:
- is_relevant: Set to FALSE when the company name does not appear in the post AND there is no clear product/service connection. Set TRUE only when this company is a named or obvious subject of the post.
- category_id: best matching category ID. null if not relevant or no match.
- response_template: for posts with customer_impact >= 4 OR operational_urgency >= 4, write a 2-3 sentence empathetic public response. null otherwise.
- location_tag: if the post clearly mentions a city/region, extract it. null otherwise.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 2500,
    messages: [
      {
        role: 'system',
        content: 'You are a brand intelligence classifier for a company monitoring system. Your job is to classify social media posts and assess their operational risk. Return ONLY valid JSON, no explanation.',
      },
      {
        role: 'user',
        content: `${orgContext}Categories available:\n${categoryList}\n
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
  "post_index": 1,
  "is_relevant": true_or_false
}]

${scoringContent}`,
      },
    ],
  });

  const raw = response.choices[0].message.content.trim();
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('no JSON array in classifier response');
  const rawResults = JSON.parse(match[0]);

  // Re-index by post_index to survive batch drift (mirrors production classifier.js)
  const byIndex = {};
  for (const r of rawResults) {
    const idx = Number.isInteger(r.post_index) ? r.post_index - 1 : -1;
    if (idx >= 0 && idx < posts.length && !byIndex[idx]) byIndex[idx] = r;
  }
  const orphans = rawResults.filter(r => {
    const idx = Number.isInteger(r.post_index) ? r.post_index - 1 : -1;
    return idx < 0 || idx >= posts.length;
  });
  let orphanPtr = 0;
  const results = posts.map((_, i) => byIndex[i] || orphans[orphanPtr++] || null);

  // Relevance guard (mirrors production classifier.js):
  // If AI says relevant but brand name is absent AND no intel keyword → override to false.
  const brandPhrase = (ORG.name || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const brandPattern = brandPhrase ? new RegExp(`\\b${brandPhrase.replace(/\s+/g, '\\s+')}\\b`, 'i') : null;

  if (brandPattern) {
    posts.forEach((post, idx) => {
      const cls = results[idx];
      if (!cls || cls.is_relevant === false) return;
      const postText = `${post.title || ''} ${post.body || ''}`;
      if (!brandPattern.test(postText)) cls.is_relevant = false;
    });
  }

  return results;
}

// ── Test definitions ──────────────────────────────────────────────────────────

const ORG = {
  name: 'Mamaearth',
  description: 'Indian D2C natural beauty and personal care brand. Sells toxin-free shampoos, face washes, moisturizers, and baby products.',
};

const CATEGORIES = [
  { id: 'cat-safety', name: 'Safety & Health', severity: 28, description: 'Product causing harm, allergic reactions, injuries' },
  { id: 'cat-fraud', name: 'Fraud & Trust', severity: 25, description: 'Fake products, misleading claims, cashback fraud' },
  { id: 'cat-service', name: 'Customer Service', severity: 15, description: 'Refunds, returns, delivery, support failures' },
  { id: 'cat-product', name: 'Product Quality', severity: 18, description: 'Formulation issues, packaging defects, ineffectiveness' },
  { id: 'cat-regulatory', name: 'Regulatory & Legal', severity: 22, description: 'SEBI, consumer forum, advertising standards violations' },
  { id: 'cat-positive', name: 'Positive Signal', severity: 2, description: 'Praise, positive reviews, brand love' },
];

// Each test case defines: post, expected behavior
// expected.min_customer_impact: AI must score at least this
// expected.max_customer_impact: AI must score at most this
// expected.escalated: whether escalation_score should be >= 60 (after full scoring)
// expected.is_relevant: whether post should be flagged relevant
// expected.has_response_template: whether response_template should be non-null
const TEST_CASES = [
  {
    id: 'tc001',
    label: 'Baby allergic reaction — urgent safety',
    post: {
      id: 'tc001', source: 'reddit', score: 450,
      title: 'Baby developed severe rash and swelling after Mamaearth baby wash — ER visit',
      body: 'Used Mamaearth baby wash for the first time on my 3-month old. Within 2 hours she had red welts all over her body and difficulty breathing. Had to rush to ER. Doctor said likely severe allergic reaction to fragrance. AVOID THIS PRODUCT.',
      created_at: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
    },
    expected: {
      min_customer_impact: 7,
      min_operational_urgency: 7,
      min_trust_risk: 6,
      escalated: true,
      is_relevant: true,
      has_response_template: true,
      label: 'severe safety incident with viral risk',
    },
  },
  {
    id: 'tc002',
    label: 'Cashback fraud allegation — trust risk',
    post: {
      id: 'tc002', source: 'twitter', score: 220,
      title: 'Mamaearth cashback SCAM — promised ₹500 never credited to 1000+ customers',
      body: 'Multiple users reporting that the Mamaearth Diwali cashback offer was a fraud. Cashback was promised within 30 days but 3 months later nothing. Customer care denies the offer existed despite screenshot proof. Filing consumer complaint.',
      created_at: new Date(Date.now() - 7200000).toISOString(),
    },
    expected: {
      min_customer_impact: 5,
      min_trust_risk: 6,
      escalated: true,
      is_relevant: true,
      has_response_template: true,
      label: 'fraud allegation with customer impact',
    },
  },
  {
    id: 'tc003',
    label: 'Positive product review — low urgency',
    post: {
      id: 'tc003', source: 'reddit', score: 45,
      title: 'Mamaearth onion hair oil 6-month review — impressed',
      body: 'Started using Mamaearth onion hair oil after seeing the ads. Was skeptical but honestly impressed. Hair fall reduced significantly in month 2. Texture is great, not greasy. Would recommend to anyone with hair fall issues.',
      created_at: new Date(Date.now() - 86400000).toISOString(),
    },
    expected: {
      max_customer_impact: 3,
      max_operational_urgency: 3,
      escalated: false,
      is_relevant: true,
      has_response_template: false,
      label: 'positive review, no action needed',
    },
  },
  {
    id: 'tc004',
    label: 'SEBI regulatory probe — high trust risk',
    post: {
      id: 'tc004', source: 'google_news', score: 0,
      title: 'SEBI investigates Honasa Consumer (Mamaearth) for undisclosed influencer payments',
      body: "India's securities regulator has opened a formal inquiry into Honasa Consumer, parent of Mamaearth, over allegations that the company did not properly disclose material information about its influencer marketing spend before its IPO. If proven, this could result in significant penalties.",
      created_at: new Date(Date.now() - 3600000).toISOString(),
    },
    expected: {
      min_trust_risk: 7,
      min_operational_urgency: 5, // probe (investigation opened) = "review today"; ruling/notice = 7+
      escalated: true,
      is_relevant: true,
      has_response_template: true,
      label: 'regulatory threat with reputational impact',
    },
  },
  {
    id: 'tc005',
    label: 'Delivery complaint — moderate service issue',
    post: {
      id: 'tc005', source: 'twitter', score: 8,
      title: 'Mamaearth order took 3 weeks and arrived damaged',
      body: 'Ordered Mamaearth products 3 weeks ago. Box was completely crushed. Shampoo pump broken and leaking. Asked for replacement, told to email photos, emailed 5 times, no response. Worst customer service.',
      created_at: new Date(Date.now() - 86400000).toISOString(),
    },
    expected: {
      min_customer_impact: 3,
      max_customer_impact: 7,
      min_operational_urgency: 3,
      is_relevant: true,
      label: 'moderate service failure',
    },
  },
  {
    id: 'tc006',
    label: 'Competitor-only post — not relevant to Mamaearth',
    post: {
      id: 'tc006', source: 'reddit', score: 12,
      title: 'WOW Skin Science apple cider vinegar shampoo ruined my hair',
      body: 'Been using WOW ACV shampoo for 6 weeks. My hair is completely dry and brittle now. Never had this issue before. WOW customer care was useless. Sticking to Dove from now on.',
      created_at: new Date(Date.now() - 172800000).toISOString(),
    },
    expected: {
      is_relevant: false,
      max_customer_impact: 3,
      label: 'about a competitor, not Mamaearth',
    },
  },
  {
    id: 'tc007',
    label: 'Fake products — critical trust + safety',
    post: {
      id: 'tc007', source: 'reddit', score: 890,
      title: 'WARNING: Fake Mamaearth products being sold on major e-commerce platforms with identical packaging',
      body: 'Bought what appeared to be Mamaearth vitamin C serum from a top-rated Amazon seller. Something felt off — wrong consistency, different smell. Sent to a lab for testing. Results: no actual vitamin C detected, possibly contaminated ingredients. QR code on the fake packaging links to a phishing site. Sharing batch details.',
      created_at: new Date(Date.now() - 1800000).toISOString(), // 30 min ago
    },
    expected: {
      min_customer_impact: 8,
      min_trust_risk: 8,
      min_operational_urgency: 8,
      escalated: true,
      is_relevant: true,
      has_response_template: true,
      label: 'critical: fake products with safety risk and viral signal',
    },
  },
  {
    id: 'tc008',
    label: 'General skincare advice — irrelevant generic content',
    post: {
      id: 'tc008', source: 'reddit', score: 34,
      title: 'PSA: Always patch test new skincare products before full use',
      body: 'Reminder to always do a 24-hour patch test before applying any new product to your face. This goes for all brands and products. Many people skip this step and end up with allergic reactions. Safety first.',
      created_at: new Date(Date.now() - 86400000).toISOString(),
    },
    expected: {
      is_relevant: false,
      max_customer_impact: 2,
      label: 'generic skincare advice, no brand mention',
    },
  },
  {
    id: 'tc009',
    label: 'Consumer forum ruling — regulatory + customer impact',
    post: {
      id: 'tc009', source: 'google_news', score: 0,
      title: "Consumer Forum orders Mamaearth to pay ₹50,000 in damages after 'toxin-free' claim ruled misleading",
      body: "A district consumer disputes redressal commission has ruled against Mamaearth, ordering the company to compensate a customer and pay additional punitive damages after its products were found to contain ingredients that contradict its core 'toxin-free' marketing claim.",
      created_at: new Date(Date.now() - 3600000).toISOString(),
    },
    expected: {
      min_trust_risk: 6,
      min_operational_urgency: 5,
      escalated: true,
      is_relevant: true,
      label: 'regulatory ruling with brand trust implication',
    },
  },
  {
    id: 'tc010',
    label: 'Mild quality complaint — low urgency',
    post: {
      id: 'tc010', source: 'playstore', score: 0,
      title: 'Mamaearth shampoo smells different now',
      body: '3 stars. I have been using the onion shampoo for 2 years. The new bottle smells slightly different from before — less strong. Product still works fine. Just prefer the old scent. Hope they go back to original.',
      created_at: new Date(Date.now() - 604800000).toISOString(), // 1 week ago
    },
    expected: {
      max_customer_impact: 5, // loyal customer, formula changed — borderline 4-5 acceptable
      max_operational_urgency: 4,
      is_relevant: true,
      label: 'mild quality change complaint, low urgency',
    },
  },
];

// ── Scoring (mirrors scorePost in classifier.js) ──────────────────────────────

function scorePost(post, cls) {
  const { customer_impact = 0, operational_urgency = 0, trust_risk = 0, virality_potential = 0 } = cls;
  const engagementScore = Math.min(20, Math.log1p(post.score || 0) * 4);
  const ageHours = (Date.now() - new Date(post.created_at || Date.now())) / 3600000;
  const recencyScore = Math.max(0, 20 - ageHours * 2);
  const urgencyScore = Math.round((customer_impact * 0.40 + operational_urgency * 0.35 + trust_risk * 0.25) * 2);
  const viralityBonus = Math.round(virality_potential * 1.5);
  const threshold = parseInt(process.env.ESCALATE_THRESHOLD) || 60;
  // Use category severity from lookup (matches production scorePost behaviour)
  const category = CATEGORIES.find(c => c.id === cls.category_id);
  const severity = category?.severity || 0;
  const escalationScore = Math.min(100, Math.round(engagementScore + recencyScore + severity + urgencyScore + viralityBonus));
  return { escalation_score: escalationScore, escalated: escalationScore >= threshold };
}

// ── Evaluation ────────────────────────────────────────────────────────────────

function evaluate(testCase, cls, scoring) {
  const { expected } = testCase;
  const failures = [];
  const checks = [];
  const postIsIrrelevant = cls.is_relevant === false;

  function check(name, actual, pass, detail) {
    checks.push({ name, actual, pass, detail });
    if (!pass) failures.push(`${name}: ${detail}`);
  }

  if (expected.is_relevant !== undefined) {
    check('is_relevant', cls.is_relevant, cls.is_relevant === expected.is_relevant, `expected ${expected.is_relevant}, got ${cls.is_relevant}`);
  }

  // Skip dimension/escalation checks for irrelevant posts — production discards them,
  // so their dimension scores have no effect on user-facing behaviour.
  if (!postIsIrrelevant) {
    if (expected.min_customer_impact !== undefined) {
      check('customer_impact_min', cls.customer_impact, cls.customer_impact >= expected.min_customer_impact, `expected >= ${expected.min_customer_impact}, got ${cls.customer_impact}`);
    }
    if (expected.max_customer_impact !== undefined) {
      check('customer_impact_max', cls.customer_impact, cls.customer_impact <= expected.max_customer_impact, `expected <= ${expected.max_customer_impact}, got ${cls.customer_impact}`);
    }
    if (expected.min_operational_urgency !== undefined) {
      check('operational_urgency_min', cls.operational_urgency, cls.operational_urgency >= expected.min_operational_urgency, `expected >= ${expected.min_operational_urgency}, got ${cls.operational_urgency}`);
    }
    if (expected.min_trust_risk !== undefined) {
      check('trust_risk_min', cls.trust_risk, cls.trust_risk >= expected.min_trust_risk, `expected >= ${expected.min_trust_risk}, got ${cls.trust_risk}`);
    }
    if (expected.escalated !== undefined) {
      check('escalated', scoring.escalated, scoring.escalated === expected.escalated, `expected escalated=${expected.escalated}, score=${scoring.escalation_score}`);
    }
    if (expected.has_response_template !== undefined) {
      const hasTemplate = !!cls.response_template;
      check('response_template', hasTemplate, hasTemplate === expected.has_response_template, `expected has_response_template=${expected.has_response_template}, got=${hasTemplate}`);
    }
  }

  return { passed: failures.length === 0, failures, checks };
}

function pct(n) { return `${(n * 100).toFixed(1)}%`; }

// ── Main ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const saveBaseline = args.includes('--save');

console.log('\n=== Spill Classifier Test Harness ===');
console.log(`Org: ${ORG.name} | ${TEST_CASES.length} test cases\n`);

if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

const posts = TEST_CASES.map(tc => tc.post);

// Run classifier in batches of 5 (same as production)
const allClassifications = [];
for (let i = 0; i < posts.length; i += 5) {
  const batch = posts.slice(i, i + 5);
  process.stdout.write(`  classifying batch ${Math.floor(i / 5) + 1}/${Math.ceil(posts.length / 5)}...\n`);
  const results = await classifyBatch(batch, CATEGORIES, ORG.name, ORG.description);
  allClassifications.push(...results);
}

// Evaluate each test case
let passed = 0;
const results = [];
console.log('\nResults:');
console.log('─'.repeat(70));

for (let i = 0; i < TEST_CASES.length; i++) {
  const tc = TEST_CASES[i];
  const cls = allClassifications[i];
  const scoring = scorePost(tc.post, cls);
  const evaluation = evaluate(tc, cls, scoring);

  const status = evaluation.passed ? '✓ PASS' : '✗ FAIL';
  if (evaluation.passed) passed++;

  console.log(`\n${status}  [${tc.id}] ${tc.label}`);
  console.log(`       Expected: ${tc.expected.label}`);
  console.log(`       Scores: ci=${cls.customer_impact} ou=${cls.operational_urgency} tr=${cls.trust_risk} vp=${cls.virality_potential}`);
  console.log(`       Escalation: ${scoring.escalation_score}/100 (${scoring.escalated ? 'ESCALATED' : 'not escalated'}) | relevant=${cls.is_relevant}`);
  if (cls.reasoning) console.log(`       Reasoning: ${cls.reasoning}`);

  if (!evaluation.passed) {
    evaluation.failures.forEach(f => console.log(`       ✗ ${f}`));
  }

  results.push({
    id: tc.id,
    label: tc.label,
    passed: evaluation.passed,
    scores: { customer_impact: cls.customer_impact, operational_urgency: cls.operational_urgency, trust_risk: cls.trust_risk, virality_potential: cls.virality_potential },
    escalation_score: scoring.escalation_score,
    escalated: scoring.escalated,
    is_relevant: cls.is_relevant,
    reasoning: cls.reasoning,
    failures: evaluation.failures,
  });
}

const passRate = passed / TEST_CASES.length;
console.log('\n' + '─'.repeat(70));
console.log(`\nPass rate: ${passed}/${TEST_CASES.length} (${pct(passRate)})`);

// Baseline comparison
if (saveBaseline || !existsSync(BASELINE_FILE)) {
  const baseline = { saved_at: new Date().toISOString(), pass_rate: passRate, passed, total: TEST_CASES.length, results };
  writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2));
  console.log(`\n✓ Baseline saved → ${BASELINE_FILE}`);
} else {
  const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8'));
  const drop = baseline.pass_rate - passRate;
  console.log(`\nBaseline (${baseline.saved_at.slice(0, 10)}): ${pct(baseline.pass_rate)} pass rate`);

  if (drop > 0.05) {
    console.log(`⚠ REGRESSION: pass rate dropped from ${pct(baseline.pass_rate)} → ${pct(passRate)}`);

    // Show which tests newly failed
    const baselineById = Object.fromEntries(baseline.results.map(r => [r.id, r]));
    const newFailures = results.filter(r => !r.passed && baselineById[r.id]?.passed);
    if (newFailures.length) {
      console.log('Newly failing tests:');
      newFailures.forEach(r => { console.log(`  • [${r.id}] ${r.label}`); r.failures.forEach(f => console.log(`    ✗ ${f}`)); });
    }
    process.exit(1);
  } else if (drop < -0.05) {
    console.log(`✓ Improved: pass rate ${pct(baseline.pass_rate)} → ${pct(passRate)}`);
  } else {
    console.log('✓ No regression detected');
  }
}

// Save run log
const logFile = join(RESULTS_DIR, `classifier-run-${Date.now()}.json`);
writeFileSync(logFile, JSON.stringify({ run_at: new Date().toISOString(), pass_rate: passRate, passed, total: TEST_CASES.length, results }, null, 2));
console.log(`Full result log → ${logFile}\n`);

if (passRate < 0.7) {
  console.error('ERROR: Pass rate below 70% — classifier quality unacceptable');
  process.exit(1);
}
