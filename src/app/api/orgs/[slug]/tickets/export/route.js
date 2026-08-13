import { NextResponse } from 'next/server';
import { query } from '../../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../../server/api-auth.js';
import { ensureMigrations } from '../../../../../../server/migrate.js';

function csvCell(value) {
  const text = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function flattenTicket(row) {
  const fields = row.custom_fields && typeof row.custom_fields === 'object' ? row.custom_fields : {};
  return {
    ticket_id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    status: row.status,
    priority: row.priority,
    source: row.source,
    channel: row.channel,
    title: row.title,
    body: row.body,
    author: row.author,
    author_handle: row.author_handle,
    follower_count: row.follower_count,
    url: row.url,
    tags: Array.isArray(row.tags) ? row.tags.join('|') : row.tags,
    lob: row.lob,
    booking_id: fields.booking_id || '',
    contact_email: fields.contact_email || '',
    contact_phone: fields.contact_phone || '',
    use_case: fields.use_case || '',
    custom_fields: row.custom_fields,
    booking_details: row.booking_details,
    customer_labels: Array.isArray(row.customer_labels) ? row.customer_labels.join('|') : row.customer_labels,
    awaiting_customer: row.awaiting_customer,
    sla_first_response_at: row.sla_first_response_at,
    first_responded_at: row.first_responded_at,
    sla_subsequent_at: row.sla_subsequent_at,
    sla_breached: row.sla_breached,
    closed_at: row.closed_at,
    assigned_agent: row.assigned_agent,
    assigned_agent_email: row.assigned_agent_email,
  };
}

// GET /api/orgs/[slug]/tickets/export?format=csv|json|xlsx
// Suitable for Excel download and Power BI / Tableau web connectors with a bearer token.
export async function GET(request, { params }) {
  try {
    await ensureMigrations();
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const access = await getOrgAccess(user, params.slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    const format = new URL(request.url).searchParams.get('format') || 'csv';
    if (!['csv', 'json', 'xlsx'].includes(format)) {
      return NextResponse.json({ error: 'format must be csv, xlsx, or json' }, { status: 400 });
    }

    const { rows } = await query(
      `SELECT t.id,t.created_at,t.updated_at,t.status,t.priority,t.source,t.channel,t.title,t.body,
              t.author,t.author_handle,t.follower_count,t.url,t.tags,t.lob,t.custom_fields,t.booking_details,
              t.customer_labels,t.awaiting_customer,t.sla_first_response_at,t.first_responded_at,t.sla_subsequent_at,
              t.sla_breached,t.closed_at,COALESCE(u.name,t.assigned_name) AS assigned_agent,u.email AS assigned_agent_email
       FROM tickets t LEFT JOIN users u ON u.id=t.assigned_to
       WHERE t.org_id=$1 ORDER BY t.created_at DESC LIMIT 10000`, [access.orgId]
    );
    const flat = rows.map(flattenTicket);

    if (format === 'json') {
      return NextResponse.json({
        generated_at: new Date().toISOString(),
        organization: params.slug,
        bi: {
          power_bi: 'Get Data → Web → paste this URL with format=json and Authorization: Bearer <token>',
          tableau: 'Web Data Connector or REST with the same bearer token',
          fields: Object.keys(flat[0] || {}),
        },
        tickets: flat,
      });
    }

    const headers = [
      'ticket_id','created_at','updated_at','status','priority','source','channel','title','body','author',
      'author_handle','follower_count','url','tags','lob','booking_id','contact_email','contact_phone','use_case',
      'custom_fields','booking_details','customer_labels','awaiting_customer','sla_first_response_at',
      'first_responded_at','sla_subsequent_at','sla_breached','closed_at','assigned_agent','assigned_agent_email',
    ];
    const csv = [headers.join(','), ...flat.map(row => headers.map(key => csvCell(row[key])).join(','))].join('\n');
    const excelFriendly = format === 'xlsx';
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${params.slug}-spill-tickets.csv"`,
        'Cache-Control': 'no-store',
        'X-Spill-BI': 'Use ?format=json with Authorization Bearer token for Power BI / Tableau',
        'X-Spill-Format-Alias': excelFriendly ? 'xlsx-as-csv' : format,
      },
    });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
