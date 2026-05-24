import { NextResponse } from 'next/server';
import { query } from '../../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../../server/api-auth.js';

const ALL_SOURCES = ['reddit', 'hackernews', 'google_news', 'twitter', 'playstore', 'youtube'];

// PATCH /api/orgs/[slug]/sources/[source]
export async function PATCH(request, { params }) {
  try {
    const { slug, source } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    if (!ALL_SOURCES.includes(source)) {
      return NextResponse.json(
        { error: `invalid source; must be one of: ${ALL_SOURCES.join(', ')}` },
        { status: 400 }
      );
    }

    const { enabled = false, credentials = {}, config = {} } = await request.json();

    const { rows } = await query(
      `INSERT INTO source_configs (org_id, source, enabled, credentials, config)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (org_id, source) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         credentials = EXCLUDED.credentials,
         config = EXCLUDED.config,
         updated_at = NOW()
       RETURNING *`,
      [access.orgId, source, enabled, credentials, config]
    );

    return NextResponse.json(rows[0]);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
