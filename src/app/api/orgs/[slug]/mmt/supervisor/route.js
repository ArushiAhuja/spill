import { NextResponse } from 'next/server';
import { query } from '../../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../../server/api-auth.js';
import { ensureMigrations } from '../../../../../../server/migrate.js';
import { getOrgFeatures, isMmtOrg } from '../../../../../../server/mmt-features.js';

// GET /api/orgs/[slug]/mmt/supervisor
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

    const url = new URL(request.url);
    const days = parseInt(url.searchParams.get('days') || '7');

    const [agentStatsResult, channelResult, statusResult, aggregateResult] = await Promise.all([
      query(
        `SELECT u.id as user_id, u.name as user_name,
           COUNT(t.id) as tickets_assigned,
           COUNT(CASE WHEN t.status = 'closed' THEN 1 END) as tickets_closed,
           AVG(EXTRACT(EPOCH FROM (t.first_responded_at - t.created_at))/60) as avg_first_response_minutes,
           COUNT(CASE WHEN t.sla_breached = true THEN 1 END) as sla_breached_count
         FROM tickets t
         JOIN users u ON u.id = t.assigned_to
         WHERE t.org_id = $1 AND t.created_at > NOW() - ($2 || ' days')::INTERVAL
         GROUP BY u.id, u.name
         ORDER BY tickets_assigned DESC`,
        [access.orgId, String(days)]
      ),
      query(
        `SELECT channel, COUNT(*) as count
         FROM tickets
         WHERE org_id = $1 AND created_at > NOW() - ($2 || ' days')::INTERVAL
         GROUP BY channel`,
        [access.orgId, String(days)]
      ),
      query(
        `SELECT status, COUNT(*) as count FROM tickets WHERE org_id = $1 GROUP BY status`,
        [access.orgId]
      ),
      query(
        `SELECT
           COUNT(*) as total_tickets,
           COUNT(CASE WHEN status != 'closed' THEN 1 END) as open_tickets,
           AVG(EXTRACT(EPOCH FROM (first_responded_at - created_at))/60) as avg_first_response_minutes,
           COUNT(CASE WHEN sla_breached = true THEN 1 END) as sla_breached_count,
           COUNT(CASE WHEN 'High Influencer' = ANY(customer_labels) THEN 1 END) as high_influencer_tickets,
           COUNT(CASE WHEN 'Detractor' = ANY(customer_labels) THEN 1 END) as detractor_tickets
         FROM tickets
         WHERE org_id = $1 AND created_at > NOW() - ($2 || ' days')::INTERVAL`,
        [access.orgId, String(days)]
      ),
    ]);

    const agg = aggregateResult.rows[0];
    const totalTickets = parseInt(agg.total_tickets) || 0;
    const slaBreachedCount = parseInt(agg.sla_breached_count) || 0;

    const volumeByChannel = channelResult.rows.reduce((acc, r) => {
      acc[r.channel || 'unknown'] = parseInt(r.count);
      return acc;
    }, {});

    const statusDistribution = statusResult.rows.reduce((acc, r) => {
      acc[r.status] = parseInt(r.count);
      return acc;
    }, {});

    const agentStats = agentStatsResult.rows.map(r => ({
      user_id: r.user_id,
      user_name: r.user_name,
      tickets_assigned: parseInt(r.tickets_assigned),
      tickets_closed: parseInt(r.tickets_closed),
      avg_first_response_minutes: r.avg_first_response_minutes !== null ? parseFloat(parseFloat(r.avg_first_response_minutes).toFixed(1)) : null,
      sla_breached_count: parseInt(r.sla_breached_count),
    }));

    return NextResponse.json({
      agentStats,
      volumeByChannel,
      statusDistribution,
      avgFirstResponseMinutes: agg.avg_first_response_minutes !== null ? parseFloat(parseFloat(agg.avg_first_response_minutes).toFixed(1)) : null,
      slaBreachRate: totalTickets > 0 ? parseFloat((slaBreachedCount / totalTickets).toFixed(4)) : 0,
      totalTickets,
      openTickets: parseInt(agg.open_tickets) || 0,
      highInfluencerTickets: parseInt(agg.high_influencer_tickets) || 0,
      detractorTickets: parseInt(agg.detractor_tickets) || 0,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
