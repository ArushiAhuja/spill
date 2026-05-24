import jwt from 'jsonwebtoken';
import { query } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'spill_dev_secret_change_in_prod';

export function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'invalid token' });
  }
}

export async function requireOrgAccess(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT om.role, o.id as org_id FROM org_members om
       JOIN organizations o ON o.id = om.org_id
       WHERE om.user_id = $1 AND o.slug = $2`,
      [req.user.id, req.params.org]
    );
    if (!rows.length) return res.status(403).json({ error: 'forbidden' });
    req.orgRole = rows[0].role;
    req.orgId = rows[0].org_id;
    next();
  } catch (err) {
    next(err);
  }
}
