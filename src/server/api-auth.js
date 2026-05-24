import jwt from 'jsonwebtoken';
import { query } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'spill_dev_secret_change_in_prod';

export function getUser(request) {
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(auth.slice(7), JWT_SECRET);
  } catch {
    return null;
  }
}

export async function getOrgAccess(user, slug) {
  if (!user) return null;
  const { rows } = await query(
    `SELECT om.role, o.id as org_id FROM org_members om
     JOIN organizations o ON o.id = om.org_id
     WHERE om.user_id = $1 AND o.slug = $2`,
    [user.id, slug]
  );
  if (!rows.length) return null;
  return { orgId: rows[0].org_id, orgRole: rows[0].role };
}
