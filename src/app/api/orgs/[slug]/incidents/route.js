import { NextResponse } from 'next/server';
import { query } from '../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../server/api-auth.js';
import { ensureMigrations } from '../../../../../server/migrate.js';

export async function GET(request, { params }) {
  try {
    const { slug } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    await ensureMigrations();

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'open';

    const { rows } = await query(`
      SELECT i.*, c.name as category_name, c.color as category_color,
        (SELECT json_agg(json_build_object('id', p.id, 'title', p.title, 'source', p.source, 'url', p.url, 'escalation_score', p.escalation_score))
         FROM incident_posts ip2
         JOIN posts p ON p.id = ip2.post_id
         WHERE ip2.incident_id = i.id
         LIMIT 5) as posts
      FROM incidents i
      LEFT JOIN categories c ON c.id = i.category_id
      WHERE i.org_id = $1 ${status !== 'all' ? 'AND i.status = $2' : ''}
      ORDER BY i.created_at DESC
      LIMIT 50
    `, status !== 'all' ? [access.orgId, status] : [access.orgId]);

    return NextResponse.json(rows);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
