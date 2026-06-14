import { query } from '../db.js';
import { sendEmail } from '../agentmail.js';

const SPIKE_MULTIPLIER = 2.5;

export async function checkAnomalies(orgId, newPostCount) {
  if (newPostCount < 5) return;

  try {
    const { rows: [stats] } = await query(`
      SELECT AVG(posts_fetched)::numeric as avg_posts
      FROM refresh_logs
      WHERE org_id = $1
        AND status = 'completed'
        AND completed_at > NOW() - INTERVAL '7 days'
        AND posts_fetched > 0
    `, [orgId]);

    const avg = parseFloat(stats?.avg_posts) || 0;
    if (avg < 2) return;

    if (newPostCount > avg * SPIKE_MULTIPLIER) {
      const ratio = (newPostCount / avg).toFixed(1);
      console.log(`[anomaly] org ${orgId}: spike ${newPostCount} posts (${ratio}x avg ${avg.toFixed(0)})`);
      await notifyAnomaly(orgId, newPostCount, avg, ratio);
    }
  } catch (err) {
    console.error('[anomaly] check error:', err.message);
  }
}

async function notifyAnomaly(orgId, count, avg, ratio) {
  try {
    const { rows: [org] } = await query(
      'SELECT name FROM organizations WHERE id = $1', [orgId]
    );

    const { rows: rules } = await query(
      `SELECT * FROM escalation_rules WHERE org_id = $1 AND action_type = 'email' AND enabled = true LIMIT 1`,
      [orgId]
    );
    if (!rules.length) return;

    const rule = rules[0];
    const recipients = rule.config.emails?.length
      ? rule.config.emails
      : rule.config.to?.trim().split(/[\s,]+/).filter(Boolean);
    if (!recipients?.length) return;

    await sendEmail({
      to: recipients,
      subject: `[SPILL ⚡ SPIKE] ${org?.name} — ${count} new signals (${ratio}x above normal)`,
      text: [
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        'SPILL — VOLUME SPIKE DETECTED',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        `${count} new posts detected in this refresh cycle.`,
        `This is ${ratio}x above your 7-day average of ${avg.toFixed(0)} posts per cycle.`,
        '',
        'This may indicate a viral complaint, coordinated discussion,',
        'breaking news, or a product incident going public.',
        '',
        `Log in to Spill to review: ${process.env.NEXT_PUBLIC_BASE_URL || 'https://getspill.vercel.app'}`,
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        'Sent by Spill (automated)',
      ].join('\n'),
      labels: ['spike-alert'],
    });

    console.log(`[anomaly] spike notification sent for org ${orgId}`);
  } catch (err) {
    console.error('[anomaly] notify error:', err.message);
  }
}
