#!/usr/bin/env node
/**
 * Unit tests for relevance-policy pure helpers (no OpenAI / DB).
 */
import assert from 'assert';
import * as policy from '../src/server/relevance-policy.js';

const {
  brandKeyword,
  buildBrandTerms,
  textMentionsBrand,
  isSelfPublished,
  isBrandQueryPositive,
  isExternalBrandMention,
  normalizeHostname,
} = policy;

const org = {
  name: 'Chimes Aviation Academy',
  website: 'https://www.chimesaviation.com',
};
const intel = {
  brandKeywords: ['CAA', 'Chimes Aviation'],
};

assert.strictEqual(brandKeyword('Chimes Aviation Academy'), 'chimes aviation');
assert.strictEqual(normalizeHostname('https://www.chimesaviation.com/about'), 'chimesaviation.com');

const terms = buildBrandTerms(org, intel);
assert.ok(terms.some(t => t.includes('chimes')), `expected chimes term, got ${terms}`);
assert.ok(textMentionsBrand('CAD and Chimes Aviation Academy partner for training', terms));
assert.ok(textMentionsBrand('Looking at chimes aviation for CPL', terms));
assert.strictEqual(
  textMentionsBrand('The church bell chimes every hour', terms),
  false,
  'homonym "chimes" alone must not match soft brand terms'
);

// Contextual moniker: bare "Chimes" + admissions/apply signal is brand-relevant
assert.ok(policy.contextualBrandMonikerMatch(
  {
    title: 'Chimes',
    body: "I've applied for Chimes.waiting for results",
    url: 'https://www.reddit.com/r/CadetPilotProgram/comments/1vio4ji/chimes/',
  },
  org, intel, terms
), 'admission post titled Chimes on CadetPilot should match moniker+context');

assert.ok(isExternalBrandMention(
  {
    title: 'Chimes',
    body: "I've applied for Chimes.waiting for results",
    url: 'https://www.reddit.com/r/CadetPilotProgram/comments/1vio4ji/chimes/',
    author: 'some_cadet',
  },
  terms, org, [], intel
), 'external Chimes admissions post must count as external brand mention');

assert.ok(!policy.contextualBrandMonikerMatch(
  { title: 'Bells of Notre Dame', body: 'The church bell chimes every hour', url: 'https://example.com/bells' },
  org, intel, terms
), 'homonym chimes without aviation context must not match');

assert.ok(isExternalBrandMention(
  {
    title: 'How to apply for Chimes?',
    body: 'Need guidance on ICPP ADAPT for CAA',
    url: 'https://www.reddit.com/r/CadetPilotProgram/comments/abc/how_to_apply_for_chimes/',
  },
  terms, org, [], intel
), 'How to apply for Chimes should match');

// HTML-entity-encoded Reddit body + ICP13 title (production failure mode)
assert.ok(isExternalBrandMention(
  {
    title: 'Chimes Icp13- Adapt dates',
    body: '&lt;!-- SC_OFF --&gt;&lt;div class=&quot;md&quot;&gt;&lt;p&gt;ADAPT assessment dates are from 12–25 August, but does anyone know what is the latest ADAPT date that has been allotted so far to fresh applicants??&lt;/p&gt; &lt;/div&gt;&lt;!-- SC_ON --&gt;',
    url: 'https://www.reddit.com/r/indianaviation/comments/1vm7xbb/chimes_icp13_a',
  },
  terms, org, [], { ...intel, brandKeywords: [...intel.brandKeywords, 'ICPP', 'ICP'] }
), 'HTML-encoded Chimes Icp13 ADAPT post must match');

assert.ok(
  policy.stripHtmlNoise('&lt;p&gt;ADAPT dates&lt;/p&gt;').includes('ADAPT dates'),
  'stripHtmlNoise must decode entities before stripping tags'
);

// Learned keep rule from operator override
const learnedIntel = {
  ...intel,
  learnedKeepRules: [
    policy.buildKeepRuleFromPost({
      post: {
        title: 'Chimes!!!!',
        body: 'any updates on results?',
        url: 'https://www.reddit.com/r/CadetPilotProgram/comments/x/chimes/',
      },
      org,
      note: 'operator override',
    }),
  ],
};
assert.ok(
  policy.matchesLearnedKeepRule(
    { title: 'Chimes!!!!', body: 'any updates on results?', url: 'https://reddit.com/r/CadetPilotProgram/x' },
    learnedIntel
  ),
  'learned keep rule should match same-style admissions post'
);
assert.ok(
  isExternalBrandMention(
    { title: 'Chimes!!!!', body: 'any updates on results?', url: 'https://reddit.com/r/CadetPilotProgram/x' },
    terms, org, [], learnedIntel
  ),
  'external mention must respect learned keep rules'
);


assert.ok(isSelfPublished(
  { url: 'https://www.chimesaviation.com/blog/ceo-note', title: 'CEO note', author: 'admin' },
  org, [], intel
), 'own website should be self-published');

assert.ok(!isSelfPublished(
  {
    url: 'https://edtimes.in/opinion/chimes-ceo',
    title: 'Chimes Aviation Academy CEO on pilot training',
    author: 'ED Times',
  },
  org, [], intel
), 'ED Times must not be treated as self-published');

assert.ok(isExternalBrandMention(
  {
    url: 'https://edtimes.in/opinion/chimes-ceo',
    title: 'Chimes Aviation Academy CEO on pilot training',
    author: 'ED Times Staff',
  },
  terms, org, [], intel
), 'external brand press should count as external brand mention');

assert.ok(isSelfPublished(
  {
    url: 'https://www.linkedin.com/company/chimesaviation/posts/123',
    title: 'We are hiring instructors',
    author: 'chimesaviation',
  },
  org,
  [{ source: 'linkedin', config: { company_handles: ['chimesaviation'] } }],
  intel
), 'official LinkedIn should be self-published');

assert.ok(isBrandQueryPositive(
  { brand_query_hit: true, title: 'CEO shares views on aviation training', matched_query: 'Chimes Aviation Academy' },
  terms,
  ['chimes aviation academy', 'chimes aviation']
));
assert.ok(isBrandQueryPositive(
  { matched_query: 'Chimes Aviation Academy', title: 'Industry CEOs speak out' },
  terms,
  ['chimes aviation academy']
));
assert.ok(!isBrandQueryPositive(
  { matched_query: 'pilot training India', title: 'Generic training news' },
  terms,
  ['chimes aviation academy']
));

assert.ok(!isExternalBrandMention(
  { url: 'https://chimesaviation.com/press', title: 'Chimes Aviation Academy opens new campus' },
  terms, org, [], intel
));

console.log('test-relevance-policy: all assertions passed');
