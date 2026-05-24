import { NextResponse } from 'next/server';
import { sendWelcomeEmail } from '../../../../server/welcome-email.js';

const CRON_SECRET = process.env.CRON_SECRET;

// POST /api/internal/test-welcome
// Body: { email, name }   — or uses GMAIL_USER as fallback recipient
export async function POST(request) {
  const secret = request.headers.get('x-cron-secret');
  if (CRON_SECRET && secret !== CRON_SECRET) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const to = body.email || process.env.GMAIL_USER;
    const name = body.name || 'test user';

    if (!to) return NextResponse.json({ error: 'email required' }, { status: 400 });

    await sendWelcomeEmail({ to, name });
    return NextResponse.json({ ok: true, sentTo: to });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
