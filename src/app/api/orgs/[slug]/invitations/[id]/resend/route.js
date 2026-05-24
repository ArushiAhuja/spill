import { NextResponse } from 'next/server';
import { query } from '../../../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../../../server/api-auth.js';
import { sendInviteEmail } from '../../../../../../../server/invite-email.js';
import { ensureMigrations } from '../../../../../../../server/migrate.js';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app-eight-theta-20.vercel.app';
const EXPIRY_DAYS = 7;

// POST /api/orgs/[slug]/invitations/[id]/resend — extend + resend
export async function POST(request, { params }) {
  try {
    await ensureMigrations();
    const { slug, id } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const newExpiry = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const { rows: [inv] } = await query(
      `UPDATE invitations SET expires_at = $1, status = 'pending'
       WHERE id = $2 AND org_id = $3
       RETURNING id, email, token, role, expires_at`,
      [newExpiry, id, access.orgId]
    );

    if (!inv) return NextResponse.json({ error: 'invitation not found' }, { status: 404 });

    const { rows: [org] } = await query(
      'SELECT name, digest_gmail_user, digest_gmail_app_password FROM organizations WHERE id = $1',
      [access.orgId]
    );

    const acceptUrl = `${APP_URL}/invite/${inv.token}`;

    try {
      await sendInviteEmail({
        to: inv.email,
        inviterName: user.name || user.email,
        orgName: org.name,
        acceptUrl,
        orgConfig: {
          digest_gmail_user: org.digest_gmail_user,
          digest_gmail_app_password: org.digest_gmail_app_password,
        },
      });
    } catch (emailErr) {
      return NextResponse.json({
        invitation: inv,
        warning: `invite resent in system but email failed: ${emailErr.message}`,
        acceptUrl,
      });
    }

    return NextResponse.json({ ok: true, invitation: inv, acceptUrl });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
