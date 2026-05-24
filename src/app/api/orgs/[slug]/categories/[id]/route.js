import { NextResponse } from 'next/server';
import { query } from '../../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../../server/api-auth.js';

// PATCH /api/orgs/[slug]/categories/[id]
export async function PATCH(request, { params }) {
  try {
    const { slug, id } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    // Verify belongs to org
    const { rows: existing } = await query(
      'SELECT id FROM categories WHERE id = $1 AND org_id = $2',
      [id, access.orgId]
    );
    if (!existing.length) return NextResponse.json({ error: 'category not found' }, { status: 404 });

    const { name, description, severity, color } = await request.json();
    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
    if (description !== undefined) { fields.push(`description = $${idx++}`); values.push(description); }
    if (severity !== undefined) { fields.push(`severity = $${idx++}`); values.push(severity); }
    if (color !== undefined) { fields.push(`color = $${idx++}`); values.push(color); }

    if (!fields.length) {
      return NextResponse.json({ error: 'no fields to update' }, { status: 400 });
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const { rows } = await query(
      `UPDATE categories SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    return NextResponse.json(rows[0]);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/orgs/[slug]/categories/[id]
export async function DELETE(request, { params }) {
  try {
    const { slug, id } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    // Verify belongs to org
    const { rows: existing } = await query(
      'SELECT id FROM categories WHERE id = $1 AND org_id = $2',
      [id, access.orgId]
    );
    if (!existing.length) return NextResponse.json({ error: 'category not found' }, { status: 404 });

    // Prevent deleting last category
    const { rows: countResult } = await query(
      'SELECT COUNT(*) as cnt FROM categories WHERE org_id = $1',
      [access.orgId]
    );
    if (parseInt(countResult[0].cnt, 10) <= 1) {
      return NextResponse.json({ error: 'cannot delete the last category' }, { status: 400 });
    }

    await query('DELETE FROM categories WHERE id = $1', [id]);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
