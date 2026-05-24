import { NextResponse } from 'next/server';
import { query } from '../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../server/api-auth.js';

// GET /api/orgs/[slug]/status — last refresh log + counts + source breakdown
export async function GET(request, { params }) {
  try {
    const { slug } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    // Last refresh log
    const { rows: logs } = await query(
      `SELECT started_at, completed_at, status, posts_fetched, posts_escalated
       FROM refresh_logs
       WHERE org_id = $1
       ORDER BY started_at DESC
       LIMIT 1`,
      [access.orgId]
    );

    // Total counts
    const { rows: counts } = await query(
      `SELECT
         COUNT(*) as total_fetched,
         COUNT(*) FILTER (WHERE escalated = true) as total_escalated
       FROM posts
       WHERE org_id = $1`,
      [access.orgId]
    );

    // Source breakdown
    const { rows: breakdown } = await query(
      `SELECT source, COUNT(*) as count
       FROM posts
       WHERE org_id = $1
       GROUP BY source`,
      [access.orgId]
    );

    // Active sources count
    const { rows: activeSources } = await query(
      `SELECT COUNT(*) as count FROM source_configs
       WHERE org_id = $1 AND enabled = true`,
      [access.orgId]
    );

    const { rows: sourceHealth } = await query(
      `SELECT source, last_fetch_at, last_fetch_error
       FROM source_configs
       WHERE org_id = $1 AND enabled = true
       ORDER BY source`,
      [access.orgId]
    );

    const sourceBreakdown = {};
    for (const row of breakdown) {
      sourceBreakdown[row.source] = parseInt(row.count, 10);
    }

    const lastLog = logs[0];
    return NextResponse.json({
      lastRefresh: lastLog?.completed_at ?? lastLog?.started_at ?? null,
      totalFetched: parseInt(counts[0].total_fetched, 10),
      totalEscalated: parseInt(counts[0].total_escalated, 10),
      sourceBreakdown,
      activeSources: parseInt(activeSources[0].count, 10),
      sourceHealth: sourceHealth.map(s => ({
        source: s.source,
        lastFetchAt: s.last_fetch_at,
        error: s.last_fetch_error,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
