import { NextResponse } from 'next/server';
import { query } from '../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../server/api-auth.js';
import { ensureMigrations } from '../../../../../server/migrate.js';

// GET /api/orgs/[slug]/posts — list posts with filters
export async function GET(request, { params }) {
  try {
    await ensureMigrations();
    const { slug } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source');
    const category_id = searchParams.get('category_id');
    const escalated = searchParams.get('escalated');
    const reviewed = searchParams.get('reviewed');
    const search = searchParams.get('search');
    const from_date = searchParams.get('from_date')
    const to_date = searchParams.get('to_date')
    const status_filter = searchParams.get('status_filter')
    const page = searchParams.get('page') || '1';
    const limit = searchParams.get('limit') || '50';

    const conditions = ['p.org_id = $1'];
    const values = [access.orgId];
    let idx = 2;

    // status_filter controls which posts are shown
    if (status_filter === 'saved') {
      conditions.push('p.saved_at IS NOT NULL');
    } else if (status_filter === 'archived') {
      conditions.push(`p.post_status = 'archived'`);
    } else if (status_filter === 'dismissed') {
      conditions.push(`p.post_status = 'dismissed'`);
    } else if (status_filter === 'snoozed') {
      conditions.push(`p.snoozed_until IS NOT NULL AND p.snoozed_until > NOW()`);
    } else {
      // default feed: hide archived, dismissed, and currently snoozed
      conditions.push(`(p.post_status IS NULL OR p.post_status NOT IN ('archived', 'dismissed'))`);
      conditions.push(`(p.snoozed_until IS NULL OR p.snoozed_until <= NOW())`);
    }

    if (source) {
      conditions.push(`p.source = $${idx++}`);
      values.push(source);
    }
    if (category_id) {
      conditions.push(`p.category_id = $${idx++}`);
      values.push(category_id);
    }
    if (escalated !== null && escalated !== undefined) {
      conditions.push(`p.escalated = $${idx++}`);
      values.push(escalated === 'true');
    }
    if (reviewed !== null && reviewed !== undefined) {
      conditions.push(`p.reviewed = $${idx++}`);
      values.push(reviewed === 'true');
    }
    if (search) {
      conditions.push(`(p.title ILIKE $${idx} OR p.body ILIKE $${idx})`);
      values.push(`%${search}%`);
      idx++;
    }
    if (from_date) {
      conditions.push(`p.fetched_at >= $${idx++}`)
      values.push(new Date(from_date))
    }
    if (to_date) {
      const end = new Date(to_date)
      end.setHours(23, 59, 59, 999)
      conditions.push(`p.fetched_at <= $${idx++}`)
      values.push(end)
    }

    const where = conditions.join(' AND ');
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    const countResult = await query(
      `SELECT COUNT(*) as total FROM posts p WHERE ${where}`,
      values
    );
    const total = parseInt(countResult.rows[0].total, 10);

    const { rows } = await query(
      `SELECT
         p.id, p.source, p.external_id, p.title, p.body, p.author, p.url,
         p.raw_engagement, p.escalation_score, p.category_id,
         c.name as category_name, c.color as category_color,
         p.sentiment_intensity, p.reasoning, p.escalated, p.reviewed,
         p.is_competitor, p.competitor_name, p.is_influencer,
         p.response_template, p.post_status, p.acknowledged_at, p.resolved_at,
         p.notes, p.location_tag, p.is_partner, p.partner_name, p.follower_count,
         p.manually_escalated, p.saved_at,
         p.fetched_at, p.post_created_at
       FROM posts p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE ${where}
       ORDER BY p.fetched_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, limitNum, offset]
    );

    return NextResponse.json({
      posts: rows,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
