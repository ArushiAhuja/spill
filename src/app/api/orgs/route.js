import { NextResponse } from 'next/server';
import { query } from '../../../server/db.js';
import { getUser } from '../../../server/api-auth.js';

let _migrated = false;
async function ensureColumns() {
  if (_migrated) return;
  await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS industry_monitoring BOOLEAN DEFAULT false`);
  await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS industry_keywords TEXT[] DEFAULT '{}'`);
  _migrated = true;
}

// GET /api/orgs — list user's orgs
export async function GET(request) {
  try {
    await ensureColumns();
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { rows } = await query(
      `SELECT o.*, COUNT(om2.id) as member_count
       FROM organizations o
       JOIN org_members om ON om.org_id = o.id AND om.user_id = $1
       LEFT JOIN org_members om2 ON om2.org_id = o.id
       GROUP BY o.id ORDER BY o.created_at DESC`,
      [user.id]
    );
    return NextResponse.json(rows);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/orgs — create org
export async function POST(request) {
  try {
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    await ensureColumns();
    const { name, slug, website, description, competitors, industry_monitoring, industry_keywords } = await request.json();

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (!slug || typeof slug !== 'string') {
      return NextResponse.json({ error: 'slug is required' }, { status: 400 });
    }
    const slugRegex = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$|^[a-z0-9]{3}$/;
    if (!slugRegex.test(slug) || slug.length < 3 || slug.length > 50) {
      return NextResponse.json({ error: 'slug must be 3-50 chars, lowercase alphanumeric and hyphens' }, { status: 400 });
    }

    const competitorsList = Array.isArray(competitors) ? competitors : [];

    let org;
    try {
      const kwList = Array.isArray(industry_keywords)
        ? industry_keywords
        : (typeof industry_keywords === 'string' ? industry_keywords.split(',').map(k => k.trim()).filter(Boolean) : []);
      const { rows } = await query(
        `INSERT INTO organizations (name, slug, website, description, competitors, industry_monitoring, industry_keywords)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [name.trim(), slug, website || null, description || null, competitorsList, !!industry_monitoring, kwList]
      );
      org = rows[0];
    } catch (err) {
      if (err.code === '23505') {
        return NextResponse.json({ error: 'slug already taken' }, { status: 409 });
      }
      throw err;
    }

    // Insert owner membership
    await query(
      'INSERT INTO org_members (user_id, org_id, role) VALUES ($1, $2, $3)',
      [user.id, org.id, 'owner']
    );

    return NextResponse.json(org, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
