import { NextResponse } from 'next/server';
import { query } from '../../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../../server/api-auth.js';
import { ensureMigrations } from '../../../../../../server/migrate.js';

function csvCell(value) {
  const text = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  return `"${text.replace(/"/g, '""')}"`;
}

// GET /api/orgs/[slug]/tickets/export?format=csv|json
// The same scoped endpoint is intentionally suitable for Power BI/Tableau web
// connectors when supplied with a Spill bearer token.
export async function GET(request, { params }) {
  try {
    await ensureMigrations();
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const access = await getOrgAccess(user, params.slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    const format = new URL(request.url).searchParams.get('format') || 'csv';
    if (!['csv', 'json'].includes(format)) return NextResponse.json({ error: 'format must be csv or json' }, { status: 400 });

    const { rows } = await query(
      `SELECT t.id,t.created_at,t.updated_at,t.status,t.priority,t.source,t.channel,t.title,t.body,
              t.author,t.author_handle,t.follower_count,t.url,t.tags,t.lob,t.custom_fields,t.booking_details,
              t.customer_labels,t.awaiting_customer,t.sla_first_response_at,t.first_responded_at,t.sla_subsequent_at,
              t.sla_breached,t.closed_at,COALESCE(u.name,t.assigned_name) AS assigned_agent,u.email AS assigned_agent_email
       FROM tickets t LEFT JOIN users u ON u.id=t.assigned_to
       WHERE t.org_id=$1 ORDER BY t.created_at DESC LIMIT 10000`, [access.orgId]
    );

    if (format === 'json') {
      return NextResponse.json({ generated_at: new Date().toISOString(), organization: params.slug, tickets: rows });
    }
    const headers = ['ticket_id','created_at','updated_at','status','priority','source','channel','title','body','author','author_handle','follower_count','url','tags','lob','custom_fields','booking_details','customer_labels','awaiting_customer','sla_first_response_at','first_responded_at','sla_subsequent_at','sla_breached','closed_at','assigned_agent','assigned_agent_email'];
    const csv = [headers.join(','), ...rows.map(row => headers.map(key => csvCell(row[key])).join(','))].join('\n');
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${params.slug}-spill-tickets.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
