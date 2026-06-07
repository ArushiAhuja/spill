// Trigger the onboard endpoint for mamaearth-m9wo to regenerate AI categories
// Generates a signed JWT for ghazal@mamaearth.in and calls the API

import jwt from 'jsonwebtoken';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_T2Kz4ParieQD@ep-soft-wave-aqors7te-pooler.c-8.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require',
  connectionTimeoutMillis: 15000,
  ssl: { rejectUnauthorized: false },
});

const JWT_SECRET = 'spill_jwt_secret_v2_change_in_prod';
const ORG_SLUG = 'mamaearth-m9wo';
const USER_EMAIL = 'ghazal@mamaearth.in';

async function run() {
  const client = await pool.connect();
  try {
    // Get user ID for ghazal@mamaearth.in
    const { rows: userRows } = await client.query(
      'SELECT id, email FROM users WHERE email = $1',
      [USER_EMAIL]
    );
    if (!userRows.length) {
      console.error('User not found:', USER_EMAIL);
      return;
    }
    const user = userRows[0];
    console.log('User:', user);

    // Sign a JWT
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1h' });
    console.log('JWT generated (first 40 chars):', token.slice(0, 40) + '...');

    // Call the onboard endpoint on production
    const url = `https://getspill.vercel.app/api/orgs/${ORG_SLUG}/onboard`;
    console.log('\nCalling:', url);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    console.log('HTTP status:', res.status);
    const body = await res.json();

    if (res.ok) {
      console.log('\nOnboard succeeded!');
      console.log('ai_generated:', body.ai_generated);
      console.log('categories count:', body.categories?.length);
      console.log('categories:', body.categories?.map(c => `${c.name} (severity=${c.severity})`));
      console.log('sources count:', body.sources?.length);
      console.log('sources:', body.sources?.map(s => `${s.source} enabled=${s.enabled}`));
    } else {
      console.error('\nOnboard failed:', body);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(console.error);
