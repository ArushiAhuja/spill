import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { query } from '../../../../../../server/db.js';

export const maxDuration = 60;
import { getUser, getOrgAccess } from '../../../../../../server/api-auth.js';
import { logActivity } from '../../../../../../server/activity.js';
import { ensureMigrations } from '../../../../../../server/migrate.js';
import { sendEmail } from '../../../../../../server/actions/emailer.js';
import { sendSlack } from '../../../../../../server/actions/slack.js';
import { applyFeedbackLearning } from '../../../../../../server/feedback.js';

function isInMuteWindow(muteWindows) {
  if (!muteWindows?.length) return false;
  const now = new Date();
  const hhmm = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
  return muteWindows.some(w => {
    if (!w.start || !w.end) return false;
    if (w.start <= w.end) return hhmm >= w.start && hhmm < w.end;
    return hhmm >= w.start || hhmm < w.end;
  });
}

async function fireRulesForPost(post, orgId) {
  const { rows: rules } = await query(
    'SELECT * FROM escalation_rules WHERE org_id = $1 AND enabled = true',
    [orgId]
  );
  if (!rules.length) return;

  const { rows: categories } = await query(
    'SELECT id, name FROM categories WHERE org_id = $1',
    [orgId]
  );

  for (const rule of rules) {
    const categoryMatch = rule.category_ids.length === 0 || rule.category_ids.includes(post.category_id);
    if (!categoryMatch) continue;
    if (isInMuteWindow(rule.mute_windows)) continue;

    const category = categories.find(c => c.id === post.category_id);
    try {
      if (rule.action_type === 'email') {
        const emailRecipients = rule.config.emails?.length
          ? rule.config.emails
          : rule.config.to?.trim().split(/[\s,]+/).filter(Boolean);
        if (emailRecipients?.length) {
          await sendEmail(post, category, { ...rule.config, emails: emailRecipients });
        }
      } else if (rule.action_type === 'slack') {
        const webhookUrl = rule.config.webhook_url || rule.config.slack_webhook_url;
        if (webhookUrl) await sendSlack(post, category, rule.config);
      }
    } catch (err) {
      console.error(`[manual escalate] rule ${rule.id} failed:`, err.message);
    }
  }
}

// PATCH /api/orgs/[slug]/posts/[id] — mark reviewed
export async function PATCH(request, { params }) {
  try {
    await ensureMigrations();
    const { slug, id } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { rows: existing } = await query(
      'SELECT id FROM posts WHERE id = $1 AND org_id = $2',
      [id, access.orgId]
    );
    if (!existing.length) return NextResponse.json({ error: 'post not found' }, { status: 404 });

    const body = await request.json();
    const { reviewed, post_status, notes, manually_escalated, saved, dismiss_reason, snoozed_until } = body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (reviewed !== undefined) {
      fields.push(`reviewed = $${idx++}`);
      values.push(reviewed);
    }
    if (post_status !== undefined) {
      fields.push(`post_status = $${idx++}`);
      values.push(post_status);
      if (post_status === 'acknowledged') {
        fields.push(`acknowledged_at = COALESCE(acknowledged_at, NOW())`);
      } else if (post_status === 'resolved') {
        fields.push(`resolved_at = COALESCE(resolved_at, NOW())`);
        fields.push(`acknowledged_at = COALESCE(acknowledged_at, NOW())`);
      }
    }
    if (notes !== undefined) {
      fields.push(`notes = $${idx++}`);
      values.push(notes);
    }
    if (manually_escalated !== undefined) {
      fields.push(`manually_escalated = $${idx++}`);
      values.push(manually_escalated);
    }
    if (saved === true) {
      fields.push(`saved_at = COALESCE(saved_at, NOW())`);
    } else if (saved === false) {
      fields.push(`saved_at = NULL`);
    }
    if (dismiss_reason !== undefined) {
      fields.push(`dismiss_reason = $${idx++}`);
      values.push(dismiss_reason);
    }
    if (snoozed_until !== undefined) {
      fields.push(`snoozed_until = $${idx++}`);
      values.push(snoozed_until || null);
    }

    if (!fields.length) {
      return NextResponse.json({ error: 'no fields to update' }, { status: 400 });
    }

    values.push(id);
    const { rows } = await query(
      `UPDATE posts SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    const updated = rows[0];
    const actorName = user.name || user.email;

    // Fire-and-forget activity logging for meaningful state changes
    const logBase = { orgId: access.orgId, userId: user.id, userName: actorName, entityType: 'post', entityId: id, entityTitle: updated.title?.slice(0, 80) };
    if (post_status === 'archived')     logActivity({ ...logBase, action: 'archived' }).catch(() => {});
    if (post_status === 'dismissed')    logActivity({ ...logBase, action: 'dismissed', meta: dismiss_reason ? { reason: dismiss_reason } : null }).catch(() => {});
    if (post_status === 'acknowledged') logActivity({ ...logBase, action: 'acknowledged' }).catch(() => {});
    if (post_status === 'resolved')     logActivity({ ...logBase, action: 'resolved' }).catch(() => {});
    if (manually_escalated === true)    logActivity({ ...logBase, action: 'escalated' }).catch(() => {});
    if (saved === true)                 logActivity({ ...logBase, action: 'saved' }).catch(() => {});
    if (snoozed_until)                  logActivity({ ...logBase, action: 'snoozed', meta: { until: snoozed_until } }).catch(() => {});

    // Fire escalation rules immediately when user manually escalates a post.
    // waitUntil keeps the function alive after response is sent — without it
    // Vercel kills the invocation before the async email/slack work completes.
    if (manually_escalated === true) {
      waitUntil(
        fireRulesForPost(updated, access.orgId).catch(err =>
          console.error('[manual escalate] rules failed:', err.message)
        )
      );
    }

    // Implicit training signals: save/dismiss actions are as informative as explicit labels.
    // signal_type='implicit' distinguishes these from explicit feedback panel submissions.
    if (saved === true || post_status === 'dismissed') {
      const implicitLabel = saved === true ? 'saved' : 'not_relevant';
      const implicitReason = saved === true ? 'user bookmarked this post' : 'user dismissed without feedback';
      const { rows: [trace] } = updated.ai_trace_id
        ? await query('SELECT event_id FROM ai_traces WHERE id=$1 AND org_id=$2', [updated.ai_trace_id, access.orgId])
        : { rows: [] };
      const eventId = trace?.event_id || updated.id;
      const { rows: [implicitFeedback] } = await query(
        `INSERT INTO post_feedback (org_id, post_id, event_id, label, explanation, signal_type)
         VALUES ($1, $2, $3, $4, $5, 'implicit') RETURNING *`,
        [access.orgId, id, eventId, implicitLabel, implicitReason]
      );
      // Keep implicit signals in the same learning contract as explicit
      // feedback. The DB default retains an event ID for historic/manual posts.
      waitUntil(applyFeedbackLearning({
        orgId: access.orgId,
        feedbackId: implicitFeedback.id,
        eventId: implicitFeedback.event_id || eventId,
        agentName: 'relevance',
        post: updated,
        label: implicitLabel,
        explanation: implicitReason,
        authorEmail: user.email || null,
      }).catch(err => console.warn('[feedback] implicit learning failed:', err.message)));
    }

    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
