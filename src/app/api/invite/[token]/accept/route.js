import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../../../../../server/db.js';
import { ensureMigrations } from '../../../../../server/migrate.js';

const JWT_SECRET = process.env.JWT_SECRET || 'spill_dev_secret_change_in_prod';

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// POST /api/invite/[token]/accept
// New user: { name, password }
// Existing user: { password }
export async function POST(request, { params }) {
  try {
    await ensureMigrations();
    const { token } = params;
    const body = await request.json();

    const { rows: [inv] } = await query(
      `SELECT i.id, i.email, i.status, i.expires_at, i.role, i.org_id,
              o.slug as org_slug, o.name as org_name
       FROM invitations i
       JOIN organizations o ON o.id = i.org_id
       WHERE i.token = $1`,
      [token]
    );

    if (!inv) return NextResponse.json({ error: 'invitation not found' }, { status: 404 });
    if (inv.status === 'revoked') return NextResponse.json({ error: 'this invitation has been revoked' }, { status: 410 });
    if (inv.status === 'accepted') return NextResponse.json({ error: 'invitation already accepted', org: { slug: inv.org_slug } }, { status: 409 });
    if (new Date(inv.expires_at) < new Date()) return NextResponse.json({ error: 'this invitation has expired' }, { status: 410 });

    const { rows: existing } = await query(
      'SELECT id, email, name, password_hash FROM users WHERE email = $1',
      [inv.email]
    );

    let user;

    if (existing.length) {
      // Existing user — verify password and add to org
      if (!body.password) return NextResponse.json({ error: 'password is required' }, { status: 400 });
      const valid = await bcrypt.compare(body.password, existing[0].password_hash);
      if (!valid) return NextResponse.json({ error: 'incorrect password' }, { status: 401 });
      user = existing[0];
    } else {
      // New user — create account
      const { name, password } = body;
      if (!name || typeof name !== 'string' || !name.trim()) {
        return NextResponse.json({ error: 'name is required' }, { status: 400 });
      }
      if (!password || typeof password !== 'string' || password.length < 8) {
        return NextResponse.json({ error: 'password must be at least 8 characters' }, { status: 400 });
      }
      const password_hash = await bcrypt.hash(password, 10);
      try {
        const { rows: [created] } = await query(
          'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email, name',
          [name.trim(), inv.email, password_hash]
        );
        user = created;
      } catch (err) {
        if (err.code === '23505') {
          return NextResponse.json({ error: 'email already in use' }, { status: 409 });
        }
        throw err;
      }
    }

    // Add to org (upsert — may already be a member if re-accepting)
    await query(
      `INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (org_id, user_id) DO NOTHING`,
      [inv.org_id, user.id, inv.role]
    );

    // Mark invitation accepted
    await query(
      `UPDATE invitations SET status = 'accepted' WHERE id = $1`,
      [inv.id]
    );

    const jwtToken = signToken(user);
    return NextResponse.json({
      token: jwtToken,
      user: { id: user.id, email: user.email, name: user.name },
      org: { slug: inv.org_slug, name: inv.org_name },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
