import { NextResponse } from 'next/server';
import { query } from '../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../server/api-auth.js';

// GET /api/orgs/[slug] — get org details
export async function GET(request, { params }) {
  try {
    const { slug } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { rows } = await query(
      'SELECT * FROM organizations WHERE id = $1',
      [access.orgId]
    );
    if (!rows.length) return NextResponse.json({ error: 'org not found' }, { status: 404 });
    return NextResponse.json(rows[0]);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH /api/orgs/[slug] — update org
export async function PATCH(request, { params }) {
  try {
    const { slug } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    if (!['owner', 'admin'].includes(access.orgRole)) {
      return NextResponse.json({ error: 'only owners and admins can update the org' }, { status: 403 });
    }

    const {
      name, website, description, competitors, industry_monitoring, industry_keywords,
      slack_webhook_url, digest_enabled, digest_frequency, digest_recipients,
      digest_gmail_user, digest_gmail_app_password,
      partner_brands, incident_threshold, features,
    } = await request.json();
    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
    if (website !== undefined) { fields.push(`website = $${idx++}`); values.push(website); }
    if (description !== undefined) { fields.push(`description = $${idx++}`); values.push(description); }
    if (competitors !== undefined) { fields.push(`competitors = $${idx++}`); values.push(Array.isArray(competitors) ? competitors : []); }
    if (industry_monitoring !== undefined) { fields.push(`industry_monitoring = $${idx++}`); values.push(!!industry_monitoring); }
    if (industry_keywords !== undefined) {
      const kw = Array.isArray(industry_keywords) ? industry_keywords
        : (typeof industry_keywords === 'string' ? industry_keywords.split(',').map(k => k.trim()).filter(Boolean) : []);
      fields.push(`industry_keywords = $${idx++}`); values.push(kw);
    }
    if (slack_webhook_url !== undefined) { fields.push(`slack_webhook_url = $${idx++}`); values.push(slack_webhook_url || null); }
    if (digest_enabled !== undefined) { fields.push(`digest_enabled = $${idx++}`); values.push(!!digest_enabled); }
    if (digest_frequency !== undefined) { fields.push(`digest_frequency = $${idx++}`); values.push(digest_frequency); }
    if (digest_recipients !== undefined) {
      const recs = Array.isArray(digest_recipients) ? digest_recipients
        : (typeof digest_recipients === 'string' ? digest_recipients.split(/[\s,]+/).map(r => r.trim()).filter(Boolean) : []);
      fields.push(`digest_recipients = $${idx++}`); values.push(recs);
    }
    if (digest_gmail_user !== undefined) { fields.push(`digest_gmail_user = $${idx++}`); values.push(digest_gmail_user || null); }
    if (digest_gmail_app_password !== undefined) { fields.push(`digest_gmail_app_password = $${idx++}`); values.push(digest_gmail_app_password || null); }
    if (partner_brands !== undefined) { fields.push(`partner_brands = $${idx++}`); values.push(Array.isArray(partner_brands) ? partner_brands : []); }
    if (incident_threshold !== undefined) { fields.push(`incident_threshold = $${idx++}`); values.push(parseInt(incident_threshold) || 5); }
    if (features !== undefined) { fields.push(`features = $${idx++}`); values.push(features); }

    if (!fields.length) {
      return NextResponse.json({ error: 'no fields to update' }, { status: 400 });
    }

    fields.push(`updated_at = NOW()`);
    values.push(access.orgId);

    const { rows } = await query(
      `UPDATE organizations SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    return NextResponse.json(rows[0]);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
