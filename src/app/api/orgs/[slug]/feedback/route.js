import { NextResponse } from 'next/server';
import { query } from '../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../server/api-auth.js';

// GET /api/orgs/[slug]/feedback — all feedback for this org, with post context
export async function GET(request, { params }) {
  try {
    const { slug } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const labelFilter = searchParams.get('label');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const offset = (page - 1) * limit;

    const conditions = ['f.org_id = $1'];
    const values = [access.orgId];
    let idx = 2;

    if (labelFilter && labelFilter !== 'all') {
      const groups = {
        excluded: ['not_relevant', 'wrong_geography', 'unrelated_complaint', 'too_generic', 'duplicate'],
        boosted: ['useful', 'high_signal'],
        corrections: ['missed_category'],
      };
      const labels = groups[labelFilter];
      if (labels) {
        conditions.push(`f.label = ANY($${idx++}::text[])`);
        values.push(labels);
      } else {
        conditions.push(`f.label = $${idx++}`);
        values.push(labelFilter);
      }
    }

    const where = conditions.join(' AND ');

    const { rows: [{ total }] } = await query(
      `SELECT COUNT(*) as total FROM post_feedback f WHERE ${where}`,
      values
    );

    const { rows } = await query(
      `SELECT
         f.id, f.post_id, f.label, f.explanation, f.field, f.old_value, f.new_value, f.created_at,
         p.title as post_title, p.url as post_url, p.source as post_source,
         p.post_status, p.escalation_score, p.category_id,
         c.name as category_name, c.color as category_color
       FROM post_feedback f
       LEFT JOIN posts p ON p.id = f.post_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE ${where}
       ORDER BY f.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, limit, offset]
    );

    // Also fetch current intel_profile so frontend can show which patterns are active
    const { rows: [org] } = await query(
      'SELECT intel_profile FROM organizations WHERE id = $1',
      [access.orgId]
    );
    const exclusionTerms = org?.intel_profile?.exclusionTerms || [];

    return NextResponse.json({
      feedback: rows,
      total: parseInt(total, 10),
      page,
      pages: Math.ceil(parseInt(total, 10) / limit),
      exclusionTerms,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
