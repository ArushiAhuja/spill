import { NextResponse } from 'next/server';
import { query } from '../../../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../../../server/api-auth.js';
import { ensureMigrations } from '../../../../../../../server/migrate.js';
import { computeCustomerLabels } from '../../../../../../../server/mmt-features.js';

// POST /api/orgs/[slug]/tickets/[id]/notes
export async function POST(request, { params }) {
  try {
    await ensureMigrations();
    const { slug, id } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { body, is_internal = true } = await request.json();
    if (!body?.trim()) return NextResponse.json({ error: 'note body required' }, { status: 400 });

    // Confirm ticket belongs to this org
    const { rows: [ticket] } = await query(
      'SELECT t.id FROM tickets t WHERE t.id = $1 AND t.org_id = $2',
      [id, access.orgId]
    );
    if (!ticket) return NextResponse.json({ error: 'ticket not found' }, { status: 404 });

    const { rows: [note] } = await query(
      `INSERT INTO ticket_notes (ticket_id, author_id, author_name, body, is_internal)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, user.id, user.name || user.email, body.trim(), is_internal]
    );

    // Update ticket — set first_responded_at if not set, refresh subsequent SLA
    const { rows: [org] } = await query(
      'SELECT sla_subsequent_minutes FROM organizations WHERE id = $1',
      [access.orgId]
    );
    const subsequentMinutes = org?.sla_subsequent_minutes || 240;
    const nextSlaAt = new Date(Date.now() + subsequentMinutes * 60 * 1000);

    const { rows: [updatedTicket] } = await query(
      `UPDATE tickets SET
        first_responded_at = COALESCE(first_responded_at, NOW()),
        sla_subsequent_at = $1,
        mention_count = mention_count + $3,
        updated_at = NOW()
       WHERE id = $2
       RETURNING follower_count, verified_handle, mention_count`,
      [nextSlaAt, id, is_internal ? 0 : 1]
    );

    if (!is_internal && updatedTicket) {
      const newLabels = computeCustomerLabels({
        follower_count: updatedTicket.follower_count || 0,
        verified_handle: updatedTicket.verified_handle || false,
        mention_count: updatedTicket.mention_count || 1,
      });
      await query(
        `UPDATE tickets SET awaiting_customer = false, customer_labels = $1 WHERE id = $2`,
        [newLabels, id]
      );
    }

    return NextResponse.json({ note }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
