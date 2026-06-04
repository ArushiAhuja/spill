import { NextResponse } from 'next/server';
import { query } from '../../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../../server/api-auth.js';
import { ensureMigrations } from '../../../../../../server/migrate.js';
import { sendEmail } from '../../../../../../server/agentmail.js';

const VALID_STATUSES = new Set(['new', 'open', 'pending', 'woc', 'closed']);

// GET /api/orgs/[slug]/tickets/[id]
export async function GET(request, { params }) {
  try {
    await ensureMigrations();
    const { slug, id } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { rows: [ticket] } = await query(
      `SELECT t.*, u.name as assigned_user_name, u.email as assigned_user_email
       FROM tickets t LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.id = $1 AND t.org_id = $2`,
      [id, access.orgId]
    );
    if (!ticket) return NextResponse.json({ error: 'ticket not found' }, { status: 404 });

    const { rows: notes } = await query(
      `SELECT tn.*, u.name as author_user_name FROM ticket_notes tn
       LEFT JOIN users u ON u.id = tn.author_id
       WHERE tn.ticket_id = $1 ORDER BY tn.created_at ASC`,
      [id]
    );

    return NextResponse.json({ ticket, notes });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH /api/orgs/[slug]/tickets/[id]
export async function PATCH(request, { params }) {
  try {
    await ensureMigrations();
    const { slug, id } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const body = await request.json();
    const { status, priority, assigned_to, assigned_name, tags, forward_to } = body;

    const { rows: [current] } = await query(
      'SELECT * FROM tickets WHERE id = $1 AND org_id = $2',
      [id, access.orgId]
    );
    if (!current) return NextResponse.json({ error: 'ticket not found' }, { status: 404 });

    const sets = [];
    const values = [];
    let idx = 1;

    if (status !== undefined) {
      if (!VALID_STATUSES.has(status)) return NextResponse.json({ error: 'invalid status' }, { status: 400 });
      sets.push(`status = $${idx++}`); values.push(status);
      if (status === 'closed' && current.status !== 'closed') {
        sets.push(`closed_at = NOW()`);
      }
      if (['open', 'pending', 'woc'].includes(status) && !current.first_responded_at) {
        sets.push(`first_responded_at = NOW()`);
      }
    }
    if (priority !== undefined) { sets.push(`priority = $${idx++}`); values.push(priority); }
    if (assigned_to !== undefined) {
      sets.push(`assigned_to = $${idx++}`); values.push(assigned_to);
      if (assigned_name) { sets.push(`assigned_name = $${idx++}`); values.push(assigned_name); }
    }
    if (tags !== undefined) { sets.push(`tags = $${idx++}`); values.push(tags); }
    sets.push(`updated_at = NOW()`);

    const { rows: [ticket] } = await query(
      `UPDATE tickets SET ${sets.join(', ')} WHERE id = $${idx++} AND org_id = $${idx++} RETURNING *`,
      [...values, id, access.orgId]
    );

    // Forward to CD Lead email
    if (forward_to) {
      const { rows: [org] } = await query('SELECT name FROM organizations WHERE id = $1', [access.orgId]);
      await sendEmail({
        to: Array.isArray(forward_to) ? forward_to : [forward_to],
        subject: `[${org?.name || slug}] Ticket Forwarded: ${ticket.title}`,
        html: `<p>A ticket has been forwarded to you for review.</p>
<p><strong>Title:</strong> ${ticket.title}</p>
<p><strong>Status:</strong> ${ticket.status}</p>
<p><strong>Channel:</strong> ${ticket.channel || 'N/A'}</p>
<p><strong>Author:</strong> ${ticket.author || 'Unknown'} ${ticket.author_handle ? `(@${ticket.author_handle})` : ''}</p>
${ticket.body ? `<p><strong>Content:</strong><br>${ticket.body}</p>` : ''}
${ticket.url ? `<p><a href="${ticket.url}">View original post</a></p>` : ''}
<p style="color:#888;font-size:12px">Forwarded by ${user.name || user.email} via Spill</p>`,
        labels: ['ticket-forward'],
      }).catch(e => console.error('[ticket forward email]', e.message));
    }

    return NextResponse.json({ ticket });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
