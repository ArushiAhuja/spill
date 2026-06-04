import { NextResponse } from 'next/server';
import { query } from '../../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../../server/api-auth.js';
import { ensureMigrations } from '../../../../../../server/migrate.js';

// PATCH /api/orgs/[slug]/canned-responses/[id]
export async function PATCH(request, { params }) {
  try {
    await ensureMigrations();
    const { slug, id } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { name, body, category, brand_personality } = await request.json();

    const sets = ['updated_at = NOW()'];
    const values = [];
    let idx = 1;
    if (name !== undefined) { sets.push(`name = $${idx++}`); values.push(name.trim()); }
    if (body !== undefined) { sets.push(`body = $${idx++}`); values.push(body.trim()); }
    if (category !== undefined) { sets.push(`category = $${idx++}`); values.push(category); }
    if (brand_personality !== undefined) { sets.push(`brand_personality = $${idx++}`); values.push(brand_personality); }

    const { rows: [cr] } = await query(
      `UPDATE canned_responses SET ${sets.join(', ')} WHERE id = $${idx++} AND org_id = $${idx++} RETURNING *`,
      [...values, id, access.orgId]
    );
    if (!cr) return NextResponse.json({ error: 'not found' }, { status: 404 });

    return NextResponse.json({ cannedResponse: cr });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/orgs/[slug]/canned-responses/[id]
export async function DELETE(request, { params }) {
  try {
    await ensureMigrations();
    const { slug, id } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { rowCount } = await query(
      'DELETE FROM canned_responses WHERE id = $1 AND org_id = $2',
      [id, access.orgId]
    );
    if (!rowCount) return NextResponse.json({ error: 'not found' }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
