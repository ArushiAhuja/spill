import { NextResponse } from 'next/server';
import { query } from '../../../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../../../server/api-auth.js';
import { ensureMigrations } from '../../../../../../../server/migrate.js';

const VALID_LABELS = new Set([
  // Exclusion signals
  'not_relevant', 'wrong_geography', 'unrelated_complaint', 'too_generic', 'duplicate',
  // Correction signals
  'wrong_category', 'missed_category', 'wrong_severity', 'false_positive', 'missed_context',
  // Positive signals
  'useful', 'high_signal',
]);

const NEGATIVE_LABELS = new Set(['not_relevant', 'wrong_geography', 'unrelated_complaint', 'too_generic', 'duplicate', 'false_positive']);

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
      `SELECT label, explanation, field, old_value, new_value, severity_direction, resulting_adjustment, created_at
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
      'SELECT id, title, escalation_score, category_id, escalated FROM posts WHERE id = $1 AND org_id = $2',
      [id, access.orgId]
    );
    if (!existing.length) return NextResponse.json({ error: 'post not found' }, { status: 404 });
    const post = existing[0];

    const body = await request.json();
    const { label, explanation, field, old_value, new_value, severity_direction } = body;

    if (label && !VALID_LABELS.has(label)) {
      return NextResponse.json({ error: 'invalid label' }, { status: 400 });
    }

    // Determine what immediate adjustment will be made and store it
    let resultingAdjustment = null;
    let insertField = field || null;
    let insertOldValue = old_value ?? null;
    let insertNewValue = new_value ?? null;

    // --- Apply immediate actions per label ---

    if (label === 'wrong_category' || label === 'missed_category') {
      if (new_value) {
        const { rows: [cat] } = await query('SELECT name FROM categories WHERE id = $1', [new_value]).catch(() => ({ rows: [] }));
        const { rows: [oldCat] } = await query('SELECT name FROM categories WHERE id = $1', [post.category_id]).catch(() => ({ rows: [] }));
        await query(
          'UPDATE posts SET category_id = $1 WHERE id = $2 AND org_id = $3',
          [new_value || null, id, access.orgId]
        );
        insertField = 'category_id';
        insertOldValue = post.category_id || null;
        insertNewValue = new_value || null;
        resultingAdjustment = cat
          ? `category corrected → ${cat.name}${oldCat ? ` (was: ${oldCat.name})` : ''}`
          : 'category corrected';
      } else {
        resultingAdjustment = 'category cleared; classified as uncategorized';
        await query('UPDATE posts SET category_id = NULL WHERE id = $1 AND org_id = $2', [id, access.orgId]);
      }
    }

    if (label === 'wrong_severity') {
      const direction = severity_direction || old_value; // accept either field
      insertField = 'escalation_score';
      insertOldValue = String(post.escalation_score || 0);

      if (direction === 'lower') {
        const newScore = Math.max(0, (post.escalation_score || 0) - 25);
        const threshold = parseInt(process.env.ESCALATE_THRESHOLD) || 60;
        await query(
          'UPDATE posts SET escalation_score = $1, escalated = $2 WHERE id = $3 AND org_id = $4',
          [newScore, newScore >= threshold, id, access.orgId]
        );
        insertNewValue = String(newScore);
        resultingAdjustment = `escalation score reduced: ${post.escalation_score} → ${newScore}`;
      } else if (direction === 'higher') {
        const newScore = Math.min(100, (post.escalation_score || 0) + 25);
        await query(
          'UPDATE posts SET escalation_score = $1, escalated = true WHERE id = $2 AND org_id = $3',
          [newScore, id, access.orgId]
        );
        insertNewValue = String(newScore);
        resultingAdjustment = `escalation score raised: ${post.escalation_score} → ${newScore}`;
      }
    }

    if (label === 'false_positive') {
      const threshold = parseInt(process.env.ESCALATE_THRESHOLD) || 60;
      const newScore = Math.max(0, (post.escalation_score || 0) - 30);
      await query(
        'UPDATE posts SET escalated = false, escalation_score = $1, post_status = $2 WHERE id = $3 AND org_id = $4',
        [newScore, 'dismissed', id, access.orgId]
      );
      resultingAdjustment = `de-escalated and dismissed; false positive pattern recorded`;
    }

    if (label === 'missed_context') {
      // If the post wasn't escalated, bump it up so the team sees it
      const threshold = parseInt(process.env.ESCALATE_THRESHOLD) || 60;
      if (!post.escalated) {
        const newScore = Math.min(100, (post.escalation_score || 0) + 20);
        await query(
          'UPDATE posts SET escalation_score = $1, escalated = $2 WHERE id = $3 AND org_id = $4',
          [newScore, newScore >= threshold, id, access.orgId]
        );
        resultingAdjustment = `escalation score raised: ${post.escalation_score} → ${newScore}; context added to intelligence`;
      } else {
        resultingAdjustment = 'context pattern added to intelligence profile';
      }
    }

    if (NEGATIVE_LABELS.has(label)) {
      await query(
        'UPDATE posts SET post_status = $1 WHERE id = $2 AND org_id = $3',
        ['dismissed', id, access.orgId]
      );
      resultingAdjustment = resultingAdjustment || 'post dismissed; exclusion pattern recorded for future cycles';

      // Auto-dismiss similar posts by keyword overlap
      const signalText = explanation?.trim() || post.title || '';
      if (signalText.length >= 10) {
        const words = signalText.toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter(w => w.length >= 4)
          .slice(0, 6);

        if (words.length >= 2) {
          const likeConditions = words.map((_, i) => `LOWER(title) LIKE $${i + 3}`).join(' OR ');
          const likeArgs = words.map(w => `%${w}%`);
          const { rows: similar } = await query(
            `SELECT id FROM posts
             WHERE org_id = $1 AND id != $2
               AND (post_status IS NULL OR post_status = 'unread')
               AND saved_at IS NULL AND (${likeConditions})
             LIMIT 20`,
            [access.orgId, id, ...likeArgs]
          );
          if (similar.length > 0) {
            await query(
              'UPDATE posts SET post_status = $1 WHERE id = ANY($2) AND org_id = $3',
              ['dismissed', similar.map(r => r.id), access.orgId]
            );
            console.log(`[feedback] auto-dismissed ${similar.length} similar posts for org ${access.orgId}`);
          }
        }
      }
    }

    // Default adjustment text for labels not handled above
    if (!resultingAdjustment) {
      const adjustments = {
        useful:        'boost pattern recorded; similar posts will be prioritized',
        high_signal:   'high-signal pattern recorded; similar posts may be escalated',
        not_relevant:  'post dismissed; exclusion pattern recorded',
        duplicate:     'post dismissed as duplicate',
        too_generic:   'post dismissed; generic pattern excluded from future cycles',
      };
      resultingAdjustment = adjustments[label] || 'feedback recorded';
    }

    await query(
      `INSERT INTO post_feedback (org_id, post_id, label, explanation, field, old_value, new_value, severity_direction, resulting_adjustment)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        access.orgId, id, label || null, explanation || null,
        insertField, insertOldValue, insertNewValue,
        severity_direction || null,
        resultingAdjustment,
      ]
    );

    return NextResponse.json({ ok: true, resulting_adjustment: resultingAdjustment });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
