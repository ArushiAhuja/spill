import pg from 'pg';

const { Pool } = pg;

// Supabase / Neon / Azure Postgres Flexible all speak stock Postgres via DATABASE_URL.
// Prefer the *session* pooler (port 5432) or direct host for migrations; Transaction
// mode (6543) is fine for request-scoped queries but some session features differ.
const connectionString = process.env.DATABASE_URL || 'postgresql://localhost/spill';
const isRemote = /supabase\.co|neon\.tech|azure\.com|pooler\./i.test(connectionString);

const pool = new Pool({
  connectionString,
  max: Number(process.env.PG_POOL_MAX || 20),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  ssl: isRemote || process.env.PG_SSL === 'true'
    ? { rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : undefined,
});

pool.on('error', (err) => console.error('pg pool error:', err));

export default pool;
export const query = (text, params) => pool.query(text, params);
