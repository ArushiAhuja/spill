import { query } from './db.js';

export async function logActivity({
  orgId, userId, userName,
  entityType, entityId, entityTitle,
  action, meta = null,
}) {
  try {
    await query(
      `INSERT INTO activity_log (org_id, user_id, user_name, entity_type, entity_id, entity_title, action, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        orgId,
        userId || null,
        userName || null,
        entityType,
        entityId || null,
        entityTitle || null,
        action,
        meta ? JSON.stringify(meta) : null,
      ]
    );
  } catch (err) {
    console.error('[activity-log] failed to write:', err.message);
  }
}

// Human-readable label for activity entries
export function activityLabel(entry) {
  const who = entry.user_name || 'someone'
  const title = entry.entity_title ? `"${entry.entity_title}"` : ''
  switch (entry.action) {
    case 'archived':        return `${who} archived ${title}`
    case 'dismissed':       return `${who} dismissed ${title}`
    case 'acknowledged':    return `${who} acknowledged ${title}`
    case 'resolved':        return `${who} resolved ${title}`
    case 'saved':           return `${who} saved ${title}`
    case 'escalated':       return `${who} escalated ${title}`
    case 'snoozed':         return `${who} snoozed ${title}`
    case 'feedback':        return `${who} gave feedback on ${title}`
    case 'incident_resolved':  return `${who} resolved incident ${title}`
    case 'incident_reopened':  return `${who} reopened incident ${title}`
    case 'rule_enabled':    return `${who} enabled rule ${title}`
    case 'rule_disabled':   return `${who} disabled rule ${title}`
    case 'rule_tested':     return `${who} tested rule ${title}`
    case 'rule_fired':      return `rule ${title} fired automatically`
    case 'invite_sent':     return `${who} invited ${title}`
    case 'member_joined':   return `${title} joined the workspace`
    default:                return `${who} ${entry.action} ${title}`
  }
}
