import { NextResponse } from 'next/server';
import { query } from '../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../server/api-auth.js';
import { ensureMigrations } from '../../../../../server/migrate.js';

// Compact live operations view used by the analytics workspace. It reads the
// source-of-truth tickets/posts tables, so values update on each refresh.
export async function GET(request, { params }) {
  try {
    await ensureMigrations();
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const access = await getOrgAccess(user, params.slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    const { rows: [org] } = await query('SELECT alert_influencer_threshold FROM organizations WHERE id=$1', [access.orgId]);
    const threshold = org?.alert_influencer_threshold || 10000;
    const [volume, lobBreakdown, influencers, traction, trendIssues] = await Promise.all([
      query(`SELECT COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS tickets_24h,
                    COUNT(*) FILTER (WHERE status <> 'closed') AS open_tickets,
                    COUNT(*) FILTER (WHERE status <> 'closed' AND (sla_breached=true OR sla_first_response_at < NOW() + INTERVAL '30 minutes')) AS sla_risk,
                    COUNT(*) FILTER (WHERE status <> 'closed' AND priority IN ('urgent','high')) AS expedited
             FROM tickets WHERE org_id=$1`, [access.orgId]),
      query(`SELECT COALESCE(NULLIF(lob,''),'Unclassified') AS lob, COUNT(*)::int AS count
             FROM tickets WHERE org_id=$1 AND created_at > NOW() - INTERVAL '30 days'
             GROUP BY 1 ORDER BY count DESC LIMIT 8`, [access.orgId]),
      query(`SELECT id,title,channel,author,author_handle,follower_count,priority,url,created_at
             FROM tickets WHERE org_id=$1 AND status <> 'closed' AND (follower_count >= $2 OR customer_labels @> ARRAY['High Influencer'])
             ORDER BY follower_count DESC, created_at DESC LIMIT 6`, [access.orgId, threshold]),
      query(`SELECT id,title,source,url,author,follower_count,raw_engagement,escalation_score,created_at
             FROM posts WHERE org_id=$1 ORDER BY COALESCE(raw_engagement,0) DESC, follower_count DESC, created_at DESC LIMIT 6`, [access.orgId]),
      query(`SELECT COALESCE(c.name,'Unclassified') AS category, COUNT(*)::int AS count, MAX(p.escalation_score)::int AS max_escalation
             FROM posts p LEFT JOIN categories c ON c.id=p.category_id
             WHERE p.org_id=$1 AND p.created_at > NOW() - INTERVAL '7 days'
             GROUP BY 1 ORDER BY count DESC, max_escalation DESC LIMIT 6`, [access.orgId]),
    ]);
    return NextResponse.json({
      generated_at: new Date().toISOString(),
      volume: Object.fromEntries(Object.entries(volume.rows[0] || {}).map(([key, value]) => [key, parseInt(value || '0')])),
      lob_breakdown: lobBreakdown.rows,
      influencer_alerts: influencers.rows,
      top_traction: traction.rows,
      trending_issues: trendIssues.rows,
    });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
