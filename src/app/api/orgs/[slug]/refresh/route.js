import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { getUser, getOrgAccess } from '../../../../../server/api-auth.js';
import { refreshOrg } from '../../../../../server/scheduler.js';

export const maxDuration = 60;

// POST /api/orgs/[slug]/refresh — trigger manual refresh
export async function POST(request, { params }) {
  try {
    const { slug } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    // waitUntil keeps the Vercel function instance alive until the fetch completes
    // even after the response has been sent — prevents fire-and-forget being killed early
    waitUntil(
      refreshOrg(access.orgId).catch((err) =>
        console.error(`[refresh] org ${access.orgId} failed:`, err.message)
      )
    );

    return NextResponse.json({ message: 'refresh triggered' });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
