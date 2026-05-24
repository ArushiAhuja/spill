import { NextResponse } from 'next/server';
import { query } from '../../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../../server/api-auth.js';

// PATCH /api/orgs/[slug]/posts/[id] — mark reviewed
export async function PATCH(request, { params }) {
  try {
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
    const { reviewed, post_status, notes, manually_escalated, saved, dismiss_reason } = body;

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

    if (!fields.length) {
      return NextResponse.json({ error: 'no fields to update' }, { status: 400 });
    }

    values.push(id);
    const { rows } = await query(
      `UPDATE posts SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    return NextResponse.json(rows[0]);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
