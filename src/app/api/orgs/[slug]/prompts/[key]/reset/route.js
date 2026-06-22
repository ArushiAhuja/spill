import { NextResponse } from 'next/server';
import { getUser, getOrgAccess } from '../../../../../../../server/api-auth.js';
import { ensureMigrations } from '../../../../../../../server/migrate.js';
import { resetPrompt, PROMPT_KEYS } from '../../../../../../../server/prompts.js';

// POST /api/orgs/[slug]/prompts/[key]/reset — restore default content
export async function POST(request, { params }) {
  try {
    await ensureMigrations();
    const { slug, key } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    if (!['owner', 'admin'].includes(access.orgRole)) {
      return NextResponse.json({ error: 'admin access required' }, { status: 403 });
    }

    if (!PROMPT_KEYS.includes(key)) return NextResponse.json({ error: 'unknown prompt key' }, { status: 404 });

    const updated = await resetPrompt(access.orgId, key, user.email);
    return NextResponse.json({ prompt: updated, ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
