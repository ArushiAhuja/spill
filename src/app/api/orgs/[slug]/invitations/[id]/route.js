import { NextResponse } from 'next/server';
import { query } from '../../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../../server/api-auth.js';

// DELETE /api/orgs/[slug]/invitations/[id] — revoke
export async function DELETE(request, { params }) {
  try {
    const { slug, id } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { rows } = await query(
      `UPDATE invitations SET status = 'revoked'
       WHERE id = $1 AND org_id = $2 AND status = 'pending'
       RETURNING id`,
      [id, access.orgId]
    );

    if (!rows.length) return NextResponse.json({ error: 'invitation not found or already used' }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
