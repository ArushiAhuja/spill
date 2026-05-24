import { NextResponse } from 'next/server';
import { pollEmailReplies } from '../../../../server/imap-poller.js';

function isAuthorized(request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const authHeader = request.headers.get('authorization') || '';
  const cronSecret = request.headers.get('x-cron-secret') || '';
  return authHeader === `Bearer ${expected}` || cronSecret === expected;
}

export async function GET(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    await pollEmailReplies();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    await pollEmailReplies();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
