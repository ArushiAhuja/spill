import { NextResponse } from 'next/server';
import { getUser, getOrgAccess } from '../../../../../server/api-auth.js';
import { ensureMigrations } from '../../../../../server/migrate.js';
import { listPrompts } from '../../../../../server/prompts.js';

// GET /api/orgs/[slug]/prompts — list all prompts for this org (no full content)
export async function GET(request, { params }) {
  try {
    await ensureMigrations();
    const { slug } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const prompts = await listPrompts(access.orgId);
    return NextResponse.json({ prompts });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
