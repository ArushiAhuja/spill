import { NextResponse } from 'next/server';
import { query } from '../../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../../server/api-auth.js';
import { logActivity } from '../../../../../../server/activity.js';
import { ensureMigrations } from '../../../../../../server/migrate.js';

const VALID_ACTION_TYPES = ['email', 'webhook', 'sheets', 'slack'];

// PATCH /api/orgs/[slug]/escalations/[id]
export async function PATCH(request, { params }) {
  try {
    await ensureMigrations();
    const { slug, id } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { rows: existing } = await query(
      'SELECT id, name, enabled FROM escalation_rules WHERE id = $1 AND org_id = $2',
      [id, access.orgId]
    );
    if (!existing.length) return NextResponse.json({ error: 'escalation rule not found' }, { status: 404 });

    const body = await request.json();
    const { name, category_ids, score_threshold, action_type, config, enabled, mute_windows } = body;
    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
    if (category_ids !== undefined) { fields.push(`category_ids = $${idx++}`); values.push(Array.isArray(category_ids) ? category_ids : []); }
    if (score_threshold !== undefined) { fields.push(`score_threshold = $${idx++}`); values.push(score_threshold); }
    if (action_type !== undefined) {
      if (!VALID_ACTION_TYPES.includes(action_type)) {
        return NextResponse.json({ error: `action_type must be one of: ${VALID_ACTION_TYPES.join(', ')}` }, { status: 400 });
      }
      fields.push(`action_type = $${idx++}`); values.push(action_type);
    }
    if (config !== undefined) { fields.push(`config = $${idx++}`); values.push(config); }
    if (enabled !== undefined) { fields.push(`enabled = $${idx++}`); values.push(enabled); }
    if (mute_windows !== undefined) { fields.push(`mute_windows = $${idx++}`); values.push(JSON.stringify(Array.isArray(mute_windows) ? mute_windows : [])); }

    if (!fields.length) {
      return NextResponse.json({ error: 'no fields to update' }, { status: 400 });
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const { rows } = await query(
      `UPDATE escalation_rules SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    const rule = rows[0];
    const logBase = { orgId: access.orgId, userId: user.id, userName: user.name || user.email, entityType: 'escalation_rule', entityId: id, entityTitle: rule.name };
    if (enabled === true && !existing[0].enabled)  logActivity({ ...logBase, action: 'rule_enabled' }).catch(() => {});
    if (enabled === false && existing[0].enabled)  logActivity({ ...logBase, action: 'rule_disabled' }).catch(() => {});

    return NextResponse.json(rule);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/orgs/[slug]/escalations/[id]
export async function DELETE(request, { params }) {
  try {
    await ensureMigrations();
    const { slug, id } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { rows: existing } = await query(
      'SELECT id FROM escalation_rules WHERE id = $1 AND org_id = $2',
      [id, access.orgId]
    );
    if (!existing.length) return NextResponse.json({ error: 'escalation rule not found' }, { status: 404 });

    await query('DELETE FROM escalation_rules WHERE id = $1', [id]);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
