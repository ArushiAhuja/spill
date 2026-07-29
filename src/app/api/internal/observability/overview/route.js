import { NextResponse } from 'next/server';
import { getUser } from '../../../../../server/api-auth.js';
import { getObservabilityScope } from '../../../../../server/super-admin.js';
import { ensureMigrations } from '../../../../../server/migrate.js';
import { query } from '../../../../../server/db.js';

export async function GET(request) {
  try {
    await ensureMigrations();
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const scope = await getObservabilityScope(user);
    if (!scope.all && !scope.orgIds.length) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    const where = scope.all ? '' : 'WHERE o.id = ANY($1::uuid[])';
    const { rows } = await query(`
      SELECT o.id, o.name, o.slug,
        COALESCE(ps.signals_detected,0)::int AS signals_detected, COALESCE(ps.signals_detected,0)::int AS surfaced,
        COALESCE(ts.suppressed,0)::int AS suppressed, ts.avg_quality, ps.avg_escalation,
        COALESCE(ps.alerts_triggered,0)::int AS alerts_triggered,
        CASE WHEN COALESCE(fs.reviewed,0) < 10 THEN NULL ELSE ROUND(100.0 * fs.false_positives / fs.reviewed, 1) END AS false_positive_rate,
        COALESCE(ps.top_categories, '{}') AS top_categories, COALESCE(src.active_sources, '{}') AS active_sources, COALESCE(ps.last_event_at,ts.last_event_at) AS last_event_at
      FROM organizations o
      LEFT JOIN LATERAL (SELECT COUNT(*) FILTER (WHERE decision LIKE 'suppressed%') suppressed, ROUND(AVG((quality->>'score')::numeric),1) avg_quality, MAX(created_at) last_event_at FROM ai_traces WHERE org_id=o.id) ts ON true
      LEFT JOIN LATERAL (SELECT COUNT(*) signals_detected, COUNT(*) FILTER (WHERE escalated=true) alerts_triggered, ROUND(AVG(escalation_score)::numeric,1) avg_escalation, MAX(created_at) last_event_at, COALESCE(array_agg(DISTINCT category_name) FILTER (WHERE category_name IS NOT NULL),'{}') top_categories FROM (SELECT p.escalated,p.escalation_score,p.created_at,c.name AS category_name FROM posts p LEFT JOIN categories c ON c.id=p.category_id WHERE p.org_id=o.id) posts_for_org) ps ON true
      LEFT JOIN LATERAL (SELECT COUNT(*) FILTER (WHERE label IS NOT NULL) reviewed, COUNT(*) FILTER (WHERE label IN ('false_positive','not_relevant','noise')) false_positives FROM post_feedback WHERE org_id=o.id) fs ON true
      LEFT JOIN LATERAL (SELECT COALESCE(array_agg(source ORDER BY source),'{}') active_sources FROM source_configs WHERE org_id=o.id AND enabled=true) src ON true
      ${where} ORDER BY surfaced DESC, o.name
    `, scope.all ? [] : [scope.orgIds]);
    return NextResponse.json({ organizations: rows });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
