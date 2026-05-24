import { NextResponse } from 'next/server';
import { query } from '../../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../../server/api-auth.js';

export async function PATCH(request, { params }) {
  try {
    const { slug, id } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { status } = await request.json();
    if (!['open', 'resolved'].includes(status)) {
      return NextResponse.json({ error: 'invalid status' }, { status: 400 });
    }

    const { rows } = await query(`
      UPDATE incidents
      SET status = $1, resolved_at = ${status === 'resolved' ? 'NOW()' : 'NULL'}
      WHERE id = $2 AND org_id = $3
      RETURNING *
    `, [status, id, access.orgId]);

    if (!rows.length) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json(rows[0]);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
