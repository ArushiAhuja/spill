import { query } from './db.js';

let _done = false;

export async function ensureMigrations() {
  if (_done) return;

  // posts extensions — created_at tracks DB insertion time for incident detection
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_competitor BOOLEAN DEFAULT false`);
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS competitor_name TEXT`);
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_influencer BOOLEAN DEFAULT false`);
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS response_template TEXT`);
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS post_status TEXT DEFAULT 'unread'`);
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ`);
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ`);

  // organizations extensions
  await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS digest_enabled BOOLEAN DEFAULT false`);
  await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS digest_frequency TEXT DEFAULT 'daily'`);
  await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS digest_recipients TEXT[] DEFAULT '{}'`);
  await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS digest_last_sent TIMESTAMPTZ`);
  await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS digest_gmail_user TEXT`);
  await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS digest_gmail_app_password TEXT`);
  await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS slack_webhook_url TEXT`);
  await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS competitors TEXT[] DEFAULT '{}'`);
  await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS industry_monitoring BOOLEAN DEFAULT false`);
  await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS industry_keywords TEXT[] DEFAULT '{}'`);
  await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS intel_profile JSONB`);

  // organizations website field (may have been added after initial schema)
  await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS website TEXT`);

  // incidents
  await query(`
    CREATE TABLE IF NOT EXISTS incidents (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
      category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
      title TEXT,
      status TEXT DEFAULT 'open',
      post_count INTEGER DEFAULT 0,
      started_at TIMESTAMPTZ DEFAULT NOW(),
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Backfill created_at if incidents table was created before this column was added
  await query(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);

  await query(`
    CREATE TABLE IF NOT EXISTS incident_posts (
      incident_id UUID REFERENCES incidents(id) ON DELETE CASCADE,
      post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
      PRIMARY KEY (incident_id, post_id)
    )
  `);

  // email-thread feedback loop
  await query(`
    CREATE TABLE IF NOT EXISTS response_threads (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
      post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
      message_id TEXT UNIQUE,
      recipient TEXT,
      current_template TEXT,
      iteration INTEGER DEFAULT 1,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // posts new columns
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS notes TEXT`);
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS location_tag TEXT`);
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_partner BOOLEAN DEFAULT false`);
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS partner_name TEXT`);
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS follower_count INTEGER`);

  // organizations new columns
  await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS partner_brands TEXT[] DEFAULT '{}'`);
  await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS incident_threshold INTEGER DEFAULT 5`);

  // source_configs health tracking
  await query(`ALTER TABLE source_configs ADD COLUMN IF NOT EXISTS last_fetch_at TIMESTAMPTZ`);
  await query(`ALTER TABLE source_configs ADD COLUMN IF NOT EXISTS last_fetch_error TEXT`);

  // escalation deduplication log
  await query(`
    CREATE TABLE IF NOT EXISTS escalation_fire_log (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
      rule_id UUID REFERENCES escalation_rules(id) ON DELETE CASCADE,
      category_id UUID,
      fire_count INTEGER DEFAULT 1,
      last_fired_at TIMESTAMPTZ DEFAULT NOW(),
      window_start TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_efl_rule_cat ON escalation_fire_log(rule_id, category_id, last_fired_at)`);

  // Phase 3: post workflow columns
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS manually_escalated BOOLEAN DEFAULT false`);
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS dismiss_reason TEXT`);
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS saved_at TIMESTAMPTZ`);

  // Phase 7: invitation system
  await query(`
    CREATE TABLE IF NOT EXISTS invitations (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      role TEXT DEFAULT 'member',
      invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
      status TEXT DEFAULT 'pending',
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_invitations_org ON invitations(org_id, status)`);

  // Phase 3: AI classification feedback
  await query(`
    CREATE TABLE IF NOT EXISTS post_feedback (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
      post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
      field TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Phase 4: feedback learning loop — label + explanation columns
  await query(`ALTER TABLE post_feedback ADD COLUMN IF NOT EXISTS label TEXT`);
  await query(`ALTER TABLE post_feedback ADD COLUMN IF NOT EXISTS explanation TEXT`);

  // Phase 10: enterprise ops
  // Activity / audit log
  await query(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      user_name TEXT,
      entity_type TEXT NOT NULL,
      entity_id UUID,
      entity_title TEXT,
      action TEXT NOT NULL,
      meta JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_activity_log_org ON activity_log(org_id, created_at DESC)`);

  // Post snooze
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ`);

  // Escalation rule mute windows (stored as JSONB array)
  await query(`ALTER TABLE escalation_rules ADD COLUMN IF NOT EXISTS mute_windows JSONB DEFAULT '[]'`);

  _done = true;
}
