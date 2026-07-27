import { NextResponse } from 'next/server';
import { getUser } from '../../../../../server/api-auth.js';
import { isSuperAdmin } from '../../../../../server/super-admin.js';
import { ensureMigrations } from '../../../../../server/migrate.js';
import { query } from '../../../../../server/db.js';

async function requireOperatorAdmin(request) {
  await ensureMigrations();
  const user = getUser(request);
  if (!user) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  if (!(await isSuperAdmin(user))) return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  return { user };
}

// GET /api/internal/observability/operators — super-admin-only access roster.
export async function GET(request) {
  try {
    const auth = await requireOperatorAdmin(request);
    if (auth.error) return auth.error;
    const { rows } = await query(
      `SELECT id, email, name, is_super_admin
       FROM users WHERE is_super_admin = true ORDER BY email`
    );
    const { rows: scoped } = await query(`SELECT a.id, a.org_id, o.name AS org_name, u.email, u.name, a.created_at FROM observability_org_access a JOIN users u ON u.id=a.user_id JOIN organizations o ON o.id=a.org_id ORDER BY o.name, u.email`);
    return NextResponse.json({ operators: rows, scoped });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

// POST /api/internal/observability/operators — grant or revoke dashboard access.
export async function POST(request) {
  try {
    const auth = await requireOperatorAdmin(request);
    if (auth.error) return auth.error;
    const { email, granted, org_id } = await request.json();
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!normalizedEmail || typeof granted !== 'boolean') {
      return NextResponse.json({ error: 'email and granted are required' }, { status: 400 });
    }
    const { rows: [target] } = await query('SELECT id, email, name FROM users WHERE lower(email) = $1', [normalizedEmail]);
    if (!target) return NextResponse.json({ error: 'user must sign up to Spill before access can be granted' }, { status: 404 });
    if (!org_id && !granted && target.id === auth.user.id) {
      return NextResponse.json({ error: 'you cannot revoke your own super-admin access' }, { status: 400 });
    }
    if (org_id) {
      const { rows: [org] } = await query('SELECT id, name FROM organizations WHERE id=$1', [org_id]);
      if (!org) return NextResponse.json({ error: 'organisation not found' }, { status: 404 });
      if (granted) await query('INSERT INTO observability_org_access (org_id,user_id,granted_by) VALUES ($1,$2,$3) ON CONFLICT (org_id,user_id) DO NOTHING', [org.id, target.id, auth.user.id]);
      else await query('DELETE FROM observability_org_access WHERE org_id=$1 AND user_id=$2', [org.id, target.id]);
      return NextResponse.json({ scoped: { org_id: org.id, org_name: org.name, email: target.email, granted } });
    }
    const { rows: [operator] } = await query(
      'UPDATE users SET is_super_admin = $1 WHERE id = $2 RETURNING id, email, name, is_super_admin',
      [granted, target.id]
    );
    return NextResponse.json({ operator });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
