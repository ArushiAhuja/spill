import { NextResponse } from 'next/server';
import { getUser, getOrgAccess } from '../../../../../../server/api-auth.js';
import { ensureMigrations } from '../../../../../../server/migrate.js';
import { getOrgFeatures, isMmtOrg } from '../../../../../../server/mmt-features.js';

// POST /api/orgs/[slug]/mmt/translate
export async function POST(request, { params }) {
  try {
    await ensureMigrations();
    const { slug } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const features = await getOrgFeatures(access.orgId);
    if (!isMmtOrg(features)) return NextResponse.json({ error: 'mmt feature not enabled' }, { status: 403 });

    const { text, target_lang = 'en' } = await request.json();
    if (!text?.trim()) return NextResponse.json({ error: 'text required' }, { status: 400 });

    const gtUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(target_lang)}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(gtUrl);
    if (!res.ok) {
      return NextResponse.json({ error: 'translation service unavailable' }, { status: 502 });
    }

    const result = await res.json();
    const translated = result[0].map(c => c[0]).filter(Boolean).join('');
    const detected_lang = result[2] || null;

    return NextResponse.json({ translated, detected_lang });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
