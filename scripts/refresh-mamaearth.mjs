// Refresh Mamaearth (mamaearth-m9wo) source configs with comprehensive queries
// Run with: node scripts/refresh-mamaearth.mjs

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_T2Kz4ParieQD@ep-soft-wave-aqors7te-pooler.c-8.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require',
  connectionTimeoutMillis: 15000,
  ssl: { rejectUnauthorized: false },
});

const ORG_ID = 'd6f3b279-31fa-4d65-9662-9c46343d04f6';

const INTEL_PROFILE = {
  brandKeywords: ['mamaearth', 'mama earth', 'mamaearth.in', 'honeybee gardens'],
  productKeywords: [
    'onion hair oil', 'ubtan face wash', 'vitamin c serum', 'niacinamide serum',
    'natural moisturizer', 'toxin free baby care', 'anti hair fall shampoo',
    'mamaearth sunscreen', 'mamaearth face mask', 'mamaearth conditioner',
    'BHA exfoliant india', 'salicylic acid cleanser india',
  ],
  customerPainPoints: [
    'breakout after using', 'hair fall increased', 'no results after months',
    'rash from product', 'fake product delivered', 'refund not processed',
    'wrong item sent', 'expired product received', 'misleading claims',
    'burning sensation', 'allergic reaction', 'not toxin free actually',
  ],
  operationalRiskQueries: [
    'mamaearth fake products india', 'mamaearth adulterated complaint',
    'mamaearth misleading advertising india', 'mamaearth FSSAI violation',
    'D2C beauty brand fraud india', 'natural skincare false claims india',
    'mamaearth stock NSE controversy', 'mamaearth IPO loss',
  ],
  customerIntentQueries: [
    'best natural shampoo india 2024', 'toxin free baby products india',
    'mamaearth vs biotique vs himalaya', 'D2C skincare brand india honest review',
    'onion hair oil does it work', 'niacinamide serum affordable india',
    'baby care products without chemicals india', 'skincare routine india oily skin',
  ],
  highRiskTopics: [
    'FSSAI non-compliance', 'false advertising', 'greenwashing', 'misleading natural claims',
    'skin irritation lawsuit', 'ASCI complaint', 'IPO concerns',
  ],
  geographyTerms: ['india', 'delhi', 'mumbai', 'bangalore', 'gurgaon'],
  exclusionTerms: ['mama earth band', 'mama earth non-profit', 'mama earth charity'],
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
    ],
    context_queries: [
      'natural skincare india review',
      'toxin free skincare india',
      'D2C beauty brand india complaint',
      'baby products india toxic chemicals',
      'onion hair oil review india',
      'niacinamide serum affordable india',
      'vitamin c serum india honest review',
      'natural baby care india safe',
      'skincare india recommendation oily skin',
      'hairfall solution india home remedy',
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
      'natural cosmetics india startup',
      'beauty brand india greenwashing',
    ],
  },
  google_news: {
    rss_urls: [
      'https://news.google.com/rss/search?q=mamaearth&hl=en-IN&gl=IN&ceid=IN:en',
      'https://news.google.com/rss/search?q=mamaearth+complaint+OR+controversy+OR+ASCI&hl=en-IN&gl=IN&ceid=IN:en',
      'https://news.google.com/rss/search?q=%22mama+earth%22&hl=en-IN&gl=IN&ceid=IN:en',
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

    // Verify org exists
    const { rows: orgRows } = await client.query(
      'SELECT id, name, slug FROM organizations WHERE id = $1',
      [ORG_ID]
    );
    if (!orgRows.length) {
      console.error('Org not found:', ORG_ID);
      return;
    }
    console.log('Org:', orgRows[0]);

    // Update each source config
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
      console.log(`Updated ${source}:`, rows[0]);
    }

    // Update intel_profile on org
    await client.query(
      'UPDATE organizations SET intel_profile = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(INTEL_PROFILE), ORG_ID]
    );
    console.log('Updated intel_profile on org');

    // Show final source_configs state
    const { rows: finalRows } = await client.query(
      `SELECT source, enabled,
              config->'queries' as queries,
              config->'subreddits' as subreddits,
              config->'app_ids' as app_ids
       FROM source_configs WHERE org_id = $1 ORDER BY source`,
      [ORG_ID]
    );
    console.log('\nFinal source configs:');
    for (const row of finalRows) {
      console.log(`  ${row.source} (enabled=${row.enabled}):`, JSON.stringify({
        queries: row.queries,
        subreddits: row.subreddits,
        app_ids: row.app_ids,
      }));
    }

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(console.error);
