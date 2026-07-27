import { query } from './db.js';

// Bump when adding new migration steps. Cold starts check ONE DB query instead of
// replaying all 55 ALTER/CREATE statements, keeping route cold-start overhead < 50ms.
const MIGRATION_VERSION = 23;

export async function ensureMigrations() {
  // Fast path: check DB-persisted version. Creates app_settings on first ever run.
  // If the table doesn't exist yet this query throws → fall through to full migration.
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    const { rows } = await query(
      `SELECT value FROM app_settings WHERE key = 'migration_version'`
    );
    const dbVersion = parseInt(rows[0]?.value || '0', 10);
    if (dbVersion >= MIGRATION_VERSION) return;
  } catch {
    // If the check itself fails, proceed and attempt the full migration.
  }

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
  await query(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);

  await query(`
    CREATE TABLE IF NOT EXISTS incident_posts (
      incident_id UUID REFERENCES incidents(id) ON DELETE CASCADE,
      post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
      PRIMARY KEY (incident_id, post_id)
    )
  `);

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

  // AI classification feedback
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
  await query(`ALTER TABLE post_feedback ADD COLUMN IF NOT EXISTS label TEXT`);
  await query(`ALTER TABLE post_feedback ADD COLUMN IF NOT EXISTS explanation TEXT`);

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

  // Plan column on organizations
  await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'monitor'`);
  await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS sla_first_response_minutes INTEGER DEFAULT 60`);
  await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS sla_subsequent_minutes INTEGER DEFAULT 240`);
  await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS alert_influencer_threshold INTEGER DEFAULT 10000`);
  await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS alert_viral_likes INTEGER DEFAULT 500`);

  // Tickets — multi-channel social ticketing
  await query(`
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
  await query(`CREATE INDEX IF NOT EXISTS idx_tickets_org ON tickets(org_id, status, created_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tickets_post ON tickets(post_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tickets_assigned ON tickets(assigned_to)`);

  // Ticket notes
  await query(`
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
  await query(`CREATE INDEX IF NOT EXISTS idx_ticket_notes_ticket ON ticket_notes(ticket_id, created_at)`);

  // Canned responses
  await query(`
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
  await query(`CREATE INDEX IF NOT EXISTS idx_canned_responses_org ON canned_responses(org_id)`);

  // organizations: feature flags
  await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS features JSONB DEFAULT '{}'`);

  // tickets: MMT-specific columns
  await query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS customer_labels TEXT[] DEFAULT '{}'`);
  await query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS mention_count INTEGER DEFAULT 1`);
  await query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS verified_handle BOOLEAN DEFAULT false`);
  await query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS booking_details JSONB DEFAULT '{}'`);
  await query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS is_sticky BOOLEAN DEFAULT false`);
  await query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS reopen_count INTEGER DEFAULT 0`);
  await query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS awaiting_customer BOOLEAN DEFAULT false`);
  await query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS last_customer_reply_at TIMESTAMPTZ`);

  // agent_sessions table (MMT timesheet)
  await query(`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      user_name TEXT,
      user_email TEXT,
      session_date DATE NOT NULL DEFAULT CURRENT_DATE,
      login_at TIMESTAMPTZ DEFAULT NOW(),
      logout_at TIMESTAMPTZ,
      break_minutes INTEGER DEFAULT 0,
      notes TEXT,
      tickets_worked INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // mmt_outage_log table
  await query(`
    CREATE TABLE IF NOT EXISTS mmt_outage_log (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'ongoing',
      impact TEXT,
      root_cause TEXT,
      resolution TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_agent_sessions_org ON agent_sessions(org_id, session_date DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_agent_sessions_user ON agent_sessions(user_id, session_date DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_outage_log_org ON mmt_outage_log(org_id, created_at DESC)`);

  // post_feedback.field was created NOT NULL but label-only feedback has no field
  await query(`ALTER TABLE post_feedback ALTER COLUMN field DROP NOT NULL`);

  // Index for fast per-org feedback lookups (getOrgFeedbackContext runs every refresh cycle)
  await query(`CREATE INDEX IF NOT EXISTS idx_post_feedback_org ON post_feedback(org_id, created_at DESC)`);

  // Distinguish implicit signals (save/dismiss actions) from explicit feedback (feedback panel)
  await query(`ALTER TABLE post_feedback ADD COLUMN IF NOT EXISTS signal_type TEXT DEFAULT 'explicit'`);

  // Escalation Engine V2: per-dimension scoring (customer_impact, operational_urgency, trust_risk, virality_potential)
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS escalation_dimensions JSONB`);

  // Feedback Learning V2: store what adjustment resulted from each piece of feedback
  await query(`ALTER TABLE post_feedback ADD COLUMN IF NOT EXISTS resulting_adjustment TEXT`);
  // Store direction for wrong_severity feedback ('lower' | 'higher')
  await query(`ALTER TABLE post_feedback ADD COLUMN IF NOT EXISTS severity_direction TEXT`);

  // Phase C — Prompt Management: versioned, org-scoped editable AI prompts
  await query(`
    CREATE TABLE IF NOT EXISTS prompts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      prompt_key TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      content TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(org_id, prompt_key)
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS prompt_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      prompt_key TEXT NOT NULL,
      version INTEGER NOT NULL,
      author_email TEXT,
      change_summary TEXT,
      old_content TEXT,
      new_content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_prompt_versions_org_key ON prompt_versions(org_id, prompt_key, version DESC)`);

  // Organisation Intelligence / AI observability. A trace is deliberately independent
  // from posts: rejected candidates are useful debugging evidence too.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT false`);
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS ai_trace_id UUID`);
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS signal_quality JSONB`);
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS cluster_id UUID`);
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS duplicate_of UUID REFERENCES posts(id) ON DELETE SET NULL`);
  await query(`
    CREATE TABLE IF NOT EXISTS ai_traces (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      post_id UUID REFERENCES posts(id) ON DELETE SET NULL,
      source TEXT,
      status TEXT NOT NULL DEFAULT 'completed',
      decision TEXT,
      quality JSONB,
      metadata JSONB DEFAULT '{}',
      started_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS ai_observations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trace_id UUID NOT NULL REFERENCES ai_traces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'agent',
      model TEXT,
      prompt_key TEXT,
      prompt_version INTEGER,
      input JSONB,
      output JSONB,
      latency_ms INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_ai_traces_org_created ON ai_traces(org_id, created_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_ai_observations_trace ON ai_observations(trace_id, created_at)`);
  await query(`
    CREATE TABLE IF NOT EXISTS signal_clusters (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
      fingerprint TEXT NOT NULL,
      title TEXT NOT NULL,
      volume INTEGER NOT NULL DEFAULT 1,
      first_seen_at TIMESTAMPTZ DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(org_id, fingerprint)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_signal_clusters_org_seen ON signal_clusters(org_id, last_seen_at DESC)`);

  // Internal-console access can be granted narrowly to a single organisation.
  // A global super admin retains access to every organisation.
  await query(`
    CREATE TABLE IF NOT EXISTS observability_org_access (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(org_id, user_id)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_observability_access_user ON observability_org_access(user_id, org_id)`);

  // Organisation-aware agent registry. Prompt text remains versioned in prompts;
  // this table holds the per-agent operating policy, examples and evaluation
  // criteria that make two organisations run materially different AI behaviour.
  await query(`
    CREATE TABLE IF NOT EXISTS organization_agent_configs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      agent_name TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT true,
      model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
      priority_instructions TEXT NOT NULL DEFAULT '',
      ignore_instructions TEXT NOT NULL DEFAULT '',
      escalation_rules JSONB NOT NULL DEFAULT '{}',
      evaluation_criteria JSONB NOT NULL DEFAULT '{}',
      examples JSONB NOT NULL DEFAULT '[]',
      version INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(org_id, agent_name)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_agent_configs_org ON organization_agent_configs(org_id, agent_name)`);
  await query(`
    CREATE TABLE IF NOT EXISTS organization_agent_config_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      agent_name TEXT NOT NULL,
      version INTEGER NOT NULL,
      author_email TEXT,
      change_summary TEXT,
      config JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_agent_config_versions_org ON organization_agent_config_versions(org_id, agent_name, version DESC)`);

  // Canonical editable organisation profile. intel_profile remains Spill's learned
  // interpretation; this field is the human-owned source of truth.
  await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS organization_profile JSONB NOT NULL DEFAULT '{}'`);

  // Langfuse-style immutable trace/spans. UUID primary keys remain compatible;
  // friendly IDs make support conversations and audit trails readable.
  await query(`ALTER TABLE ai_traces ADD COLUMN IF NOT EXISTS trace_key TEXT`);
  await query(`ALTER TABLE ai_traces ADD COLUMN IF NOT EXISTS event_id UUID`);
  await query(`ALTER TABLE ai_observations ADD COLUMN IF NOT EXISTS span_key TEXT`);
  await query(`ALTER TABLE ai_observations ADD COLUMN IF NOT EXISTS prompt_snapshot JSONB`);
  await query(`ALTER TABLE ai_observations ADD COLUMN IF NOT EXISTS config_snapshot JSONB`);
  await query(`UPDATE ai_traces SET trace_key = 'spill_trace_' || replace(id::text, '-', '') WHERE trace_key IS NULL`);
  await query(`UPDATE ai_traces SET event_id = post_id WHERE event_id IS NULL AND post_id IS NOT NULL`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_traces_trace_key ON ai_traces(trace_key)`);
  await query(`UPDATE ai_observations SET span_key = 'spill_span_' || replace(id::text, '-', '') WHERE span_key IS NULL`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_observations_span_key ON ai_observations(span_key)`);

  // Evaluation cases are organisation-labelled ground truth. Runs are immutable
  // comparisons of a prompt/config/model against those cases.
  await query(`
    CREATE TABLE IF NOT EXISTS agent_evaluation_cases (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      post_id UUID REFERENCES posts(id) ON DELETE SET NULL,
      agent_name TEXT NOT NULL DEFAULT 'category',
      input JSONB NOT NULL,
      expected_output JSONB NOT NULL,
      bucket TEXT NOT NULL DEFAULT 'good_signal',
      notes TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_eval_cases_org_agent ON agent_evaluation_cases(org_id, agent_name, created_at DESC)`);
  await query(`
    CREATE TABLE IF NOT EXISTS agent_evaluation_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      agent_name TEXT NOT NULL,
      prompt_key TEXT,
      prompt_version INTEGER,
      config_version INTEGER,
      model TEXT,
      case_count INTEGER NOT NULL DEFAULT 0,
      metrics JSONB NOT NULL DEFAULT '{}',
      results JSONB NOT NULL DEFAULT '[]',
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_eval_runs_org_agent ON agent_evaluation_runs(org_id, agent_name, created_at DESC)`);

  // A/B experiments provide an explicit, auditable comparison contract rather
  // than silently swapping prompts in production.
  await query(`
    CREATE TABLE IF NOT EXISTS prompt_experiments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      agent_name TEXT NOT NULL,
      prompt_key TEXT NOT NULL,
      baseline_content TEXT NOT NULL,
      candidate_content TEXT NOT NULL,
      baseline_model TEXT,
      candidate_model TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )
  `);

  // Feedback is tied to the decisioning agent and trace so it can become a
  // reviewed example/evaluation case instead of anonymous aggregate text.
  await query(`ALTER TABLE post_feedback ADD COLUMN IF NOT EXISTS agent_name TEXT`);
  await query(`ALTER TABLE post_feedback ADD COLUMN IF NOT EXISTS trace_id UUID REFERENCES ai_traces(id) ON DELETE SET NULL`);
  await query(`ALTER TABLE post_feedback ADD COLUMN IF NOT EXISTS created_by TEXT`);

  // Persist completed version to DB so future cold starts skip all 55 queries
  await query(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('migration_version', $1, NOW())
    ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
  `, [String(MIGRATION_VERSION)]);
}
