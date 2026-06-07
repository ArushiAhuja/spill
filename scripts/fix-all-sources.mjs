/**
 * Fix all source configs across all active orgs:
 *  1. Google News: set proper rss_urls (fetcher uses rss_urls, not queries)
 *  2. Play Store: set correct app_ids array
 *  3. Twitter: enable for orgs that have a bearer token configured
 *  4. Reddit: ensure all orgs have strong query sets
 */

import pg from 'pg';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(__dirname, '../.env.local');
for (const line of readFileSync(envFile, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
  if (m) process.env[m[1]] = m[2];
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const TWITTER_BEARER = process.env.TWITTER_BEARER_TOKEN;

function gnRSS(query) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
}

// Per-org config patches. Key = org slug.
const ORG_PATCHES = {
  'swiggy-4q30': {
    google_news: {
      rss_urls: [
        gnRSS('Swiggy India'),
        gnRSS('Swiggy food delivery complaint'),
        gnRSS('Swiggy Instamart'),
        gnRSS('Swiggy app'),
      ],
    },
    playstore: {
      app_ids: ['in.swiggy.android'],
    },
    twitter: {
      queries: ['"Swiggy" OR "@Swiggy_In" OR "#Swiggy" -is:retweet lang:en'],
      credentials: { bearer_token: TWITTER_BEARER },
    },
  },

  'makemytrip': {
    google_news: {
      rss_urls: [
        gnRSS('MakeMyTrip'),
        gnRSS('MakeMyTrip flight booking complaint'),
        gnRSS('MakeMyTrip hotel refund'),
        gnRSS('MMT travel India'),
      ],
    },
    playstore: {
      app_ids: ['com.makemytrip'],
    },
    twitter: {
      queries: ['"MakeMyTrip" OR "@makemytrip" OR "#MakeMyTrip" OR "MMT booking" -is:retweet lang:en'],
      credentials: { bearer_token: TWITTER_BEARER },
    },
  },

  'mamaearth-m9wo': {
    google_news: {
      rss_urls: [
        gnRSS('Mamaearth skincare India'),
        gnRSS('Mamaearth products review'),
        gnRSS('Mamaearth D2C brand'),
        gnRSS('Honasa Consumer Mamaearth'),
      ],
    },
    playstore: {
      app_ids: ['com.mamaearth.app'],
    },
    // twitter already configured for this org
  },

  'mamaearth': {
    google_news: {
      rss_urls: [
        gnRSS('Mamaearth skincare India'),
        gnRSS('Mamaearth products review'),
        gnRSS('Honasa Consumer Mamaearth'),
      ],
    },
    playstore: {
      app_ids: ['com.mamaearth.app'],
    },
  },

  'chimes-aviation': {
    google_news: {
      rss_urls: [
        gnRSS('Chimes Aviation India'),
        gnRSS('Chimes Aviation Academy pilot training'),
        gnRSS('India pilot training school'),
      ],
    },
    twitter: {
      queries: ['"Chimes Aviation" OR "chimesaviation" OR "#ChimesAviation" -is:retweet lang:en'],
      credentials: { bearer_token: TWITTER_BEARER },
    },
  },

  'chimes-aviation-academy': {
    google_news: {
      rss_urls: [
        gnRSS('Chimes Aviation Academy India'),
        gnRSS('India pilot training aviation school'),
        gnRSS('DGCA pilot license India'),
      ],
    },
    playstore: {
      enabled: false, // no Play Store app
    },
    twitter: {
      queries: ['"Chimes Aviation" OR "#ChimesAviationAcademy" OR "chimes pilot training" -is:retweet lang:en'],
      credentials: { bearer_token: TWITTER_BEARER },
    },
  },

  'uber-eats': {
    google_news: {
      rss_urls: [
        gnRSS('Uber Eats India'),
        gnRSS('Uber Eats food delivery complaint India'),
        gnRSS('Uber Eats app'),
      ],
    },
    playstore: {
      app_ids: ['com.ubercab.eats'],
    },
    twitter: {
      queries: ['"Uber Eats" OR "@UberEats" OR "#UberEats" -is:retweet lang:en'],
      credentials: { bearer_token: TWITTER_BEARER },
    },
  },

  'deliveroo': {
    google_news: {
      rss_urls: [
        gnRSS('Deliveroo food delivery'),
        gnRSS('Deliveroo complaint refund'),
        gnRSS('Deliveroo app UK'),
      ],
    },
    playstore: {
      app_ids: ['com.deliveroo.orderapp'],
    },
    twitter: {
      queries: ['"Deliveroo" OR "@Deliveroo" OR "#Deliveroo" -is:retweet lang:en'],
      credentials: { bearer_token: TWITTER_BEARER },
    },
  },

  'y-combinator': {
    google_news: {
      rss_urls: [
        gnRSS('Y Combinator startup'),
        gnRSS('YC batch funding startup'),
        gnRSS('Y Combinator application'),
        gnRSS('YC demo day'),
      ],
    },
    twitter: {
      queries: ['"Y Combinator" OR "@ycombinator" OR "#YCombinator" OR "YC batch" -is:retweet lang:en'],
      credentials: { bearer_token: TWITTER_BEARER },
    },
  },

  // Old broken orgs — fix what's there but don't add Twitter spam
  'swiggy': {
    google_news: {
      rss_urls: [
        gnRSS('Swiggy India food delivery'),
        gnRSS('Swiggy complaint'),
      ],
    },
    playstore: {
      app_ids: ['in.swiggy.android'],
    },
  },

  'swiggy2': {
    // test org — reset to sensible Swiggy configs
    google_news: {
      rss_urls: [gnRSS('Swiggy India'), gnRSS('Swiggy food delivery')],
    },
    reddit: {
      queries: ['swiggy', 'swiggy instamart', 'swiggy complaint'],
      subreddits: ['india', 'bangalore', 'mumbai', 'delhi', 'hyderabad', 'FoodIndia'],
      context_queries: ['Swiggy food delivery', 'Swiggy Instamart'],
    },
  },
};

// Apply patches
for (const [slug, patch] of Object.entries(ORG_PATCHES)) {
  const { rows: [org] } = await pool.query(
    'SELECT id, name FROM organizations WHERE slug = $1',
    [slug]
  );
  if (!org) { console.log(`  [skip] ${slug} — not found`); continue; }

  console.log(`\n[${org.name}] (${slug})`);

  for (const [source, cfg] of Object.entries(patch)) {
    const { rows: [existing] } = await pool.query(
      'SELECT id, config, credentials, enabled FROM source_configs WHERE org_id = $1 AND source = $2',
      [org.id, source]
    );

    if (!existing) {
      // Insert new source config
      if (cfg.enabled === false) {
        console.log(`  ${source}: skip (disabled and not present)`);
        continue;
      }
      const { credentials, enabled, ...configFields } = cfg;
      await pool.query(
        `INSERT INTO source_configs (org_id, source, enabled, config, credentials)
         VALUES ($1, $2, true, $3, $4)`,
        [org.id, source, JSON.stringify(configFields), JSON.stringify(credentials || {})]
      );
      console.log(`  ${source}: created with ${JSON.stringify(configFields).slice(0, 100)}`);
    } else {
      // Merge config into existing
      const { credentials: newCreds, enabled: enabledFlag, ...configFields } = cfg;
      const mergedConfig = { ...(existing.config || {}), ...configFields };
      const mergedCreds = newCreds
        ? { ...(existing.credentials || {}), ...newCreds }
        : existing.credentials;
      const shouldEnable = enabledFlag !== false;

      await pool.query(
        `UPDATE source_configs
         SET config = $1, credentials = $2, enabled = $3, last_fetch_error = NULL
         WHERE id = $4`,
        [JSON.stringify(mergedConfig), JSON.stringify(mergedCreds), shouldEnable, existing.id]
      );

      const keyChanges = Object.keys(configFields).join(', ');
      console.log(`  ${source}: updated (${keyChanges}) enabled=${shouldEnable}`);
    }
  }
}

// Also enable Twitter for any org that has a twitter source_config but it's disabled
// and just needs the bearer token
const { rows: disabledTwitter } = await pool.query(`
  SELECT sc.id, o.name, o.slug FROM source_configs sc
  JOIN organizations o ON o.id = sc.org_id
  WHERE sc.source = 'twitter' AND sc.enabled = false
  AND o.onboarded = true
`);

for (const row of disabledTwitter) {
  if (!ORG_PATCHES[row.slug]?.twitter) {
    console.log(`\n[${row.name}] enabling existing twitter config`);
    await pool.query(
      `UPDATE source_configs SET enabled = true,
         credentials = jsonb_set(COALESCE(credentials, '{}'::jsonb), '{bearer_token}', $1::jsonb)
       WHERE id = $2`,
      [JSON.stringify(TWITTER_BEARER), row.id]
    );
  }
}

// Summary
console.log('\n\n=== RESULT ===');
const { rows: summary } = await pool.query(`
  SELECT o.name, o.slug,
    string_agg(sc.source || '(' || CASE WHEN sc.enabled THEN 'on' ELSE 'off' END || ')', ', ' ORDER BY sc.source) as sources
  FROM organizations o
  JOIN source_configs sc ON sc.org_id = o.id
  WHERE o.onboarded = true
  GROUP BY o.id
  ORDER BY o.name
`);
for (const row of summary) {
  console.log(`${row.name} (${row.slug}): ${row.sources}`);
}

await pool.end();
