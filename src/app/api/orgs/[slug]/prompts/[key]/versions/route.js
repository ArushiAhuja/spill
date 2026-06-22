import { NextResponse } from 'next/server';
import { getUser, getOrgAccess } from '../../../../../../../server/api-auth.js';
import { ensureMigrations } from '../../../../../../../server/migrate.js';
import { getPromptVersions, PROMPT_KEYS } from '../../../../../../../server/prompts.js';

// GET /api/orgs/[slug]/prompts/[key]/versions — version history
export async function GET(request, { params }) {
  try {
    await ensureMigrations();
    const { slug, key } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    if (!PROMPT_KEYS.includes(key)) return NextResponse.json({ error: 'unknown prompt key' }, { status: 404 });

    const versions = await getPromptVersions(access.orgId, key);
    return NextResponse.json({ versions });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
