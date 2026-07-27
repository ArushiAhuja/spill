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
    return NextResponse.json({ operators: rows });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

// POST /api/internal/observability/operators — grant or revoke dashboard access.
export async function POST(request) {
  try {
    const auth = await requireOperatorAdmin(request);
    if (auth.error) return auth.error;
    const { email, granted } = await request.json();
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!normalizedEmail || typeof granted !== 'boolean') {
      return NextResponse.json({ error: 'email and granted are required' }, { status: 400 });
    }
    const { rows: [target] } = await query('SELECT id, email, name FROM users WHERE lower(email) = $1', [normalizedEmail]);
    if (!target) return NextResponse.json({ error: 'user must sign up to Spill before access can be granted' }, { status: 404 });
    if (!granted && target.id === auth.user.id) {
      return NextResponse.json({ error: 'you cannot revoke your own super-admin access' }, { status: 400 });
    }
    const { rows: [operator] } = await query(
      'UPDATE users SET is_super_admin = $1 WHERE id = $2 RETURNING id, email, name, is_super_admin',
      [granted, target.id]
    );
    return NextResponse.json({ operator });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
