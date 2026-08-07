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
