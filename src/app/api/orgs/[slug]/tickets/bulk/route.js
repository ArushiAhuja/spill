import { NextResponse } from 'next/server';
import { query } from '../../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../../server/api-auth.js';
import { ensureMigrations } from '../../../../../../server/migrate.js';

const VALID_STATUSES = new Set(['new', 'open', 'pending', 'woc', 'closed']);

// POST /api/orgs/[slug]/tickets/bulk
// body: { ids: string[], action: 'status'|'assign'|'tag'|'note', value: string, note_body: string }
export async function POST(request, { params }) {
  try {
    await ensureMigrations();
    const { slug } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { ids, action, value, note_body, assigned_name } = await request.json();
    if (!ids?.length) return NextResponse.json({ error: 'ids required' }, { status: 400 });
    if (!action) return NextResponse.json({ error: 'action required' }, { status: 400 });

    // Confirm all tickets belong to this org
    const { rows: owned } = await query(
      `SELECT id FROM tickets WHERE id = ANY($1::uuid[]) AND org_id = $2`,
      [ids, access.orgId]
    );
    const ownedIds = owned.map(r => r.id);
    if (!ownedIds.length) return NextResponse.json({ error: 'no matching tickets' }, { status: 404 });

    let updated = 0;

    if (action === 'status') {
      if (!VALID_STATUSES.has(value)) return NextResponse.json({ error: 'invalid status' }, { status: 400 });
      const closedAt = value === 'closed' ? ', closed_at = NOW()' : '';
      const { rowCount } = await query(
        `UPDATE tickets SET status = $1, updated_at = NOW()${closedAt} WHERE id = ANY($2::uuid[]) AND org_id = $3`,
        [value, ownedIds, access.orgId]
      );
      updated = rowCount;
    } else if (action === 'assign') {
      const { rowCount } = await query(
        `UPDATE tickets SET assigned_to = $1, assigned_name = $2, updated_at = NOW() WHERE id = ANY($3::uuid[]) AND org_id = $4`,
        [value || null, assigned_name || null, ownedIds, access.orgId]
      );
      updated = rowCount;
    } else if (action === 'tag') {
      const tag = value?.trim();
      if (!tag) return NextResponse.json({ error: 'tag value required' }, { status: 400 });
      const { rowCount } = await query(
        `UPDATE tickets SET tags = array_append(tags, $1), updated_at = NOW() WHERE id = ANY($2::uuid[]) AND org_id = $3 AND NOT ($1 = ANY(tags))`,
        [tag, ownedIds, access.orgId]
      );
      updated = rowCount;
    } else if (action === 'note') {
      if (!note_body?.trim()) return NextResponse.json({ error: 'note_body required' }, { status: 400 });
      for (const ticketId of ownedIds) {
        await query(
          `INSERT INTO ticket_notes (ticket_id, author_id, author_name, body, is_internal) VALUES ($1,$2,$3,$4,true)`,
          [ticketId, user.id, user.name || user.email, note_body.trim()]
        );
      }
      updated = ownedIds.length;
    } else {
      return NextResponse.json({ error: 'unknown action' }, { status: 400 });
    }

    return NextResponse.json({ updated, ids: ownedIds });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
