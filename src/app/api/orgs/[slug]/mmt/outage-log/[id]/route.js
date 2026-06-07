import { NextResponse } from 'next/server';
import { query } from '../../../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../../../server/api-auth.js';
import { ensureMigrations } from '../../../../../../../server/migrate.js';
import { getOrgFeatures, isMmtOrg } from '../../../../../../../server/mmt-features.js';

// PATCH /api/orgs/[slug]/mmt/outage-log/[id]
export async function PATCH(request, { params }) {
  try {
    await ensureMigrations();
    const { slug, id } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const features = await getOrgFeatures(access.orgId);
    if (!isMmtOrg(features)) return NextResponse.json({ error: 'mmt feature not enabled' }, { status: 403 });

    const { status, root_cause, resolution, impact, resolved_at } = await request.json();

    const sets = [];
    const values = [];
    let idx = 1;

    if (status !== undefined) { sets.push(`status = $${idx++}`); values.push(status); }
    if (root_cause !== undefined) { sets.push(`root_cause = $${idx++}`); values.push(root_cause); }
    if (resolution !== undefined) { sets.push(`resolution = $${idx++}`); values.push(resolution); }
    if (impact !== undefined) { sets.push(`impact = $${idx++}`); values.push(impact); }

    if (status === 'resolved') {
      sets.push(`resolved_at = $${idx++}`);
      values.push(resolved_at ? new Date(resolved_at) : new Date());
    } else if (resolved_at !== undefined) {
      sets.push(`resolved_at = $${idx++}`);
      values.push(new Date(resolved_at));
    }

    sets.push(`updated_at = NOW()`);

    if (sets.length === 1) {
      return NextResponse.json({ error: 'no fields to update' }, { status: 400 });
    }

    const { rows: [entry] } = await query(
      `UPDATE mmt_outage_log SET ${sets.join(', ')}
       WHERE id = $${idx++} AND org_id = $${idx++}
       RETURNING *`,
      [...values, id, access.orgId]
    );

    if (!entry) return NextResponse.json({ error: 'outage entry not found' }, { status: 404 });

    return NextResponse.json({ outage: entry });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
