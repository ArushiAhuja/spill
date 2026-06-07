// Full refresh for mamaearth-m9wo: categories + source configs + intel_profile
// OpenAI quota is exhausted, so doing this manually with Mamaearth-specific data
// Run: node scripts/refresh-mamaearth-full.mjs

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_T2Kz4ParieQD@ep-soft-wave-aqors7te-pooler.c-8.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require',
  connectionTimeoutMillis: 15000,
  ssl: { rejectUnauthorized: false },
});

const ORG_ID = 'd6f3b279-31fa-4d65-9662-9c46343d04f6';

const CATEGORIES = [
  { name: 'ingredient safety alert',   description: 'Reports of harmful/toxic ingredients, skin reactions, or allergies caused by Mamaearth products', severity: 28, color: '#f87171' },
  { name: 'fake & counterfeit',        description: 'Reports of counterfeit Mamaearth products, fake sellers on e-commerce platforms', severity: 26, color: '#f87171' },
  { name: 'side effect & reaction',    description: 'Direct adverse skin, hair, or scalp reactions reported by customers after using Mamaearth products', severity: 25, color: '#f87171' },
  { name: 'misleading claims',         description: 'Posts challenging "natural", "toxin-free", or "clinically proven" claims — greenwashing accusations, ASCI notices', severity: 22, color: '#60a5fa' },
  { name: 'refund & delivery issue',   description: 'Complaints about undelivered orders, refund delays, wrong items, or poor customer support', severity: 18, color: '#818cf8' },
  { name: 'regulatory & legal',        description: 'FSSAI violations, legal notices, ASCI complaints, IPO-related controversies, compliance issues', severity: 24, color: '#38bdf8' },
  { name: 'competitor comparison',     description: 'Posts comparing Mamaearth with Minimalist, The Ordinary, Biotique, Plum, or other skincare brands — often unfavourable', severity: 12, color: '#9b8ff7' },
  { name: 'positive review',           description: 'Customer praise, before/after results, influencer recommendations, positive community mentions', severity: 5, color: '#4ade80' },
  { name: 'noise',                     description: 'Low-signal or irrelevant mentions — unrelated brands, homonyms, generic beauty discussions', severity: 0, color: '#334155' },
];

const INTEL_PROFILE = {
  brandKeywords: ['mamaearth', 'mama earth', 'mamaearth.in', '@mamaearth'],
  productKeywords: [
    'onion hair oil', 'ubtan face wash', 'vitamin c serum', 'niacinamide serum',
    'toxin free baby care', 'anti hair fall shampoo', 'mamaearth sunscreen',
    'mamaearth face mask', 'BHA exfoliant india', 'salicylic acid cleanser india',
    'coco face wash', 'oil free moisturizer mamaearth',
  ],
  customerPainPoints: [
    'breakout after using mamaearth', 'hair fall increased after shampoo',
    'no results after 3 months', 'rash from mamaearth', 'fake product delivered',
    'refund not processed mamaearth', 'wrong item sent', 'expired product received',
    'burning sensation on face', 'allergic reaction mamaearth', 'not actually toxin free',
    'misleading natural claims', 'ASCI against mamaearth',
  ],
  operationalRiskQueries: [
    'mamaearth fake products india', 'mamaearth adulterated complaint',
    'mamaearth misleading advertising india', 'mamaearth FSSAI violation',
    'D2C beauty brand fraud india', 'natural skincare false claims india',
    'mamaearth stock NSE controversy', 'mamaearth greenwashing',
  ],
  customerIntentQueries: [
    'best natural shampoo india 2024', 'toxin free baby products india',
    'mamaearth vs biotique vs himalaya', 'D2C skincare brand india honest review',
    'onion hair oil does it work', 'niacinamide serum affordable india',
    'baby care products without chemicals india', 'skincare routine india oily skin',
    'mamaearth review reddit', 'mama earth honest review',
  ],
  highRiskTopics: [
    'FSSAI non-compliance', 'false advertising', 'greenwashing', 'misleading natural claims',
    'skin irritation lawsuit', 'ASCI complaint', 'IPO controversy', 'fake reviews',
  ],
  geographyTerms: ['india', 'delhi', 'mumbai', 'bangalore', 'gurgaon', 'IN'],
  exclusionTerms: ['mama earth organization', 'mama earth foundation', 'mama earth non-profit', 'mama earth charity', 'motherboard'],
};

const SOURCES = {
  reddit: {
    queries: [
      'mamaearth',
      'mama earth',
      'mamaearth review',
      'mamaearth complaint',
      'mamaearth side effects',
      'mamaearth fake',
      'mamaearth greenwashing',
    ],
    context_queries: [
      'natural skincare india honest review',
      'toxin free skincare india does it work',
      'D2C beauty brand india complaint',
      'baby products india toxic chemicals',
      'onion hair oil results india',
      'niacinamide serum affordable india comparison',
      'vitamin c serum india honest review',
      'natural baby care india safe ingredients',
      'skincare india recommendation oily combination skin',
      'hairfall solution india shampoo review',
      'ASCI misleading beauty ads india',
      'greenwashing natural beauty india',
    ],
    subreddits: [
      'india', 'IndianSkincareAddicts', 'SkincareAddiction',
      'IndianBeautyDeals', 'HairCareScience', 'delhi',
      'mumbai', 'bangalore', 'IndianMakeupAddicts', 'AsianBeauty',
    ],
    custom_threads: [],
    intel_profile: INTEL_PROFILE,
  },
  hackernews: {
    queries: [
      'mamaearth',
      'D2C skincare india',
      'natural cosmetics india startup greenwashing',
      'beauty brand india false claims',
      'honestmove mamaearth',
    ],
  },
  google_news: {
    rss_urls: [
      'https://news.google.com/rss/search?q=mamaearth&hl=en-IN&gl=IN&ceid=IN:en',
      'https://news.google.com/rss/search?q=mamaearth+complaint+OR+controversy+OR+ASCI+OR+FSSAI&hl=en-IN&gl=IN&ceid=IN:en',
      'https://news.google.com/rss/search?q=%22mama+earth%22+skincare&hl=en-IN&gl=IN&ceid=IN:en',
    ],
  },
  twitter: {
    queries: [
      '"mamaearth"',
      '#Mamaearth',
      '@mamaearth',
      '#MamaEarth',
      'mamaearth review',
      'mamaearth complaint',
      'mamaearth fake',
    ],
  },
  playstore: {
    app_ids: ['in.mamaearth.app'],
  },
};

async function run() {
  const client = await pool.connect();
  try {
    console.log('Connected to Neon DB');

    const { rows: orgRows } = await client.query(
      'SELECT id, name, slug FROM organizations WHERE id = $1',
      [ORG_ID]
    );
    if (!orgRows.length) {
      console.error('Org not found:', ORG_ID);
      return;
    }
    console.log('Org:', orgRows[0]);

    // Replace categories with Mamaearth-specific ones
    await client.query('DELETE FROM categories WHERE org_id = $1', [ORG_ID]);
    console.log('\nDeleted old categories');

    for (const cat of CATEGORIES) {
      const { rows } = await client.query(
        `INSERT INTO categories (org_id, name, description, severity, color)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, name, severity`,
        [ORG_ID, cat.name, cat.description, cat.severity, cat.color]
      );
      console.log('  Inserted category:', rows[0].name, `(severity=${rows[0].severity})`);
    }

    // Upsert source configs with comprehensive queries
    console.log('\nUpdating source configs...');
    for (const [source, config] of Object.entries(SOURCES)) {
      const { rows } = await client.query(
        `INSERT INTO source_configs (org_id, source, enabled, credentials, config)
         VALUES ($1, $2, true, '{}', $3)
         ON CONFLICT (org_id, source) DO UPDATE SET
           config = $3,
           enabled = true,
           updated_at = NOW()
         RETURNING id, source, enabled`,
        [ORG_ID, source, JSON.stringify(config)]
      );
      console.log(`  ${source}: enabled=${rows[0].enabled}`);
    }

    // Set intel_profile on org
    await client.query(
      'UPDATE organizations SET intel_profile = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(INTEL_PROFILE), ORG_ID]
    );
    console.log('\nUpdated intel_profile on org');

    // Summary
    const { rows: catSummary } = await client.query(
      'SELECT name, severity FROM categories WHERE org_id = $1 ORDER BY severity DESC',
      [ORG_ID]
    );
    console.log('\nFinal categories:');
    catSummary.forEach(c => console.log(`  [${c.severity}] ${c.name}`));

    const { rows: srcSummary } = await client.query(
      `SELECT source, enabled,
              jsonb_array_length(config->'queries') as query_count,
              jsonb_array_length(config->'subreddits') as subreddit_count
       FROM source_configs WHERE org_id = $1 ORDER BY source`,
      [ORG_ID]
    );
    console.log('\nFinal sources:');
    srcSummary.forEach(s =>
      console.log(`  ${s.source}: enabled=${s.enabled}, queries=${s.query_count ?? 'n/a'}, subreddits=${s.subreddit_count ?? 'n/a'}`)
    );

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(console.error);
