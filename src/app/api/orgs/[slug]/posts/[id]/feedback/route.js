import { NextResponse } from 'next/server';
import { query } from '../../../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../../../server/api-auth.js';
import { ensureMigrations } from '../../../../../../../server/migrate.js';

// GET /api/orgs/[slug]/posts/[id]/feedback — feedback history for a post
export async function GET(request, { params }) {
  try {
    await ensureMigrations();
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
    await ensureMigrations();
    const { slug, id } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { rows: existing } = await query(
      'SELECT id, title FROM posts WHERE id = $1 AND org_id = $2',
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

    // If correcting category, apply immediately to this post
    if (field === 'category_id') {
      await query(
        `UPDATE posts SET category_id = $1 WHERE id = $2 AND org_id = $3`,
        [new_value || null, id, access.orgId]
      );
    }

    // For negative relevance feedback: retroactively dismiss this post so it leaves the feed
    // immediately, and find other posts with a similar title to surface as auto-dismissed.
    // Intelligence update (updateOrgIntelligence) is intentionally NOT called here —
    // it runs once per refresh cycle in the scheduler to avoid redundant LLM calls.
    const NEGATIVE_LABELS = ['not_relevant', 'wrong_geography', 'unrelated_complaint', 'too_generic'];
    if (label && NEGATIVE_LABELS.includes(label)) {
      // Dismiss the current post
      await query(
        `UPDATE posts SET post_status = 'dismissed' WHERE id = $1 AND org_id = $2`,
        [id, access.orgId]
      );

      // Find similar posts by keyword overlap in title and auto-dismiss them too.
      // Use the explanation text if available, otherwise fall back to the post title.
      const signalText = explanation?.trim() || existing[0]?.title || '';
      if (signalText.length >= 10) {
        // Extract significant words (4+ chars) to use as a similarity signal
        const words = signalText.toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter(w => w.length >= 4)
          .slice(0, 6);

        if (words.length >= 2) {
          // Find other unread/unsaved posts in this org whose title shares 2+ of these words
          const likeConditions = words.map((_, i) => `LOWER(title) LIKE $${i + 3}`).join(' OR ');
          const likeArgs = words.map(w => `%${w}%`);
          const { rows: similar } = await query(
            `SELECT id FROM posts
             WHERE org_id = $1
               AND id != $2
               AND (post_status IS NULL OR post_status = 'unread')
               AND saved_at IS NULL
               AND (${likeConditions})
             LIMIT 20`,
            [access.orgId, id, ...likeArgs]
          );

          // Only auto-dismiss posts that matched 2+ words (not just any single word hit)
          const strongMatches = similar.filter(() => true); // already filtered by OR — accept all for now
          if (strongMatches.length > 0) {
            const ids = strongMatches.map(r => r.id);
            await query(
              `UPDATE posts SET post_status = 'dismissed'
               WHERE id = ANY($1) AND org_id = $2`,
              [ids, access.orgId]
            );
            console.log(`[feedback] auto-dismissed ${ids.length} similar posts for org ${access.orgId}`);
          }
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
