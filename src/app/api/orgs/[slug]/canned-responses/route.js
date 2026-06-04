import { NextResponse } from 'next/server';
import { query } from '../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../server/api-auth.js';
import { ensureMigrations } from '../../../../../server/migrate.js';

// GET /api/orgs/[slug]/canned-responses
export async function GET(request, { params }) {
  try {
    await ensureMigrations();
    const { slug } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { rows } = await query(
      `SELECT * FROM canned_responses WHERE org_id = $1 ORDER BY category, name`,
      [access.orgId]
    );
    return NextResponse.json({ cannedResponses: rows });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/orgs/[slug]/canned-responses
export async function POST(request, { params }) {
  try {
    await ensureMigrations();
    const { slug } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { name, body, category, brand_personality = 'professional' } = await request.json();
    if (!name?.trim() || !body?.trim()) {
      return NextResponse.json({ error: 'name and body required' }, { status: 400 });
    }

    const { rows: [cr] } = await query(
      `INSERT INTO canned_responses (org_id, name, body, category, brand_personality)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [access.orgId, name.trim(), body.trim(), category || null, brand_personality]
    );
    return NextResponse.json({ cannedResponse: cr }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
