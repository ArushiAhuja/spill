import { NextResponse } from 'next/server';
import { query } from '../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../server/api-auth.js';
import { ensureMigrations } from '../../../../../server/migrate.js';
import { computeCustomerLabels } from '../../../../../server/mmt-features.js';

// GET /api/orgs/[slug]/tickets
export async function GET(request, { params }) {
  try {
    await ensureMigrations();
    const { slug } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const url = new URL(request.url);
    const status = url.searchParams.get('status') || null;
    const channel = url.searchParams.get('channel') || null;
    const assigned_to = url.searchParams.get('assigned_to') || null;
    const priority = url.searchParams.get('priority') || null;
    const tag = url.searchParams.get('tag') || null;
    const search = url.searchParams.get('search') || null;
    const aging = url.searchParams.get('aging') || null;
    const awaiting_customer = url.searchParams.get('awaiting_customer') || null;
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);
    const offset = parseInt(url.searchParams.get('offset') || '0');

    const conditions = [`t.org_id = $1`];
    const values = [access.orgId];
    let paramIdx = 2;

    if (status) {
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
      conditions.push(`t.status = ANY($${paramIdx++}::text[])`);
      values.push(statuses);
    }
    if (channel) { conditions.push(`t.channel = $${paramIdx++}`); values.push(channel); }
    if (assigned_to) { conditions.push(`t.assigned_to = $${paramIdx++}`); values.push(assigned_to); }
    if (priority) { conditions.push(`t.priority = $${paramIdx++}`); values.push(priority); }
    if (tag) { conditions.push(`$${paramIdx++} = ANY(t.tags)`); values.push(tag); }
    if (search) {
      conditions.push(`(t.title ILIKE $${paramIdx} OR t.author ILIKE $${paramIdx} OR t.author_handle ILIKE $${paramIdx})`);
      values.push(`%${search}%`);
      paramIdx++;
    }
    if (aging === '2d') {
      conditions.push(`t.created_at < NOW() - INTERVAL '2 days'`);
    } else if (aging === '14d') {
      conditions.push(`t.created_at < NOW() - INTERVAL '14 days'`);
    }
    if (awaiting_customer === 'true') {
      conditions.push(`t.awaiting_customer = true`);
    }

    const where = conditions.join(' AND ');

    const { rows: tickets } = await query(
      `SELECT t.*, u.name as assigned_user_name, u.email as assigned_user_email,
              (SELECT COUNT(*) FROM ticket_notes tn WHERE tn.ticket_id = t.id) as note_count
       FROM tickets t
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE ${where}
       ORDER BY t.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...values, limit, offset]
    );

    const { rows: [{ count }] } = await query(
      `SELECT COUNT(*) FROM tickets t WHERE ${where}`,
      values
    );

    // Status summary counts
    const { rows: statusCounts } = await query(
      `SELECT status, COUNT(*) as count FROM tickets WHERE org_id = $1 GROUP BY status`,
      [access.orgId]
    );

    return NextResponse.json({
      tickets,
      total: parseInt(count),
      statusCounts: statusCounts.reduce((acc, r) => { acc[r.status] = parseInt(r.count); return acc; }, {}),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/orgs/[slug]/tickets — create ticket manually
export async function POST(request, { params }) {
  try {
    await ensureMigrations();
    const { slug } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const body = await request.json();
    const { title, channel = 'manual', post_id, author, author_handle, follower_count, url: ticketUrl, tags, priority = 'normal', body: ticketBody, assigned_to, verified_handle = false, booking_details } = body;

    if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 });

    const { rows: [org] } = await query(
      'SELECT sla_first_response_minutes FROM organizations WHERE id = $1',
      [access.orgId]
    );
    const slaMinutes = org?.sla_first_response_minutes || 60;
    const slaFirstAt = new Date(Date.now() + slaMinutes * 60 * 1000);

    const initialLabels = computeCustomerLabels({ follower_count: follower_count || 0, verified_handle, mention_count: 1 });

    const { rows: [ticket] } = await query(
      `INSERT INTO tickets (org_id, post_id, source, channel, title, body, author, author_handle, follower_count, url, tags, priority, assigned_to, sla_first_response_at, verified_handle, booking_details, customer_labels)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [access.orgId, post_id || null, 'manual', channel, title, ticketBody || null,
       author || null, author_handle || null, follower_count || 0, ticketUrl || null,
       tags || [], priority, assigned_to || null, slaFirstAt,
       verified_handle, booking_details || {}, initialLabels]
    );

    return NextResponse.json({ ticket }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
