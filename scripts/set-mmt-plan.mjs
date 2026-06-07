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

// Apply migration 12 columns if not present yet
await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'monitor'`);
await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS sla_first_response_minutes INTEGER DEFAULT 60`);
await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS sla_subsequent_minutes INTEGER DEFAULT 240`);
await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS alert_influencer_threshold INTEGER DEFAULT 10000`);
await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS alert_viral_likes INTEGER DEFAULT 500`);
await pool.query(`
  CREATE TABLE IF NOT EXISTS tickets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    post_id UUID REFERENCES posts(id) ON DELETE SET NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    channel TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    priority TEXT DEFAULT 'normal',
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    assigned_name TEXT,
    title TEXT NOT NULL,
    body TEXT,
    author TEXT,
    author_handle TEXT,
    follower_count INTEGER DEFAULT 0,
    url TEXT,
    tags TEXT[] DEFAULT '{}',
    sla_first_response_at TIMESTAMPTZ,
    first_responded_at TIMESTAMPTZ,
    sla_subsequent_at TIMESTAMPTZ,
    sla_breached BOOLEAN DEFAULT false,
    alert_sent BOOLEAN DEFAULT false,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )
`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_tickets_org ON tickets(org_id, status, created_at DESC)`);
await pool.query(`
  CREATE TABLE IF NOT EXISTS ticket_notes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE,
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    author_name TEXT,
    body TEXT NOT NULL,
    is_internal BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`);
await pool.query(`
  CREATE TABLE IF NOT EXISTS canned_responses (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    body TEXT NOT NULL,
    category TEXT,
    brand_personality TEXT DEFAULT 'professional',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )
`);
// Mark migration version in DB
await pool.query(`
  INSERT INTO app_settings (key, value, updated_at) VALUES ('migration_version', '12', NOW())
  ON CONFLICT (key) DO UPDATE SET value = '12', updated_at = NOW()
`);
console.log('Migration 12 applied.');

// Set MakeMyTrip to command_center and configure SLA defaults
const { rows } = await pool.query(`
  UPDATE organizations
  SET plan = 'command_center',
      sla_first_response_minutes = 15,
      sla_subsequent_minutes = 60,
      alert_influencer_threshold = 10000,
      alert_viral_likes = 200
  WHERE slug = 'makemytrip'
  RETURNING id, name, slug, plan, sla_first_response_minutes
`);

if (rows.length) {
  console.log('Updated:', rows[0]);
} else {
  console.log('makemytrip org not found — trying by email');
  const { rows: r2 } = await pool.query(`
    UPDATE organizations o
    SET plan = 'command_center', sla_first_response_minutes = 15, sla_subsequent_minutes = 60
    FROM org_members om JOIN users u ON u.id = om.user_id
    WHERE u.email = 'dk@makemytrip.com' AND om.org_id = o.id AND om.role = 'owner'
    RETURNING o.id, o.name, o.slug, o.plan
  `);
  console.log(r2.length ? 'Updated:' : 'Not found', r2[0]);
}

await pool.end();
