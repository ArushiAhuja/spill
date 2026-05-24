import { NextResponse } from 'next/server';
import { query } from '../../../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../../../server/api-auth.js';
import { updateOrgIntelligence } from '../../../../../../../server/feedback.js';

// GET /api/orgs/[slug]/posts/[id]/feedback — feedback history for a post
export async function GET(request, { params }) {
  try {
    const { slug, id } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { rows } = await query(
      `SELECT label, explanation, field, old_value, new_value, created_at
       FROM post_feedback
       WHERE post_id = $1 AND org_id = $2
       ORDER BY created_at DESC`,
      [id, access.orgId]
    );

    return NextResponse.json({ feedback: rows });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/orgs/[slug]/posts/[id]/feedback — submit feedback
export async function POST(request, { params }) {
  try {
    const { slug, id } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { rows: existing } = await query(
      'SELECT id FROM posts WHERE id = $1 AND org_id = $2',
      [id, access.orgId]
    );
    if (!existing.length) return NextResponse.json({ error: 'post not found' }, { status: 404 });

    const { label, explanation, field, old_value, new_value } = await request.json();

    const VALID_LABELS = ['not_relevant', 'wrong_geography', 'unrelated_complaint', 'too_generic', 'duplicate', 'useful', 'high_signal', 'missed_category'];
    if (label && !VALID_LABELS.includes(label)) {
      return NextResponse.json({ error: 'invalid label' }, { status: 400 });
    }

    await query(
      `INSERT INTO post_feedback (org_id, post_id, label, explanation, field, old_value, new_value)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [access.orgId, id, label || null, explanation || null, field || null, old_value ?? null, new_value ?? null]
    );

    // If correcting category, apply immediately
    if (field === 'category_id') {
      await query(
        `UPDATE posts SET category_id = $1 WHERE id = $2 AND org_id = $3`,
        [new_value || null, id, access.orgId]
      );
    }

    // Async: distill feedback into exclusion terms and update intel_profile
    // Fire and forget — doesn't block the response
    if (label && ['not_relevant', 'wrong_geography', 'unrelated_complaint', 'too_generic'].includes(label)) {
      updateOrgIntelligence(access.orgId).catch(err =>
        console.warn('[feedback] intelligence update error:', err.message)
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
