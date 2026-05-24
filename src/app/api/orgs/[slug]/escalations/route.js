import { NextResponse } from 'next/server';
import { query } from '../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../server/api-auth.js';

const VALID_ACTION_TYPES = ['email', 'webhook', 'sheets', 'slack'];

// GET /api/orgs/[slug]/escalations
export async function GET(request, { params }) {
  try {
    const { slug } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { rows } = await query(
      `SELECT er.*,
         COALESCE(
           json_agg(DISTINCT c.*) FILTER (WHERE c.id IS NOT NULL),
           '[]'
         ) as category_details,
         COALESCE(SUM(efl.fire_count), 0) as total_fires,
         MAX(efl.last_fired_at) as last_fired_at
       FROM escalation_rules er
       LEFT JOIN categories c ON c.id = ANY(er.category_ids) AND c.org_id = er.org_id
       LEFT JOIN escalation_fire_log efl ON efl.rule_id = er.id
       WHERE er.org_id = $1
       GROUP BY er.id
       ORDER BY er.created_at DESC`,
      [access.orgId]
    );
    return NextResponse.json(rows);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/orgs/[slug]/escalations
export async function POST(request, { params }) {
  try {
    const { slug } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { name, category_ids, score_threshold, action_type, config, enabled } = await request.json();

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (!action_type || !VALID_ACTION_TYPES.includes(action_type)) {
      return NextResponse.json({ error: `action_type must be one of: ${VALID_ACTION_TYPES.join(', ')}` }, { status: 400 });
    }

    const { rows } = await query(
      `INSERT INTO escalation_rules (org_id, name, category_ids, score_threshold, action_type, config, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        access.orgId,
        name.trim(),
        Array.isArray(category_ids) ? category_ids : [],
        typeof score_threshold === 'number' ? score_threshold : 60,
        action_type,
        config || {},
        enabled !== undefined ? enabled : true,
      ]
    );

    return NextResponse.json(rows[0], { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
