import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { query } from '../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../server/api-auth.js';
import { sendInviteEmail } from '../../../../../server/invite-email.js';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app-eight-theta-20.vercel.app';
const EXPIRY_DAYS = 7;

// GET /api/orgs/[slug]/invitations — list pending invitations
export async function GET(request, { params }) {
  try {
    const { slug } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { rows } = await query(
      `SELECT i.id, i.email, i.role, i.status, i.expires_at, i.created_at,
              u.name as invited_by_name, u.email as invited_by_email
       FROM invitations i
       LEFT JOIN users u ON u.id = i.invited_by
       WHERE i.org_id = $1 AND i.status = 'pending'
       ORDER BY i.created_at DESC`,
      [access.orgId]
    );

    // Mark expired ones
    const now = new Date();
    for (const inv of rows) {
      if (new Date(inv.expires_at) < now) inv.status = 'expired';
    }

    return NextResponse.json({ invitations: rows });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/orgs/[slug]/invitations — create + send
export async function POST(request, { params }) {
  try {
    const { slug } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { email, role = 'member' } = await request.json();
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'valid email required' }, { status: 400 });
    }
    const normalizedEmail = email.toLowerCase().trim();

    // Already a member?
    const { rows: existing } = await query(
      `SELECT u.id FROM users u JOIN org_members om ON om.user_id = u.id
       WHERE u.email = $1 AND om.org_id = $2`,
      [normalizedEmail, access.orgId]
    );
    if (existing.length) {
      return NextResponse.json({ error: 'this person is already a member of this workspace' }, { status: 409 });
    }

    // Already has a pending invite? Revoke old one and create fresh
    await query(
      `UPDATE invitations SET status = 'revoked' WHERE org_id = $1 AND email = $2 AND status = 'pending'`,
      [access.orgId, normalizedEmail]
    );

    const token = randomUUID().replace(/-/g, '');
    const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const { rows: [inv] } = await query(
      `INSERT INTO invitations (org_id, email, token, role, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, role, token, expires_at, created_at`,
      [access.orgId, normalizedEmail, token, role, user.id, expiresAt]
    );

    // Fetch org name + sender config for the email
    const { rows: [org] } = await query(
      'SELECT name, digest_gmail_user, digest_gmail_app_password FROM organizations WHERE id = $1',
      [access.orgId]
    );

    const acceptUrl = `${APP_URL}/invite/${token}`;

    try {
      await sendInviteEmail({
        to: normalizedEmail,
        inviterName: user.name || user.email,
        orgName: org.name,
        acceptUrl,
        orgConfig: {
          digest_gmail_user: org.digest_gmail_user,
          digest_gmail_app_password: org.digest_gmail_app_password,
        },
      });
    } catch (emailErr) {
      // Invitation created but email failed — surface the error so user knows
      return NextResponse.json({
        invitation: inv,
        warning: `invitation created but email failed: ${emailErr.message}`,
        acceptUrl,
      });
    }

    return NextResponse.json({ invitation: inv, acceptUrl }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
