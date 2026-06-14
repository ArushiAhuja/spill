import { NextResponse } from 'next/server';
import { query } from '../../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../../server/api-auth.js';
import { updateOrgIntelligence } from '../../../../../../server/feedback.js';
import { ensureMigrations } from '../../../../../../server/migrate.js';

// PATCH /api/orgs/[slug]/feedback/[id] — edit label and/or explanation
export async function PATCH(request, { params }) {
  try {
    await ensureMigrations();
    const { slug, id } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { rows: existing } = await query(
      'SELECT id FROM post_feedback WHERE id = $1 AND org_id = $2',
      [id, access.orgId]
    );
    if (!existing.length) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const { label, explanation } = await request.json();

    const VALID_LABELS = ['not_relevant', 'wrong_geography', 'unrelated_complaint', 'too_generic', 'duplicate', 'useful', 'high_signal', 'missed_category'];
    if (label !== undefined && !VALID_LABELS.includes(label)) {
      return NextResponse.json({ error: 'invalid label' }, { status: 400 });
    }

    const fields = [];
    const values = [];
    let idx = 1;

    if (label !== undefined) { fields.push(`label = $${idx++}`); values.push(label); }
    if (explanation !== undefined) { fields.push(`explanation = $${idx++}`); values.push(explanation || null); }

    if (!fields.length) return NextResponse.json({ error: 'nothing to update' }, { status: 400 });

    values.push(id, access.orgId);
    const { rows: [updated] } = await query(
      `UPDATE post_feedback SET ${fields.join(', ')} WHERE id = $${idx} AND org_id = $${idx + 1} RETURNING *`,
      values
    );

    // Force intelligence refresh — user explicitly changed a signal, don't wait for debounce
    updateOrgIntelligence(access.orgId, { force: true }).catch(() => {});

    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/orgs/[slug]/feedback/[id] — remove a feedback signal
export async function DELETE(request, { params }) {
  try {
    await ensureMigrations();
    const { slug, id } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { rows } = await query(
      'DELETE FROM post_feedback WHERE id = $1 AND org_id = $2 RETURNING id',
      [id, access.orgId]
    );
    if (!rows.length) return NextResponse.json({ error: 'not found' }, { status: 404 });

    // Force rebuild — signal was removed, re-derive terms immediately
    updateOrgIntelligence(access.orgId, { force: true }).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
