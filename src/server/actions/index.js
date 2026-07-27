import { sendEmail } from './emailer.js';
import { appendToSheet } from './sheets.js';
import { sendSlack } from './slack.js';
import { query } from '../db.js';
import { recordTraceObservation } from '../observability.js';

function isInMuteWindow(muteWindows) {
  if (!muteWindows?.length) return false
  const now = new Date()
  const hhmm = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`
  return muteWindows.some(w => {
    if (!w.start || !w.end) return false
    if (w.start <= w.end) return hhmm >= w.start && hhmm < w.end
    return hhmm >= w.start || hhmm < w.end // crosses midnight
  })
}

export async function fireEscalations(posts, { orgId, rules, categories }) {
  const THRESHOLDS = [1, 10, 25, 50, 100]
  const WINDOW_MINUTES = 60

  for (const post of posts) {
    for (const rule of rules) {
      const categoryMatch = rule.category_ids.length === 0 || rule.category_ids.includes(post.category_id)
      const scoreMatch = post.escalation_score >= rule.score_threshold
      if (!categoryMatch || !scoreMatch) continue
      if (isInMuteWindow(rule.mute_windows)) continue

      const category = categories.find(c => c.id === post.category_id)
      const catId = post.category_id || null

      // Check dedup: has this rule fired for this category in the last WINDOW_MINUTES?
      let prevCount = 0
      try {
        const { rows: logs } = await query(
          `SELECT fire_count FROM escalation_fire_log
           WHERE rule_id = $1 AND (($2::uuid IS NULL AND category_id IS NULL) OR category_id = $2)
             AND window_start > NOW() - ($3 || ' minutes')::interval
           ORDER BY last_fired_at DESC LIMIT 1`,
          [rule.id, catId, WINDOW_MINUTES]
        )
        prevCount = logs[0]?.fire_count || 0
      } catch { /* first time, prevCount = 0 */ }

      // Count escalated posts for this category in the last 2 hours
      let currentCount = 1
      try {
        const { rows: countRows } = await query(
          `SELECT COUNT(*) as count FROM posts
           WHERE org_id = $1 AND escalated = true
             AND ($2::uuid IS NULL OR category_id = $2)
             AND created_at > NOW() - INTERVAL '2 hours'`,
          [orgId, catId]
        )
        currentCount = parseInt(countRows[0]?.count || 1)
      } catch { /* use 1 */ }

      // Fire only if we crossed a new threshold
      const nextThreshold = THRESHOLDS.find(t => t > prevCount && currentCount >= t)
      if (!nextThreshold) continue

      const emailRecipients = rule.config.emails?.length
        ? rule.config.emails
        : rule.config.to?.trim().split(/[\s,]+/).filter(Boolean)
      const normalised = { ...rule.config, emails: emailRecipients }

      let fired = false
      let delivery = null
      const actionStartedAt = Date.now()
      try {
        if (rule.action_type === 'email' && emailRecipients?.length) {
          const { messageId, recipients } = await sendEmail(post, category, normalised)
          if (messageId && post.response_template && post.db_id) {
            await createResponseThread(orgId, post.db_id, messageId, recipients[0]).catch(() => {})
          }
          fired = true
          delivery = { destination: 'email', recipients, message_id: messageId || null }
        } else if (rule.action_type === 'slack' && (rule.config.webhook_url || rule.config.slack_webhook_url)) {
          await sendSlack(post, category, rule.config)
          fired = true
          delivery = { destination: 'slack', channel: rule.config.channel_name || 'configured webhook' }
        } else if (rule.action_type === 'sheets' && rule.config.sheet_id) {
          await appendToSheet(post, category, rule.config)
          fired = true
          delivery = { destination: 'google_sheets', sheet_id: rule.config.sheet_id }
        } else if (rule.action_type === 'webhook' && rule.config.url) {
          await fireWebhook(post, category, rule.config)
          fired = true
          delivery = { destination: 'webhook', url: rule.config.url }
        }
      } catch (err) {
        console.error(`action error (rule ${rule.id}):`, err.message)
        await recordTraceObservation(post.ai_trace_id, {
          name: 'Alert delivery', kind: 'action', input: { rule_id: rule.id, action_type: rule.action_type },
          output: { delivered: false }, latencyMs: Date.now() - actionStartedAt, error: err.message,
        }).catch(() => {})
      }

      if (!fired) continue
      await recordTraceObservation(post.ai_trace_id, {
        name: 'Alert delivery', kind: 'action', input: { rule_id: rule.id, action_type: rule.action_type, threshold: rule.score_threshold },
        output: { delivered: true, ...delivery }, latencyMs: Date.now() - actionStartedAt,
      }).catch(() => {})

      // Upsert fire log
      try {
        if (prevCount === 0) {
          await query(
            `INSERT INTO escalation_fire_log (org_id, rule_id, category_id, fire_count)
             VALUES ($1, $2, $3, $4)`,
            [orgId, rule.id, catId, currentCount]
          )
        } else {
          await query(
            `UPDATE escalation_fire_log SET fire_count = $1, last_fired_at = NOW()
             WHERE rule_id = $2 AND (($3::uuid IS NULL AND category_id IS NULL) OR category_id = $3)
               AND window_start > NOW() - ($4 || ' minutes')::interval`,
            [currentCount, rule.id, catId, WINDOW_MINUTES]
          )
        }
      } catch { /* non-critical */ }
    }
  }
}

async function createResponseThread(orgId, postId, messageId, recipient) {
  const { rows: [post] } = await query(
    'SELECT response_template FROM posts WHERE id = $1',
    [postId]
  );
  if (!post?.response_template) return;

  await query(`
    INSERT INTO response_threads (org_id, post_id, message_id, recipient, current_template)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (message_id) DO NOTHING
  `, [orgId, postId, messageId, recipient, post.response_template]);
}

async function fireWebhook(post, category, config) {
  await fetch(config.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: post.source,
      title: post.title,
      url: post.url,
      score: post.escalation_score,
      category: category?.name,
      reasoning: post.reasoning,
      is_competitor: post.is_competitor,
      competitor_name: post.competitor_name,
      is_influencer: post.is_influencer,
    }),
  });
}
