import { NextResponse } from 'next/server';
import { query } from '../../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../../server/api-auth.js';
import { ensureMigrations } from '../../../../../../server/migrate.js';
import { getOrgFeatures, isMmtOrg } from '../../../../../../server/mmt-features.js';

// GET /api/orgs/[slug]/mmt/sessions
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
    const date = url.searchParams.get('date') || null;

    const conditions = [`s.org_id = $1`];
    const values = [access.orgId];
    let paramIdx = 2;

    if (date) {
      conditions.push(`s.session_date = $${paramIdx++}`);
      values.push(date);
    } else {
      conditions.push(`s.session_date = CURRENT_DATE`);
    }

    const where = conditions.join(' AND ');

    const { rows: sessions } = await query(
      `SELECT s.*, COUNT(DISTINCT t.id) as tickets_count
       FROM agent_sessions s
       LEFT JOIN tickets t ON t.assigned_to = s.user_id AND DATE(t.updated_at) = s.session_date
       WHERE ${where}
       GROUP BY s.id
       ORDER BY s.login_at DESC`,
      values
    );

    return NextResponse.json({ sessions });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/orgs/[slug]/mmt/sessions
export async function POST(request, { params }) {
  try {
    await ensureMigrations();
    const { slug } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const features = await getOrgFeatures(access.orgId);
    if (!isMmtOrg(features)) return NextResponse.json({ error: 'mmt feature not enabled' }, { status: 403 });

    const { action, break_minutes, notes } = await request.json();

    if (!['login', 'logout', 'break'].includes(action)) {
      return NextResponse.json({ error: 'action must be login, logout, or break' }, { status: 400 });
    }

    if (action === 'login') {
      const { rows: [session] } = await query(
        `INSERT INTO agent_sessions (org_id, user_id, user_name, user_email, login_at)
         VALUES ($1, $2, $3, $4, NOW())
         RETURNING *`,
        [access.orgId, user.id, user.name || null, user.email || null]
      );
      return NextResponse.json({ session }, { status: 201 });
    }

    if (action === 'logout') {
      const { rows: [session] } = await query(
        `UPDATE agent_sessions SET logout_at = NOW()
         WHERE id = (
           SELECT id FROM agent_sessions
           WHERE org_id = $1 AND user_id = $2 AND logout_at IS NULL
           ORDER BY login_at DESC LIMIT 1
         )
         RETURNING *`,
        [access.orgId, user.id]
      );
      if (!session) return NextResponse.json({ error: 'no open session found' }, { status: 404 });
      return NextResponse.json({ session });
    }

    if (action === 'break') {
      const { rows: [session] } = await query(
        `UPDATE agent_sessions SET break_minutes = COALESCE(break_minutes, 0) + $1
         WHERE id = (
           SELECT id FROM agent_sessions
           WHERE org_id = $2 AND user_id = $3 AND logout_at IS NULL
           ORDER BY login_at DESC LIMIT 1
         )
         RETURNING *`,
        [break_minutes || 0, access.orgId, user.id]
      );
      if (!session) return NextResponse.json({ error: 'no open session found' }, { status: 404 });
      if (notes !== undefined) {
        await query('UPDATE agent_sessions SET notes = $1 WHERE id = $2', [notes, session.id]);
        session.notes = notes;
      }
      return NextResponse.json({ session });
    }
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
