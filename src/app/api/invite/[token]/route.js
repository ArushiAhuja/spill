import { NextResponse } from 'next/server';
import { query } from '../../../../server/db.js';
import { ensureMigrations } from '../../../../server/migrate.js';

// GET /api/invite/[token] — public: verify invitation token
export async function GET(request, { params }) {
  try {
    await ensureMigrations();
    const { token } = params;

    const { rows: [inv] } = await query(
      `SELECT i.id, i.email, i.status, i.expires_at,
              o.name as org_name, o.slug as org_slug,
              u.name as inviter_name, u.email as inviter_email
       FROM invitations i
       JOIN organizations o ON o.id = i.org_id
       LEFT JOIN users u ON u.id = i.invited_by
       WHERE i.token = $1`,
      [token]
    );

    if (!inv) return NextResponse.json({ error: 'invitation not found' }, { status: 404 });

    const expired = inv.status === 'revoked'
      ? false
      : new Date(inv.expires_at) < new Date();

    if (inv.status === 'accepted') {
      return NextResponse.json({ accepted: true, org: { slug: inv.org_slug } });
    }

    // Check if a user with this email already exists
    const { rows: existing } = await query(
      'SELECT id FROM users WHERE email = $1',
      [inv.email]
    );

    return NextResponse.json({
      org: { name: inv.org_name, slug: inv.org_slug },
      inviter: { name: inv.inviter_name, email: inv.inviter_email },
      email: inv.email,
      expired: expired || inv.status === 'revoked',
      revoked: inv.status === 'revoked',
      userExists: existing.length > 0,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
