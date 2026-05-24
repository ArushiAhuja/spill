import { NextResponse } from 'next/server';
import { runAllOrgs, runOrgCycle } from '../../../../server/scheduler.js';

export const maxDuration = 300;

function isAuthorized(request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false; // No secret configured — deny all access
  const authHeader = request.headers.get('authorization') || '';
  const cronSecret = request.headers.get('x-cron-secret') || '';
  return authHeader === `Bearer ${expected}` || cronSecret === expected;
}

// GET — invoked by Vercel cron scheduler
export async function GET(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    await runAllOrgs();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST — manual trigger; accepts optional { orgId } to run a single org
export async function POST(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    let orgId;
    try { ({ orgId } = await request.json()); } catch {}
    if (orgId) {
      await runOrgCycle(orgId);
    } else {
      await runAllOrgs();
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
