import { NextResponse } from 'next/server';
import { query } from '../../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../../server/api-auth.js';
import { ensureMigrations } from '../../../../../../server/migrate.js';
import { getOrgFeatures, isMmtOrg } from '../../../../../../server/mmt-features.js';

// GET /api/orgs/[slug]/mmt/outage-log
export async function GET(request, { params }) {
  try {
    await ensureMigrations();
    const { slug } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const features = await getOrgFeatures(access.orgId);
    if (!isMmtOrg(features)) return NextResponse.json({ error: 'mmt feature not enabled' }, { status: 403 });

    const { rows: entries } = await query(
      `SELECT * FROM mmt_outage_log WHERE org_id = $1 ORDER BY started_at DESC`,
      [access.orgId]
    );

    return NextResponse.json({ outages: entries });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/orgs/[slug]/mmt/outage-log
export async function POST(request, { params }) {
  try {
    await ensureMigrations();
    const { slug } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const features = await getOrgFeatures(access.orgId);
    if (!isMmtOrg(features)) return NextResponse.json({ error: 'mmt feature not enabled' }, { status: 403 });

    const { title, description, impact, started_at, status = 'ongoing' } = await request.json();
    if (!title?.trim()) return NextResponse.json({ error: 'title required' }, { status: 400 });

    const { rows: [entry] } = await query(
      `INSERT INTO mmt_outage_log (org_id, title, description, impact, started_at, status, created_by, created_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        access.orgId,
        title.trim(),
        description || null,
        impact || null,
        started_at ? new Date(started_at) : new Date(),
        status,
        user.id,
        user.name || user.email,
      ]
    );

    return NextResponse.json({ outage: entry }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
