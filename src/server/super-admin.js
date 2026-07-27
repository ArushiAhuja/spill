import { query } from './db.js';

// Database flag is the source of truth. The optional env list is a safe bootstrap
// mechanism for the first operator before they can set the flag in production.
export async function isSuperAdmin(user) {
  if (!user?.id) return false;
  const bootstrap = (process.env.SPILL_SUPER_ADMIN_EMAILS || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  if (user.email && bootstrap.includes(user.email.toLowerCase())) return true;
  const { rows } = await query('SELECT is_super_admin FROM users WHERE id=$1', [user.id]);
  return rows[0]?.is_super_admin === true;
}
