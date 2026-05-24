import { NextResponse } from 'next/server';
import { query } from '../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../server/api-auth.js';

// GET /api/orgs/[slug]/stats?days=14 — sentiment trend per category
export async function GET(request, { params }) {
  try {
    const { slug } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const days = Math.min(90, parseInt(new URL(request.url).searchParams.get('days') || '14'));

    // Daily sentiment per category for last N days
    const { rows: trend } = await query(`
      SELECT
        c.id as category_id,
        c.name as category_name,
        c.color as category_color,
        DATE_TRUNC('day', p.created_at)::date as day,
        ROUND(AVG(p.sentiment_intensity)::numeric, 1) as avg_sentiment,
        COUNT(*) as post_count
      FROM posts p
      JOIN categories c ON c.id = p.category_id
      WHERE p.org_id = $1 AND p.created_at > NOW() - ($2 || ' days')::interval
      GROUP BY c.id, c.name, c.color, DATE_TRUNC('day', p.created_at)::date
      ORDER BY c.id, day
    `, [access.orgId, days]);

    // Group by category
    const byCategory = {};
    for (const row of trend) {
      if (!byCategory[row.category_id]) {
        byCategory[row.category_id] = {
          id: row.category_id,
          name: row.category_name,
          color: row.category_color,
          trend: [],
        };
      }
      byCategory[row.category_id].trend.push({
        date: row.day,
        avg_sentiment: parseFloat(row.avg_sentiment),
        count: parseInt(row.post_count),
      });
    }

    return NextResponse.json(Object.values(byCategory));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
