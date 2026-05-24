import { NextResponse } from 'next/server';
import { getUser, getOrgAccess } from '../../../../../../server/api-auth.js';
import { sendDigestForOrg } from '../../../../../../server/digest.js';

// POST /api/orgs/[slug]/digest/test — send a test digest for this org immediately
export async function POST(request, { params }) {
  try {
    const { slug } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    await sendDigestForOrg(access.orgId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
