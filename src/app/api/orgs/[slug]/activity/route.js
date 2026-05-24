import { NextResponse } from 'next/server';
import { query } from '../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../server/api-auth.js';
import { ensureMigrations } from '../../../../../server/migrate.js';

// GET /api/orgs/[slug]/activity
export async function GET(request, { params }) {
  try {
    await ensureMigrations();
    const { slug } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '60'), 200);
    const offset = parseInt(url.searchParams.get('offset') || '0');

    const { rows } = await query(
      `SELECT id, user_name, entity_type, entity_id, entity_title, action, meta, created_at
       FROM activity_log
       WHERE org_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [access.orgId, limit, offset]
    );

    return NextResponse.json({ activity: rows });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
