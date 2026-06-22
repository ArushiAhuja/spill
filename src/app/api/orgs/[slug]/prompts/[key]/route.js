import { NextResponse } from 'next/server';
import { getUser, getOrgAccess } from '../../../../../../server/api-auth.js';
import { ensureMigrations } from '../../../../../../server/migrate.js';
import { listPrompts, savePrompt, PROMPT_KEYS } from '../../../../../../server/prompts.js';

// GET /api/orgs/[slug]/prompts/[key] — get a single prompt with full content
export async function GET(request, { params }) {
  try {
    await ensureMigrations();
    const { slug, key } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    if (!PROMPT_KEYS.includes(key)) return NextResponse.json({ error: 'unknown prompt key' }, { status: 404 });

    const all = await listPrompts(access.orgId);
    const prompt = all.find(p => p.prompt_key === key);
    if (!prompt) return NextResponse.json({ error: 'not found' }, { status: 404 });

    return NextResponse.json({ prompt });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT /api/orgs/[slug]/prompts/[key] — save updated content (admin only)
export async function PUT(request, { params }) {
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

    const { content, change_summary } = await request.json();
    if (!content || typeof content !== 'string' || !content.trim()) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 });
    }

    const updated = await savePrompt(access.orgId, key, content.trim(), user.email, change_summary?.trim() || null);
    return NextResponse.json({ prompt: updated });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
