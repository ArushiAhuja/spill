#!/usr/bin/env node
/**
 * Phase G — Relevance Filter Test Harness
 *
 * Runs 50 relevant + 50 irrelevant posts through the AI relevance filter
 * (same prompt used in scheduler.js aiRelevanceFilter) and measures precision/recall.
 *
 * Usage:
 *   node scripts/test-relevance.mjs              # run & compare vs baseline
 *   node scripts/test-relevance.mjs --save       # run & save as new baseline
 *   node scripts/test-relevance.mjs --auto-rollback  # exit 1 + git revert on regression
 */

import OpenAI from 'openai';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, 'test-results');
const BASELINE_FILE = join(RESULTS_DIR, 'relevance-baseline.json');
const REGRESSION_THRESHOLD = 0.05; // 5% absolute drop triggers rollback warning

// ── Load .env.local ──────────────────────────────────────────────────────────
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
} catch { /* env.local not found — use system env */ }

if (!process.env.OPENAI_API_KEY) {
  console.error('ERROR: OPENAI_API_KEY not set');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Org context (Mamaearth — representative D2C beauty brand) ─────────────
const ORG = {
  name: 'Mamaearth',
  description: 'Indian D2C natural beauty and personal care brand known for toxin-free products. Sells shampoos, face washes, moisturizers, sunscreens, and baby care items.',
  intel: {
    icpDescription: 'Millennial Indian consumers, new mothers, health-conscious buyers aged 22–40',
    productKeywords: ['shampoo', 'face wash', 'moisturizer', 'sunscreen', 'baby lotion', 'hair oil', 'serum', 'ubtan', 'vitamin c'],
    typicalComplaints: ['allergic reaction', 'damaged packaging', 'delivery delay', 'refund not processed', 'expired product', 'fake product', 'hair fall', 'breakout'],
    customerPainPoints: ['rash', 'hair fall', 'skin breakout', 'burning sensation', 'bad smell', 'no results', 'side effects'],
    highRiskTopics: ['safety recall', 'SEBI action', 'greenwashing', 'fake products', 'harmful ingredients', 'allergic reaction'],
    industryVocabulary: ['D2C', 'natural beauty', 'toxin-free', 'BPA-free', 'ayurvedic', 'sulfate-free', 'paraben-free'],
    geographyTerms: ['india', 'delhi', 'mumbai', 'bangalore', 'hyderabad', 'chennai', 'pune', 'indian'],
  },
};

// ── Test Corpus ───────────────────────────────────────────────────────────────

const RELEVANT_POSTS = [
  { id: 'r001', source: 'reddit', title: 'Mamaearth onion hair oil gave me severe scalp irritation', body: 'Used it for 2 weeks and now my scalp is burning. Anyone else had this issue? Bought from official site.' },
  { id: 'r002', source: 'reddit', title: 'Got fake Mamaearth products delivered from Amazon', body: 'Seal was broken, smell was completely different. Opening fraud complaint. Batch number in comments.' },
  { id: 'r003', source: 'twitter', title: "Mamaearth customer care hasn't responded in 14 days. Charged twice.", body: 'Order #ME2847 - double charged, no response to 6 emails and 3 calls. Fraud!' },
  { id: 'r004', source: 'google_news', title: 'SEBI probe into Mamaearth influencer marketing disclosures', body: "Regulators scrutinizing whether Mamaearth properly disclosed paid partnerships with influencers." },
  { id: 'r005', source: 'reddit', title: 'Baby developed rash after using Mamaearth baby wash', body: 'Used only once and my 3-month old got red rashes all over. Stopped immediately. Sharing photos.' },
  { id: 'r006', source: 'playstore', title: 'Mamaearth app crashes on checkout every time', body: 'Every time I try to place an order the app crashes. Cart gets cleared. Terrible experience.' },
  { id: 'r007', source: 'google_news', title: 'Mamaearth Q3 revenue up 38% but margins under pressure', body: 'Honasa Consumer, parent of Mamaearth, reports strong topline but rising ad spend eating into profits.' },
  { id: 'r008', source: 'reddit', title: 'Mamaearth vitamin C serum turned orange after 2 weeks', body: "Is this normal? Bought from official website. Opened 2 weeks ago and it's already dark orange. Expired?" },
  { id: 'r009', source: 'reddit', title: 'Honest review: Mamaearth sunscreen SPF 50 leaves massive white cast', body: 'As a WOC this sunscreen is unwearable. Compared to Minimalist which blends perfectly. Disappointed.' },
  { id: 'r010', source: 'twitter', title: 'Mamaearth delivery took 3 weeks, product arrived completely damaged', body: 'Box was crushed, pump broken. Refund request denied saying "packaging is not our responsibility"' },
  { id: 'r011', source: 'reddit', title: 'Why is Mamaearth quality declining recently?', body: 'Loyal customer for 3 years. New batches of face wash feel watery and less effective. Cutting corners?' },
  { id: 'r012', source: 'hackernews', title: "Mamaearth's D2C playbook: $1B valuation on influencer marketing", body: 'Analysis of how Mamaearth built a large brand almost entirely through social media endorsements.' },
  { id: 'r013', source: 'reddit', title: 'Mamaearth refused return citing "used product" — it was still sealed', body: 'Product arrived damaged and they will not accept it back. Lying about their return policy.' },
  { id: 'r014', source: 'google_news', title: 'Mamaearth faces backlash over "toxin-free" claims, dermatologists say misleading', body: "Experts question the scientific basis of Mamaearth's core marketing claim." },
  { id: 'r015', source: 'twitter', title: 'Allergic reaction to Mamaearth face pack sent me to ER', body: 'Face swelled up within 30 min of applying. Had to get antihistamine injection. Sharing batch number.' },
  { id: 'r016', source: 'reddit', title: 'Mamaearth shampoo vs Himalaya: which is better for oily scalp?', body: 'Using Mamaearth onion shampoo now. Thinking of switching. Has anyone compared these two directly?' },
  { id: 'r017', source: 'appstore', title: 'Mamaearth App - No refund for cancelled order', body: 'Cancelled within minutes. App shows cancellation accepted but money not returned after 3 weeks.' },
  { id: 'r018', source: 'reddit', title: "Is Mamaearth actually cruelty-free? Their certification expired in 2022", body: 'Found evidence that their PETA certification lapsed. Are they still claiming cruelty-free?' },
  { id: 'r019', source: 'google_news', title: 'Mamaearth launches new sustainable packaging initiative', body: 'Honasa Consumer announces switch to 100% recyclable packaging across its Mamaearth product line.' },
  { id: 'r020', source: 'reddit', title: 'Mamaearth products arrived with manufacturing date blacked out', body: 'Bought from local retail store. Dates deliberately blacked out with marker. Is this legal?' },
  { id: 'r021', source: 'twitter', title: "Mamaearth ambassador Shilpa Shetty under fire for misleading skincare claims", body: 'Customers calling out the Mamaearth brand ambassador for promoting unrealistic results.' },
  { id: 'r022', source: 'reddit', title: 'PSA: Mamaearth website bug exposes other customers shipping addresses', body: "Found a bug where I could see other customers' addresses in my order history. Privacy issue." },
  { id: 'r023', source: 'playstore', title: 'Mamaearth - Best natural products, fast delivery', body: '5 stars. Love their products, especially the vitamin C range. Customer care was helpful.' },
  { id: 'r024', source: 'reddit', title: 'Mamaearth vs Minimalist: ingredient analysis for acne-prone skin', body: 'Did a full ingredient check. Mamaearth face wash has comedogenic ingredients despite their claims.' },
  { id: 'r025', source: 'twitter', title: 'Mamaearth sent the wrong product and wants me to pay return shipping', body: 'They sent Bhringraj oil instead of Onion oil. Asking me to pay return shipping for their mistake.' },
  { id: 'r026', source: 'reddit', title: 'My 6-month review of Mamaearth onion hair mask — photos included', body: 'Hair fall reduced significantly. But new formula seems different. Texture changed.' },
  { id: 'r027', source: 'google_news', title: 'Mamaearth stock falls 12% after disappointing Q4 results', body: "Honasa Consumer shares fell sharply as Mamaearth's growth slowed and acquisition costs rose." },
  { id: 'r028', source: 'reddit', title: 'Mamaearth body lotion stings badly on freshly shaved skin', body: 'Had to wash off immediately. Never had this with other brands. Is there alcohol in it?' },
  { id: 'r029', source: 'twitter', title: "Thread: Exposing Mamaearth's fake review ecosystem on Amazon", body: 'Compiled evidence of coordinated 5-star reviews from accounts created the same day. Unacceptable.' },
  { id: 'r030', source: 'reddit', title: 'Mamaearth cashback fraud — none of the promised rewards credited', body: 'Bought 5 products during their cashback campaign. Support says "check after 60 days" — classic stall.' },
  { id: 'r031', source: 'google_news', title: 'Mamaearth extends to UAE and Singapore markets', body: 'Honasa Consumer announces international expansion targeting Indian diaspora in GCC and Southeast Asia.' },
  { id: 'r032', source: 'reddit', title: 'Infant had allergic reaction to Mamaearth baby lotion — sharing for awareness', body: 'Red welts within hours of first use. Pediatrician said avoid fragrance-heavy products for newborns.' },
  { id: 'r033', source: 'twitter', title: 'Mamaearth OTP verification not working for 3 days straight', body: "Can't login to place order. OTP never arrives. Tried 3 phone numbers. Known issue?" },
  { id: 'r034', source: 'reddit', title: 'Mamaearth subscription box arrived with 2 items missing', body: 'Ordered 6 products, received 4. Invoice shows all 6. Customer care asking for unboxing video.' },
  { id: 'r035', source: 'hackernews', title: 'Honasa Consumer (Mamaearth parent) IPO oversubscribed 7x at listing', body: "Analysis of the Mamaearth IPO and what it means for India's D2C beauty market." },
  { id: 'r036', source: 'reddit', title: 'Mamaearth face wash contains SLS despite claiming sulfate-free', body: 'Checked the INCI list carefully. Sodium Laureth Sulfate is listed. This is false advertising.' },
  { id: 'r037', source: 'twitter', title: 'Mamaearth delivery address changed without my consent', body: 'My order went to a completely different address. Who changed it? Data privacy violation?' },
  { id: 'r038', source: 'reddit', title: 'Is Mamaearth worth 3x the price vs Himalaya or Biotique?', body: 'Same type of products, dramatically different prices. Is the Mamaearth quality difference real?' },
  { id: 'r039', source: 'google_news', title: 'Consumer Forum orders Mamaearth to refund 5000 customers', body: 'Commission rules against Mamaearth for false "natural" claims on packaging.' },
  { id: 'r040', source: 'reddit', title: 'Mamaearth sunscreen left permanent yellow stains on white shirts', body: 'The SPF 50 PA++++ ruined two shirts. Stains completely non-removable.' },
  { id: 'r041', source: 'twitter', title: 'Used Mamaearth vitamin C serum for 3 months — before/after comparison', body: 'Honest long-term review. Pigmentation reduced about 20%. Consistency is key. Full thread.' },
  { id: 'r042', source: 'reddit', title: 'Mamaearth face cream price jumped 40% with no formula change', body: 'Same 50ml, same ingredients, ₹299 → ₹419 in 6 months. Unexplained price hike.' },
  { id: 'r043', source: 'google_news', title: 'Cybersecurity researchers: Mamaearth app collecting excessive user data', body: 'Privacy audit reveals Mamaearth Android app accessing contacts and location unnecessarily.' },
  { id: 'r044', source: 'reddit', title: 'Mamaearth asked me to post 5-star review after sending PR package', body: 'Got free products with a note asking for a 5-star review and not to disclose it was gifted. Unethical.' },
  { id: 'r045', source: 'twitter', title: "Mamaearth's new BHA exfoliant is excellent — best value in India", body: 'Pores visibly reduced after a month. At ₹599 this is a steal compared to Paula\'s Choice.' },
  { id: 'r046', source: 'reddit', title: 'Mamaearth hair serum makes hair greasy and sticky all day', body: 'Even a tiny amount on damp hair looks like I have not washed in a week. Disappointed.' },
  { id: 'r047', source: 'google_news', title: 'Mamaearth partners with Zepto for 10-minute delivery in 15 cities', body: 'Quick commerce push as Honasa Consumer captures impulse purchases alongside D2C model.' },
  { id: 'r048', source: 'reddit', title: "PSA: Mamaearth's plant-a-tree campaign appears to be fake — investigation", body: 'Asked for proof. They sent a stock image. Investigated 3 NGOs they named — none confirmed.' },
  { id: 'r049', source: 'twitter', title: 'Mamaearth COD order marked delivered without being delivered', body: 'Delivery partner marked it delivered without coming. No help from support in 5 days.' },
  { id: 'r050', source: 'reddit', title: 'Mamaearth or WOW Skin Science for body butter — comparing both', body: 'Testing both for a month. Mamaearth slightly better texture, WOW better fragrance. Both toxin-free claims.' },
].map(p => ({ ...p, expected_relevant: true }));

const IRRELEVANT_POSTS = [
  { id: 'i001', source: 'reddit', title: "Happy Earth Day! Let's protect mama earth from plastic pollution", body: 'Small actions matter. Switch to reusable bags. Reduce plastic. Our planet depends on us.' },
  { id: 'i002', source: 'reddit', title: 'WOW Skin Science apple cider vinegar shampoo: 6-month review', body: 'Detailed review of WOW ACV shampoo for frizzy hair. Before and after photos. Highly recommend.' },
  { id: 'i003', source: 'reddit', title: 'Best moisturizer for dry skin: Cetaphil vs CeraVe vs Neutrogena', body: 'Comparing the three big drugstore moisturizers. No Indian brands in this test.' },
  { id: 'i004', source: 'reddit', title: 'Himalaya neem face wash review — 3-month follow-up', body: 'Still using Himalaya neem face wash. Acne improved. Their customer service was great.' },
  { id: 'i005', source: 'reddit', title: 'My 10-step skincare routine for glass skin', body: 'Double cleanse, essence, toner, serum, moisturizer. All products listed below.' },
  { id: 'i006', source: 'reddit', title: 'Forest Essentials vs Biotique: which Ayurvedic brand is better?', body: 'Comparing two premium ayurvedic brands. Forest Essentials wins on packaging, Biotique on price.' },
  { id: 'i007', source: 'reddit', title: 'Amazon Great Indian Sale — best electronics deals compiled', body: 'iPhone 15 at 15% off. Samsung Galaxy S24 with exchange offer. Laptops at lowest prices ever.' },
  { id: 'i008', source: 'reddit', title: "My mom's homemade onion and fenugreek hair oil recipe", body: 'Sharing my family recipe for hair growth oil. Natural ingredients, no chemicals. Easy to make.' },
  { id: 'i009', source: 'google_news', title: "India's D2C market to reach $100B by 2030: FICCI report", body: 'D2C growing rapidly across beauty, food, and fashion. Key drivers: social media and smartphones.' },
  { id: 'i010', source: 'reddit', title: 'Has anyone tried Biotique Bio Fruit Brightening face pack?', body: 'Looking for opinions on Biotique for brightening dull skin. Never tried their products before.' },
  { id: 'i011', source: 'reddit', title: 'Baby shower gift ideas under ₹2000', body: 'Looking for thoughtful new baby gifts. Diaper bag? Swaddle? Soft toys? Baby monitor?' },
  { id: 'i012', source: 'reddit', title: 'Beginner skincare routine guide — where to start?', body: 'Just cleanse, moisturize, SPF for beginners. Do not overcomplicate it. Pick gentle products.' },
  { id: 'i013', source: 'reddit', title: 'Nykaa Big Beauty Days: best products to buy in the sale', body: 'Sale starts tomorrow. Best picks from MAC, Charlotte Tilbury, Huda Beauty, and others.' },
  { id: 'i014', source: 'google_news', title: 'The Body Shop opens 15 new India locations in tier-2 cities', body: "International beauty retailer expands Indian footprint targeting the growing middle class." },
  { id: 'i015', source: 'google_news', title: 'Sugar Cosmetics closes ₹350 crore Series D funding', body: 'Mumbai-based Sugar Cosmetics raises growth capital to expand offline retail and product range.' },
  { id: 'i016', source: 'reddit', title: 'Lush vs The Body Shop for dry skin body butter', body: 'Tested both for a month in winter. Lush wins on lasting hydration. The Body Shop wins on scent.' },
  { id: 'i017', source: 'reddit', title: 'May is Skin Cancer Awareness Month — wear your sunscreen!', body: 'SPF 50 every day, even indoors. Reapply every 2 hours outdoors. Never skip on cloudy days.' },
  { id: 'i018', source: 'reddit', title: 'Hyaluronic acid vs retinol: which is better for anti-aging?', body: 'HA for hydration, retinol for collagen. Ideally use both at different times of day.' },
  { id: 'i019', source: 'reddit', title: "Best baby skincare in India 2024 — pediatrician's list", body: "Johnson's vs Chicco vs Sebamed for newborns. Doctors say go fragrance-free for under 6 months." },
  { id: 'i020', source: 'reddit', title: 'Homemade onion juice for hair growth — does it actually work?', body: 'Tried onion juice for 3 months. Mixed results. Smell is unbearable. Probably not worth it.' },
  { id: 'i021', source: 'reddit', title: 'Natural remedies for hair fall — Ayurvedic herbs that work', body: 'Amla, bhringraj, brahmi oil. Traditional herbs with scientific backing for hair health.' },
  { id: 'i022', source: 'google_news', title: 'Indian beauty market projected to exceed $20 billion by 2027', body: 'Rising disposable incomes and growing beauty consciousness drive rapid market expansion.' },
  { id: 'i023', source: 'reddit', title: 'Dermatologist: why sulfate-free shampoos are better for color-treated hair', body: 'Sulfates strip color faster. Go sulfate-free regardless of brand if you color your hair.' },
  { id: 'i024', source: 'google_news', title: 'Zepto and Blinkit expand quick commerce to 30 new tier-2 cities', body: 'Quick commerce platforms racing to capture smaller cities ahead of festive season.' },
  { id: 'i025', source: 'reddit', title: '5 best DIY face packs for glowing skin this summer', body: 'Multani mitti, rose water, aloe vera, papaya, cucumber. Make at home, no chemicals.' },
  { id: 'i026', source: 'reddit', title: 'Dove vs Pantene: which is better for Indian hair types?', body: 'Dove better for moisture. Pantene better for smoothness. Both have SLS though.' },
  { id: 'i027', source: 'reddit', title: 'My experience with Korean skincare — 1 year honest update', body: 'Switched to K-beauty completely. COSRX, Innisfree, Some By Mi. Skin has never looked better.' },
  { id: 'i028', source: 'google_news', title: 'India sees 120 new D2C brands launch in first half of 2024', body: 'Founders eye the D2C opportunity across food, fashion, and personal care.' },
  { id: 'i029', source: 'reddit', title: '10 toxic chemicals to avoid in your skincare routine', body: 'Parabens, formaldehyde, phthalates, mercury — what to look for on ingredient lists.' },
  { id: 'i030', source: 'reddit', title: 'Holi skincare sale: discount codes for beauty brands compiled', body: 'Lakme 20% off. Nykaa extra 10% with coupon. L\'Oreal buy 2 get 1 free. Derma Co 30%.' },
  { id: 'i031', source: 'reddit', title: 'WOW apple cider vinegar shampoo — 1 year update', body: 'Switched to WOW ACV a year ago. Hair is much healthier. No build-up. 10/10 recommend.' },
  { id: 'i032', source: 'reddit', title: 'The Derma Co salicylic acid serum — is it worth ₹799?', body: 'Comparing to Paula\'s Choice BHA. Results seem similar but the price difference is huge.' },
  { id: 'i033', source: 'reddit', title: 'New mum survival guide: essential products for the first 6 months', body: 'Breast pump, nursing pillow, white noise machine, swaddle blankets. Everything I wish I had.' },
  { id: 'i034', source: 'reddit', title: 'Why I switched from commercial shampoo to rice water rinse', body: 'Been using rice water for 4 months. Hair has grown noticeably. No product needed.' },
  { id: 'i035', source: 'reddit', title: 'Minimalist vs The Ordinary: comparing niacinamide serums for acne scars', body: 'Minimalist wins on India price. Similar results to The Ordinary. Full comparison in comments.' },
  { id: 'i036', source: 'google_news', title: 'ASCI issues new influencer marketing disclosure guidelines for beauty brands', body: "India's advertising standards body issues clearer rules for influencer marketing." },
  { id: 'i037', source: 'reddit', title: 'Guide to cruelty-free beauty brands in India 2024', body: 'Certified cruelty-free: Plum, Nykaa Earth, The Moms Co, Love Beauty and Planet. Full list.' },
  { id: 'i038', source: 'reddit', title: 'Chemical peels vs laser for pigmentation: dermatologist perspective', body: 'For mild pigmentation: peels work. For deep spots: laser is more effective. Both need SPF.' },
  { id: 'i039', source: 'reddit', title: 'Homemade neem and turmeric face pack recipe', body: 'Mix neem powder, turmeric, rose water. Apply for 20 min. Good for acne. Traditional remedy.' },
  { id: 'i040', source: 'reddit', title: 'Parabens in skincare: separating fact from fear', body: 'The science on parabens. Are they actually harmful? Most dermatologists say no at low concentrations.' },
  { id: 'i041', source: 'reddit', title: 'How to remove tan at home after a beach vacation', body: 'Rice water, lemon, honey mask. Gentle exfoliation. Takes 2–3 weeks. Worked for me.' },
  { id: 'i042', source: 'reddit', title: 'IPL hair removal clinic experience in Bengaluru', body: 'Did 6 sessions at a clinic in Indiranagar. Significant reduction. Cost ₹8000 total.' },
  { id: 'i043', source: 'reddit', title: 'Baby eczema natural remedies that actually helped us', body: 'Pediatrician recommended petroleum jelly. Switched to fragrance-free everything. Night and day difference.' },
  { id: 'i044', source: 'reddit', title: 'Holy grail skincare products for Indian skin — megathread', body: 'What single product transformed your skin? Share your favorites. Any brand welcome.' },
  { id: 'i045', source: 'reddit', title: 'UV radiation and skin damage in Indian climate — what you need to know', body: 'India has high UV index year-round. SPF 50+ is a must. Reapply every 2 hours outdoors.' },
  { id: 'i046', source: 'reddit', title: 'Female pattern hair loss: causes and treatments explained', body: 'Hormonal causes, stress, diet deficiency. Minoxidil is most effective. See a dermatologist.' },
  { id: 'i047', source: 'reddit', title: 'Best skincare brands under ₹500 in India — budget buyer guide', body: 'Ponds, Nivea, Lakme, Cetaphil. All under ₹500. All effective for basic daily care.' },
  { id: 'i048', source: 'reddit', title: 'Nykaa vs Amazon: where to buy authentic beauty products in India?', body: 'Both have fake seller problems. Nykaa safer for luxury. Amazon better for drugstore.' },
  { id: 'i049', source: 'reddit', title: 'Trichologist explains: top 5 causes of hair fall in Indian women', body: 'Iron deficiency, thyroid, hormonal imbalance, protein deficiency, stress. Get bloodwork done first.' },
  { id: 'i050', source: 'reddit', title: 'Your holy grail product? Drop it below!', body: 'Looking for recommendations. Share your single best find that transformed your skin or hair.' },
].map(p => ({ ...p, expected_relevant: false }));

const ALL_POSTS = [...RELEVANT_POSTS, ...IRRELEVANT_POSTS];

// ── Relevance Filter (mirrors scheduler.js aiRelevanceFilter prompt exactly) ─

async function runRelevanceFilter(posts) {
  const intel = ORG.intel;
  const operationalContext = [
    intel.icpDescription ? `Target customers: ${intel.icpDescription}` : '',
    intel.productKeywords?.length ? `Products/services: ${intel.productKeywords.join(', ')}` : '',
    intel.typicalComplaints?.length ? `Typical complaints: ${intel.typicalComplaints.join('; ')}` : '',
    intel.customerPainPoints?.length ? `Customer pain points: ${intel.customerPainPoints.join(', ')}` : '',
    intel.highRiskTopics?.length ? `High-risk topics: ${intel.highRiskTopics.join(', ')}` : '',
    intel.industryVocabulary?.length ? `Industry terminology: ${intel.industryVocabulary.join(', ')}` : '',
  ].filter(Boolean).join('\n');

  const criteriaBlock = `Include a post ONLY if it:
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
- It's personal or lifestyle content with no commercial signal`;

  const BATCH = 20;
  const kept = [];

  for (let i = 0; i < posts.length; i += BATCH) {
    const batch = posts.slice(i, i + BATCH);
    const postList = batch.map((p, idx) => {
      const text = `${p.title || ''}${p.body ? ': ' + p.body.slice(0, 120) : ''}`.trim();
      return `[${idx}] [${p.source || 'test'}] — ${text}`;
    }).join('\n');

    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 80,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: 'You are an operational intelligence filter. Return ONLY a JSON array of relevant 0-based indexes, or an empty array. No explanation. Example: [0,2,5] or []',
        },
        {
          role: 'user',
          content: `Company: ${ORG.name}
Description: ${ORG.description}
${operationalContext}
Posts come from Reddit, Hacker News, Google News, Twitter, and app store reviews. Some matched keyword filters but may not be genuinely about this company. Verify each one actually matters to this company's operations or reputation.

${criteriaBlock}

Posts:
${postList}

Return JSON array of relevant indexes (e.g. [0,2,5]) or [] if none:`,
        },
      ],
    });

    const raw = res.choices[0].message.content.trim();
    const match = raw.match(/\[[\s\S]*?\]/);
    if (match) {
      const idxs = JSON.parse(match[0]);
      if (Array.isArray(idxs)) {
        for (const idx of idxs) {
          if (Number.isInteger(idx) && idx >= 0 && idx < batch.length) {
            kept.push(batch[idx]);
          }
        }
      }
    }

    process.stdout.write(`  batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(posts.length / BATCH)} done\n`);
  }

  return kept;
}

// ── Metrics ───────────────────────────────────────────────────────────────────

function computeMetrics(allPosts, keptPosts) {
  const keptIds = new Set(keptPosts.map(p => p.id));
  let TP = 0, FP = 0, FN = 0, TN = 0;
  const falsePositives = [];
  const falseNegatives = [];

  for (const post of allPosts) {
    const kept = keptIds.has(post.id);
    const expected = post.expected_relevant;
    if (kept && expected) TP++;
    else if (kept && !expected) { FP++; falsePositives.push(post); }
    else if (!kept && expected) { FN++; falseNegatives.push(post); }
    else TN++;
  }

  const precision = TP + FP > 0 ? TP / (TP + FP) : 1;
  const recall = TP + FN > 0 ? TP / (TP + FN) : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const accuracy = (TP + TN) / allPosts.length;

  return { TP, FP, FN, TN, precision, recall, f1, accuracy, total: allPosts.length, kept: keptPosts.length, falsePositives, falseNegatives };
}

function pct(n) { return `${(n * 100).toFixed(1)}%`; }

function printMetrics(m, label = '') {
  console.log(`\n${'─'.repeat(50)}`);
  if (label) console.log(`  ${label}`);
  console.log(`${'─'.repeat(50)}`);
  console.log(`  Corpus:    ${m.total} posts (50 relevant + 50 irrelevant)`);
  console.log(`  Kept:      ${m.kept} posts`);
  console.log(`\n  TP: ${m.TP}  FP: ${m.FP}  FN: ${m.FN}  TN: ${m.TN}`);
  console.log(`\n  Precision: ${pct(m.precision)}  (of kept, % actually relevant)`);
  console.log(`  Recall:    ${pct(m.recall)}  (of relevant, % found)`);
  console.log(`  F1:        ${pct(m.f1)}`);
  console.log(`  Accuracy:  ${pct(m.accuracy)}`);

  if (m.falsePositives.length) {
    console.log(`\n  False Positives (irrelevant posts that were KEPT — noise):`);
    m.falsePositives.forEach(p => console.log(`    [${p.id}] ${p.title}`));
  }
  if (m.falseNegatives.length) {
    console.log(`\n  False Negatives (relevant posts that were DROPPED — signal loss):`);
    m.falseNegatives.forEach(p => console.log(`    [${p.id}] ${p.title}`));
  }
  console.log(`${'─'.repeat(50)}`);
}

function checkRegression(current, baseline) {
  const regressions = [];
  const precDrop = baseline.precision - current.precision;
  const recDrop = baseline.recall - current.recall;
  if (precDrop > REGRESSION_THRESHOLD) {
    regressions.push(`Precision: ${pct(baseline.precision)} → ${pct(current.precision)} (dropped ${pct(precDrop)})`);
  }
  if (recDrop > REGRESSION_THRESHOLD) {
    regressions.push(`Recall: ${pct(baseline.recall)} → ${pct(current.recall)} (dropped ${pct(recDrop)})`);
  }
  return regressions;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const saveBaseline = args.includes('--save');
const autoRollback = args.includes('--auto-rollback');

console.log('\n=== Spill Relevance Filter Test Harness ===');
console.log(`Org: ${ORG.name}`);
console.log(`Posts: ${RELEVANT_POSTS.length} relevant + ${IRRELEVANT_POSTS.length} irrelevant = ${ALL_POSTS.length} total`);
console.log('\nRunning AI relevance filter...');

const kept = await runRelevanceFilter(ALL_POSTS);
const metrics = computeMetrics(ALL_POSTS, kept);

printMetrics(metrics, 'Current Run Results');

// Baseline comparison
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

if (saveBaseline || !existsSync(BASELINE_FILE)) {
  const baselineData = {
    saved_at: new Date().toISOString(),
    precision: metrics.precision,
    recall: metrics.recall,
    f1: metrics.f1,
    accuracy: metrics.accuracy,
    TP: metrics.TP, FP: metrics.FP, FN: metrics.FN, TN: metrics.TN,
    kept: metrics.kept,
    corpus_size: metrics.total,
  };
  writeFileSync(BASELINE_FILE, JSON.stringify(baselineData, null, 2));
  console.log(`\n✓ Baseline saved → ${BASELINE_FILE}`);
} else {
  const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8'));
  console.log(`\nBaseline (${baseline.saved_at.slice(0, 10)}): precision=${pct(baseline.precision)} recall=${pct(baseline.recall)} f1=${pct(baseline.f1)}`);

  const regressions = checkRegression(metrics, baseline);
  if (regressions.length === 0) {
    console.log('✓ No regression detected — accuracy maintained or improved');
  } else {
    console.log('\n⚠ REGRESSION DETECTED — accuracy dropped > 5%:');
    regressions.forEach(r => console.log(`  • ${r}`));
    console.log('\nRecommended rollback:');
    console.log('  git revert HEAD --no-edit');
    console.log('  # or to revert a specific commit:');
    console.log('  git log --oneline -5   # find the bad commit');
    console.log('  git revert <sha>');

    if (autoRollback) {
      console.log('\nAuto-rollback enabled — running: git revert HEAD --no-edit');
      const { execSync } = await import('child_process');
      try {
        execSync('git revert HEAD --no-edit', { cwd: join(__dirname, '..'), stdio: 'inherit' });
        console.log('✓ Rollback committed');
      } catch (err) {
        console.error('Rollback failed:', err.message);
      }
    }

    process.exit(1);
  }
}

// Save full result log
const logFile = join(RESULTS_DIR, `relevance-run-${Date.now()}.json`);
writeFileSync(logFile, JSON.stringify({
  run_at: new Date().toISOString(),
  org: ORG.name,
  metrics: { precision: metrics.precision, recall: metrics.recall, f1: metrics.f1, accuracy: metrics.accuracy, TP: metrics.TP, FP: metrics.FP, FN: metrics.FN, TN: metrics.TN },
  false_positives: metrics.falsePositives.map(p => ({ id: p.id, title: p.title })),
  false_negatives: metrics.falseNegatives.map(p => ({ id: p.id, title: p.title })),
}, null, 2));
console.log(`\nFull result log → ${logFile}`);
console.log('\nDone.\n');
