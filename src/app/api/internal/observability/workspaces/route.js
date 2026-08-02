import { NextResponse } from 'next/server';
import { getUser } from '../../../../../server/api-auth.js';
import { isSuperAdmin } from '../../../../../server/super-admin.js';
import { ensureMigrations } from '../../../../../server/migrate.js';
import { query } from '../../../../../server/db.js';

// Cascade deletes can touch many child rows on large workspaces.
export const maxDuration = 300;

async function requireSuperAdmin(request) {
  await ensureMigrations();
  const user = getUser(request);
  if (!user) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  if (!(await isSuperAdmin(user))) return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  return { user };
}

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

// POST /api/internal/observability/workspaces — create a workspace as Spill super admin.
export async function POST(request) {
  try {
    const auth = await requireSuperAdmin(request);
    if (auth.error) return auth.error;
    const body = await readJsonBody(request);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
    const ownerEmail = typeof body.owner_email === 'string' ? body.owner_email.trim().toLowerCase() : '';
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    const slugRegex = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$|^[a-z0-9]{3}$/;
    if (!slugRegex.test(slug) || slug.length < 3 || slug.length > 50) {
      return NextResponse.json({ error: 'slug must be 3-50 chars, lowercase alphanumeric and hyphens' }, { status: 400 });
    }

    let owner = auth.user;
    if (ownerEmail) {
      const { rows } = await query('SELECT id, email, name FROM users WHERE lower(email)=$1', [ownerEmail]);
      owner = rows[0];
      if (!owner) return NextResponse.json({ error: 'owner must sign up to Spill before a workspace can be assigned' }, { status: 404 });
    }
    if (!owner?.id) {
      return NextResponse.json({ error: 'authenticated owner id is missing from session' }, { status: 400 });
    }

    let organization;
    try {
      const { rows } = await query(
        `INSERT INTO organizations (name, slug, website, description)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [name, slug, typeof body.website === 'string' ? body.website.trim() || null : null, typeof body.description === 'string' ? body.description.trim() || null : null]
      );
      organization = rows[0];
    } catch (err) {
      if (err.code === '23505') return NextResponse.json({ error: 'slug already taken' }, { status: 409 });
      throw err;
    }
    await query('INSERT INTO org_members (user_id, org_id, role) VALUES ($1, $2, $3)', [owner.id, organization.id, 'owner']);
    return NextResponse.json({ organization, owner: { id: owner.id, email: owner.email, name: owner.name } }, { status: 201 });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

function parseDeletePayload(request) {
  const url = new URL(request.url);
  const fromQuery = {
    org_id: url.searchParams.get('org_id') || '',
    confirmation: url.searchParams.get('confirmation') || '',
  };
  return async () => {
    const body = await readJsonBody(request);
    return {
      org_id: (typeof body.org_id === 'string' && body.org_id) || fromQuery.org_id || '',
      confirmation: typeof body.confirmation === 'string' ? body.confirmation : fromQuery.confirmation,
    };
  };
}

// DELETE /api/internal/observability/workspaces — permanently remove a workspace and its data.
// Accepts JSON body and/or query params (query params survive proxies that strip DELETE bodies).
export async function DELETE(request) {
  try {
    const auth = await requireSuperAdmin(request);
    if (auth.error) return auth.error;
    const { org_id, confirmation } = await parseDeletePayload(request)();
    if (!org_id) return NextResponse.json({ error: 'org_id is required' }, { status: 400 });
    const { rows } = await query('SELECT id, name, slug FROM organizations WHERE id=$1', [org_id]);
    const organization = rows[0];
    if (!organization) return NextResponse.json({ error: 'workspace not found' }, { status: 404 });
    const expected = String(organization.name || '').trim();
    const provided = String(confirmation || '').trim();
    if (!provided || provided !== expected) {
      return NextResponse.json({ error: `type the exact workspace name to delete: ${organization.name}` }, { status: 400 });
    }
    await query('DELETE FROM organizations WHERE id=$1', [organization.id]);
    return NextResponse.json({ deleted: { id: organization.id, name: organization.name, slug: organization.slug } });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
