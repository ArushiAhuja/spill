import { query } from '../db.js';

const INCIDENT_THRESHOLD = 5;
const INCIDENT_WINDOW_HOURS = 2;
const REOPEN_WINDOW_HOURS = 4;

export async function detectIncidents(orgId, newPosts, insertedIds, threshold = 5) {
  const escalatedNew = newPosts.filter(p => p.escalated && p.category_id);
  if (!escalatedNew.length) return;

  // Group by category
  const byCategory = {};
  for (const post of escalatedNew) {
    if (!byCategory[post.category_id]) byCategory[post.category_id] = [];
    byCategory[post.category_id].push(post);
  }

  for (const [categoryId, posts] of Object.entries(byCategory)) {
    try {
      // Count escalated posts in this category in the window
      const { rows: [{ count }] } = await query(`
        SELECT COUNT(*) as count FROM posts
        WHERE org_id = $1 AND category_id = $2 AND escalated = true
          AND COALESCE(created_at, post_created_at) > NOW() - INTERVAL '${INCIDENT_WINDOW_HOURS} hours'
      `, [orgId, categoryId]);

      const total = parseInt(count);
      if (total < threshold) continue;

      // Check for existing open incident
      const { rows: existing } = await query(`
        SELECT id FROM incidents
        WHERE org_id = $1 AND category_id = $2 AND status = 'open'
          AND COALESCE(created_at, started_at) > NOW() - INTERVAL '${REOPEN_WINDOW_HOURS} hours'
        LIMIT 1
      `, [orgId, categoryId]);

      let incidentId;
      if (existing.length) {
        incidentId = existing[0].id;
        await query(
          'UPDATE incidents SET post_count = $1 WHERE id = $2',
          [total, incidentId]
        );
      } else {
        const { rows: [cat] } = await query(
          'SELECT name FROM categories WHERE id = $1', [categoryId]
        );
        const title = `${cat?.name || 'Unknown'} — ${total} signals in ${INCIDENT_WINDOW_HOURS}h`;
        const { rows: [inc] } = await query(
          `INSERT INTO incidents (org_id, category_id, title, post_count) VALUES ($1,$2,$3,$4) RETURNING id`,
          [orgId, categoryId, title, total]
        );
        incidentId = inc.id;
        console.log(`[incidents] new incident for org ${orgId}: "${title}"`);
      }

      // Link newly inserted posts to incident using their DB ids.
      // insertedIds is parallel to newPosts (same indices), so we match by position.
      const postDbIds = newPosts
        .map((p, i) => ({ post: p, dbId: insertedIds[i] }))
        .filter(({ post }) => post.escalated && post.category_id === categoryId)
        .map(({ dbId }) => dbId)
        .filter(Boolean);
      for (const dbId of postDbIds) {
        if (!dbId) continue;
        await query(
          `INSERT INTO incident_posts (incident_id, post_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [incidentId, dbId]
        ).catch(() => {});
      }
    } catch (err) {
      console.error(`[incidents] error for category ${categoryId}:`, err.message);
    }
  }
}
