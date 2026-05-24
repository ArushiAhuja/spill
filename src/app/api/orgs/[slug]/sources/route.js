import { NextResponse } from 'next/server';
import { query } from '../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../server/api-auth.js';

const ALL_SOURCES = ['reddit', 'hackernews', 'google_news', 'twitter', 'playstore', 'youtube'];

// GET /api/orgs/[slug]/sources
export async function GET(request, { params }) {
  try {
    const { slug } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { rows } = await query(
      'SELECT source, enabled, credentials, config, updated_at FROM source_configs WHERE org_id = $1',
      [access.orgId]
    );

    const configMap = {};
    for (const row of rows) {
      configMap[row.source] = row;
    }

    const sources = ALL_SOURCES.map((source) => ({
      source,
      enabled: configMap[source]?.enabled ?? false,
      credentials: configMap[source]?.credentials ?? {},
      config: configMap[source]?.config ?? {},
      updated_at: configMap[source]?.updated_at ?? null,
    }));

    return NextResponse.json(sources);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
