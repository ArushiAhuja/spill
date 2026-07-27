import { NextResponse } from 'next/server';
import { getUser } from '../../../../../server/api-auth.js';
import { isSuperAdmin } from '../../../../../server/super-admin.js';
import { ensureMigrations } from '../../../../../server/migrate.js';
import { query } from '../../../../../server/db.js';

export async function GET(request) {
  try {
    await ensureMigrations();
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    if (!(await isSuperAdmin(user))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    const { rows } = await query(`
      SELECT o.id, o.name, o.slug,
        COUNT(t.id)::int AS signals_detected,
        COUNT(t.id) FILTER (WHERE t.decision = 'surfaced')::int AS surfaced,
        COUNT(t.id) FILTER (WHERE t.decision LIKE 'suppressed%')::int AS suppressed,
        ROUND(AVG((t.quality->>'score')::numeric), 1) AS avg_quality,
        ROUND(AVG(p.escalation_score)::numeric, 1) AS avg_escalation,
        ROUND(100.0 * COUNT(f.id) FILTER (WHERE f.label IN ('false_positive','not_relevant')) / NULLIF(COUNT(f.id),0), 1) AS false_positive_rate,
        COALESCE(array_agg(DISTINCT c.name) FILTER (WHERE c.name IS NOT NULL), '{}') AS top_categories
      FROM organizations o
      LEFT JOIN ai_traces t ON t.org_id=o.id AND t.created_at > NOW() - interval '30 days'
      LEFT JOIN posts p ON p.id=t.post_id
      LEFT JOIN post_feedback f ON f.org_id=o.id AND f.created_at > NOW() - interval '30 days'
      LEFT JOIN categories c ON c.id=p.category_id
      GROUP BY o.id ORDER BY surfaced DESC, o.name
    `);
    return NextResponse.json({ organizations: rows });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
