/**
 * End-to-end smoke test for Spill production.
 * Tests every major API route and reports pass/fail.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import jwt from 'jsonwebtoken';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(__dirname, '../.env.local');
for (const line of readFileSync(envFile, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
  if (m) process.env[m[1]] = m[2];
}

const BASE = 'https://getspill.vercel.app';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Mint a test token for MakeMyTrip owner
const TOKEN = jwt.sign(
  { id: '9a9c4a62-f859-4b31-a01f-9247ea9b23df', email: 'dk@makemytrip.com', name: 'Deep Kalra' },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);
const SLUG = 'makemytrip';
const ORG_ID = '2669330f-4ec4-4eb2-ab69-e5f42f19188d';

const results = [];
let ticketId, noteId, cannedId, categoryId, escalationId, invitationId, postId, incidentId;

function pass(name, detail = '') { results.push({ ok: true, name, detail }); process.stdout.write(`  ✓ ${name}${detail ? ` — ${detail}` : ''}\n`); }
function fail(name, detail = '') { results.push({ ok: false, name, detail }); process.stdout.write(`  ✗ ${name}${detail ? ` — ${detail}` : ''}\n`); }

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { _raw: text.slice(0, 200) }; }
  return { status: res.status, ok: res.ok, data };
}

console.log('\n🔍 SPILL SMOKE TEST — production (getspill.vercel.app)\n');

// ─── AUTH ────────────────────────────────────────────────────────────────────
console.log('── AUTH & ORG ──');

{
  const r = await api('GET', '/api/orgs');
  r.ok && Array.isArray(r.data)
    ? pass('GET /orgs', `${r.data.length} orgs`)
    : fail('GET /orgs', JSON.stringify(r.data).slice(0, 100));
}

{
  const r = await api('GET', `/api/orgs/${SLUG}`);
  r.ok && r.data.slug === SLUG
    ? pass(`GET /orgs/${SLUG}`, `plan=${r.data.plan}, sla=${r.data.sla_first_response_minutes}m`)
    : fail(`GET /orgs/${SLUG}`, JSON.stringify(r.data).slice(0, 100));
}

// ─── POSTS ───────────────────────────────────────────────────────────────────
console.log('\n── POSTS ──');

{
  const r = await api('GET', `/api/orgs/${SLUG}/posts?limit=5`);
  if (r.ok && r.data.posts?.length) {
    postId = r.data.posts[0].id;
    pass('GET /posts', `${r.data.total} total, sample id=${postId?.slice(0,8)}`);
  } else {
    fail('GET /posts', JSON.stringify(r.data).slice(0, 100));
  }
}

if (postId) {
  const r = await api('PATCH', `/api/orgs/${SLUG}/posts/${postId}`, { post_status: 'read' });
  r.ok ? pass('PATCH /posts/[id] (mark read)') : fail('PATCH /posts/[id] (mark read)', JSON.stringify(r.data).slice(0, 100));
}

if (postId) {
  const r = await api('PATCH', `/api/orgs/${SLUG}/posts/${postId}`, { notes: 'smoke test note' });
  r.ok ? pass('PATCH /posts/[id] (add note)') : fail('PATCH /posts/[id] (add note)', JSON.stringify(r.data).slice(0, 100));
}

if (postId) {
  const r = await api('PATCH', `/api/orgs/${SLUG}/posts/${postId}`, { manually_escalated: true });
  r.ok ? pass('PATCH /posts/[id] (manual escalate)') : fail('PATCH /posts/[id] (manual escalate)', JSON.stringify(r.data).slice(0, 100));
  // clean up
  await api('PATCH', `/api/orgs/${SLUG}/posts/${postId}`, { manually_escalated: false });
}

if (postId) {
  const r = await api('PATCH', `/api/orgs/${SLUG}/posts/${postId}`, { post_status: 'archived' });
  r.ok ? pass('PATCH /posts/[id] (archive)') : fail('PATCH /posts/[id] (archive)', JSON.stringify(r.data).slice(0, 100));
  await api('PATCH', `/api/orgs/${SLUG}/posts/${postId}`, { post_status: 'unread' });
}

if (postId) {
  const snoozeUntil = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const r = await api('PATCH', `/api/orgs/${SLUG}/posts/${postId}`, { snoozed_until: snoozeUntil });
  r.ok ? pass('PATCH /posts/[id] (snooze)') : fail('PATCH /posts/[id] (snooze)', JSON.stringify(r.data).slice(0, 100));
  await api('PATCH', `/api/orgs/${SLUG}/posts/${postId}`, { snoozed_until: null });
}

// Post search
{
  const r = await api('GET', `/api/orgs/${SLUG}/posts?search=trip&limit=3`);
  r.ok ? pass('GET /posts?search=', `${r.data.total} matches`) : fail('GET /posts?search=', JSON.stringify(r.data).slice(0, 100));
}

// Post feedback
if (postId) {
  const r = await api('POST', `/api/orgs/${SLUG}/posts/${postId}/feedback`, {
    field: 'relevance', old_value: 'unknown', new_value: 'relevant',
    label: 'useful', explanation: 'smoke test feedback',
  });
  r.ok || r.status === 201
    ? pass('POST /posts/[id]/feedback')
    : fail('POST /posts/[id]/feedback', JSON.stringify(r.data).slice(0, 100));
}

// ─── CATEGORIES ──────────────────────────────────────────────────────────────
console.log('\n── CATEGORIES ──');

{
  const r = await api('GET', `/api/orgs/${SLUG}/categories`);
  // returns raw array
  if (r.ok && Array.isArray(r.data) && r.data.length) {
    categoryId = r.data[0].id;
    pass('GET /categories', `${r.data.length} categories, sample: ${r.data[0].name}`);
  } else if (r.ok && Array.isArray(r.data)) {
    pass('GET /categories', '0 categories');
  } else {
    fail('GET /categories', JSON.stringify(r.data).slice(0, 100));
  }
}

{
  const r = await api('POST', `/api/orgs/${SLUG}/categories`, {
    name: '_smoke_test_cat', description: 'auto-created by smoke test', severity: 5, color: '#f87171',
  });
  if (r.ok || r.status === 201) {
    const newCat = r.data; // returns raw row
    pass('POST /categories (create)', `id=${newCat?.id?.slice(0,8)}`);
    // Update it
    const upd = await api('PATCH', `/api/orgs/${SLUG}/categories/${newCat.id}`, { name: '_smoke_test_cat_updated', severity: 8 });
    upd.ok ? pass('PATCH /categories/[id] (update)') : fail('PATCH /categories/[id] (update)', JSON.stringify(upd.data).slice(0,80));
    // Delete it
    const del = await api('DELETE', `/api/orgs/${SLUG}/categories/${newCat.id}`);
    del.ok ? pass('DELETE /categories/[id]') : fail('DELETE /categories/[id]', JSON.stringify(del.data).slice(0,80));
  } else {
    fail('POST /categories (create)', JSON.stringify(r.data).slice(0, 100));
  }
}

// ─── ESCALATIONS ─────────────────────────────────────────────────────────────
console.log('\n── ESCALATIONS ──');

{
  const r = await api('GET', `/api/orgs/${SLUG}/escalations`);
  // returns raw array
  if (r.ok && Array.isArray(r.data)) {
    escalationId = r.data[0]?.id;
    pass('GET /escalations', `${r.data.length} rules`);
  } else {
    fail('GET /escalations', JSON.stringify(r.data).slice(0, 100));
  }
}

{
  const r = await api('POST', `/api/orgs/${SLUG}/escalations`, {
    name: '_smoke_test_rule', threshold: 70, action_type: 'email',
    config: { emails: ['test@example.com'] }, category_ids: categoryId ? [categoryId] : [],
  });
  if (r.ok || r.status === 201) {
    const rule = r.data; // returns raw row
    pass('POST /escalations (create)', `id=${rule?.id?.slice(0,8)}`);
    // Update
    const upd = await api('PATCH', `/api/orgs/${SLUG}/escalations/${rule.id}`, { threshold: 80, enabled: true });
    upd.ok ? pass('PATCH /escalations/[id] (update)') : fail('PATCH /escalations/[id] (update)', JSON.stringify(upd.data).slice(0,80));
    // Test fire
    const tst = await api('POST', `/api/orgs/${SLUG}/escalations/${rule.id}/test`);
    tst.ok || tst.status === 200
      ? pass('POST /escalations/[id]/test (fire test alert)', tst.data?.warning || 'sent')
      : fail('POST /escalations/[id]/test', JSON.stringify(tst.data).slice(0,100));
    // Delete
    const del = await api('DELETE', `/api/orgs/${SLUG}/escalations/${rule.id}`);
    del.ok ? pass('DELETE /escalations/[id]') : fail('DELETE /escalations/[id]', JSON.stringify(del.data).slice(0,80));
  } else {
    fail('POST /escalations (create)', JSON.stringify(r.data).slice(0, 100));
  }
}

// ─── INCIDENTS ───────────────────────────────────────────────────────────────
console.log('\n── INCIDENTS ──');

{
  const r = await api('GET', `/api/orgs/${SLUG}/incidents?status=open`);
  // returns raw array
  if (r.ok && Array.isArray(r.data)) {
    incidentId = r.data[0]?.id;
    pass('GET /incidents', `${r.data.length} open`);
  } else {
    fail('GET /incidents', JSON.stringify(r.data).slice(0, 100));
  }
}

if (incidentId) {
  const r = await api('PATCH', `/api/orgs/${SLUG}/incidents/${incidentId}`, { status: 'resolved' });
  r.ok ? pass('PATCH /incidents/[id] (resolve)') : fail('PATCH /incidents/[id] (resolve)', JSON.stringify(r.data).slice(0,80));
  // Reopen
  await api('PATCH', `/api/orgs/${SLUG}/incidents/${incidentId}`, { status: 'open' });
}

// ─── ANALYTICS ───────────────────────────────────────────────────────────────
console.log('\n── ANALYTICS ──');

{
  const r = await api('GET', `/api/orgs/${SLUG}/stats?days=7`);
  // returns array of category stat objects
  if (r.ok && Array.isArray(r.data)) {
    pass('GET /stats?days=7', `${r.data.length} category buckets`);
  } else {
    fail('GET /stats', JSON.stringify(r.data).slice(0, 100));
  }
}

{
  const r = await api('GET', `/api/orgs/${SLUG}/status`);
  r.ok
    ? pass('GET /status', `posts=${r.data.post_count}, sources=${r.data.source_count}`)
    : fail('GET /status', JSON.stringify(r.data).slice(0, 100));
}

// ─── TICKETS ─────────────────────────────────────────────────────────────────
console.log('\n── TICKETS ──');

{
  const r = await api('GET', `/api/orgs/${SLUG}/tickets?status=new`);
  if (r.ok) {
    ticketId = r.data.tickets?.[0]?.id;
    pass('GET /tickets', `total=${r.data.total}, new=${r.data.statusCounts?.new || 0}`);
  } else {
    fail('GET /tickets', JSON.stringify(r.data).slice(0, 100));
  }
}

{
  const r = await api('POST', `/api/orgs/${SLUG}/tickets`, {
    title: 'Smoke test: booking page crashes on iOS',
    channel: 'twitter', priority: 'high',
    author: 'Test User', author_handle: 'testuser99',
    follower_count: 15000,
    body: 'Every time I try to book a flight on the MakeMyTrip app, it crashes at the payment step. Very frustrating!',
    url: 'https://twitter.com/testuser99/status/123456789',
    tags: ['app-crash', 'ios'],
  });
  if (r.ok || r.status === 201) {
    ticketId = r.data.ticket.id;
    pass('POST /tickets (create)', `id=${ticketId?.slice(0,8)}, sla_at=${new Date(r.data.ticket.sla_first_response_at).toISOString().slice(11,19)}`);
  } else {
    fail('POST /tickets (create)', JSON.stringify(r.data).slice(0, 100));
  }
}

if (ticketId) {
  const r = await api('GET', `/api/orgs/${SLUG}/tickets/${ticketId}`);
  r.ok && r.data.ticket
    ? pass('GET /tickets/[id]', `status=${r.data.ticket.status}`)
    : fail('GET /tickets/[id]', JSON.stringify(r.data).slice(0, 100));
}

if (ticketId) {
  const r = await api('PATCH', `/api/orgs/${SLUG}/tickets/${ticketId}`, { status: 'open', priority: 'urgent' });
  r.ok ? pass('PATCH /tickets/[id] (open + urgent)') : fail('PATCH /tickets/[id]', JSON.stringify(r.data).slice(0, 100));
}

if (ticketId) {
  const r = await api('POST', `/api/orgs/${SLUG}/tickets/${ticketId}/notes`, {
    body: 'Reached out to the iOS team. Investigating the payment crash at step 3.',
    is_internal: true,
  });
  if (r.ok || r.status === 201) {
    noteId = r.data.note?.id;
    pass('POST /tickets/[id]/notes (internal)', `id=${noteId?.slice(0,8)}`);
  } else {
    fail('POST /tickets/[id]/notes', JSON.stringify(r.data).slice(0, 100));
  }
}

if (ticketId) {
  const r = await api('POST', `/api/orgs/${SLUG}/tickets/${ticketId}/notes`, {
    body: "Hi! We're aware of this issue and our team is on it. Expect a fix within 24hrs.",
    is_internal: false,
  });
  r.ok || r.status === 201
    ? pass('POST /tickets/[id]/notes (reply)')
    : fail('POST /tickets/[id]/notes (reply)', JSON.stringify(r.data).slice(0, 100));
}

if (ticketId) {
  const r = await api('POST', `/api/orgs/${SLUG}/tickets/${ticketId}/ai-response`, {
    personality: 'professional', iterations: 2,
  });
  if (r.ok && r.data.responses?.length) {
    pass('POST /tickets/[id]/ai-response', `${r.data.responses.length} options: "${r.data.responses[0].slice(0,60)}..."`);
  } else {
    fail('POST /tickets/[id]/ai-response', JSON.stringify(r.data).slice(0, 100));
  }
}

if (ticketId) {
  const r = await api('POST', `/api/orgs/${SLUG}/tickets/${ticketId}/ai-response`, { personality: 'apologetic', iterations: 2 });
  r.ok && r.data.responses?.length
    ? pass('POST /ai-response (apologetic personality)')
    : fail('POST /ai-response (apologetic)', JSON.stringify(r.data).slice(0, 100));
}

// Bulk actions
{
  // Create a second ticket for bulk test
  const r2 = await api('POST', `/api/orgs/${SLUG}/tickets`, {
    title: 'Bulk test ticket', channel: 'manual', priority: 'normal', author: 'Bulk Test',
  });
  const bulkId2 = r2.data?.ticket?.id;
  if (ticketId && bulkId2) {
    const r = await api('POST', `/api/orgs/${SLUG}/tickets/bulk`, {
      ids: [ticketId, bulkId2], action: 'tag', value: 'smoke-test',
    });
    r.ok ? pass('POST /tickets/bulk (add tag)', `updated=${r.data.updated}`) : fail('POST /tickets/bulk', JSON.stringify(r.data).slice(0,100));
    // Bulk close
    const r3 = await api('POST', `/api/orgs/${SLUG}/tickets/bulk`, {
      ids: [ticketId, bulkId2], action: 'status', value: 'closed',
    });
    r3.ok ? pass('POST /tickets/bulk (close)') : fail('POST /tickets/bulk (close)', JSON.stringify(r3.data).slice(0,100));
  }
}

// ─── CANNED RESPONSES ────────────────────────────────────────────────────────
console.log('\n── CANNED RESPONSES ──');

{
  const r = await api('GET', `/api/orgs/${SLUG}/canned-responses`);
  r.ok
    ? pass('GET /canned-responses', `${r.data.cannedResponses?.length || 0} responses`)
    : fail('GET /canned-responses', JSON.stringify(r.data).slice(0, 100));
}

{
  const r = await api('POST', `/api/orgs/${SLUG}/canned-responses`, {
    name: 'Smoke test — apology', brand_personality: 'apologetic',
    category: 'app-issues',
    body: 'We sincerely apologize for the inconvenience. Our team is actively working on a fix.',
  });
  if (r.ok || r.status === 201) {
    cannedId = r.data.cannedResponse?.id;
    pass('POST /canned-responses (create)', `id=${cannedId?.slice(0,8)}`);
    const upd = await api('PATCH', `/api/orgs/${SLUG}/canned-responses/${cannedId}`, { name: 'Smoke test — apology v2' });
    upd.ok ? pass('PATCH /canned-responses/[id] (update)') : fail('PATCH /canned-responses/[id]', JSON.stringify(upd.data).slice(0,80));
    const del = await api('DELETE', `/api/orgs/${SLUG}/canned-responses/${cannedId}`);
    del.ok ? pass('DELETE /canned-responses/[id]') : fail('DELETE /canned-responses/[id]', JSON.stringify(del.data).slice(0,80));
  } else {
    fail('POST /canned-responses', JSON.stringify(r.data).slice(0, 100));
  }
}

// ─── SETTINGS / ORG UPDATE ───────────────────────────────────────────────────
console.log('\n── SETTINGS ──');

{
  const r = await api('PATCH', `/api/orgs/${SLUG}`, {
    incident_threshold: 5,
    digest_enabled: false,
  });
  r.ok ? pass('PATCH /orgs/[slug] (settings update)') : fail('PATCH /orgs/[slug]', JSON.stringify(r.data).slice(0, 100));
}

{
  const r = await api('GET', `/api/orgs/${SLUG}/sources`);
  // returns raw array
  if (r.ok && Array.isArray(r.data)) {
    pass('GET /sources', `${r.data.length} sources`);
  } else {
    fail('GET /sources', JSON.stringify(r.data).slice(0, 100));
  }
}

{
  const r = await api('POST', `/api/orgs/${SLUG}/digest/test`);
  r.ok || r.status === 200
    ? pass('POST /digest/test', r.data?.warning || 'sent')
    : fail('POST /digest/test', JSON.stringify(r.data).slice(0, 100));
}

// ─── INVITATIONS ─────────────────────────────────────────────────────────────
console.log('\n── INVITATIONS ──');

{
  const r = await api('GET', `/api/orgs/${SLUG}/invitations`);
  r.ok
    ? pass('GET /invitations', `${r.data.invitations?.length || 0} pending`)
    : fail('GET /invitations', JSON.stringify(r.data).slice(0, 100));
}

{
  const r = await api('POST', `/api/orgs/${SLUG}/invitations`, {
    email: 'smoketest_invite@example.com', role: 'member',
  });
  if (r.ok || r.status === 201) {
    invitationId = r.data.invitation?.id;
    pass('POST /invitations (send invite)', r.data.warning || 'email sent');
    // Resend
    const rs = await api('POST', `/api/orgs/${SLUG}/invitations/${invitationId}/resend`);
    rs.ok ? pass('POST /invitations/[id]/resend') : fail('POST /invitations/[id]/resend', JSON.stringify(rs.data).slice(0,80));
    // Revoke
    const rv = await api('DELETE', `/api/orgs/${SLUG}/invitations/${invitationId}`);
    rv.ok ? pass('DELETE /invitations/[id] (revoke)') : fail('DELETE /invitations/[id]', JSON.stringify(rv.data).slice(0,80));
  } else {
    fail('POST /invitations', JSON.stringify(r.data).slice(0, 100));
  }
}

// ─── ACTIVITY LOG ────────────────────────────────────────────────────────────
console.log('\n── MISC ──');

{
  const r = await api('GET', `/api/orgs/${SLUG}/activity`);
  r.ok
    ? pass('GET /activity', `${r.data.activity?.length || 0} events`)
    : fail('GET /activity', JSON.stringify(r.data).slice(0, 100));
}

{
  const r = await api('GET', `/api/orgs/${SLUG}/feedback`);
  r.ok
    ? pass('GET /feedback', `${r.data.items?.length || r.data.feedback?.length || 0} items`)
    : fail('GET /feedback', JSON.stringify(r.data).slice(0, 100));
}

// Refresh trigger
{
  const r = await api('POST', `/api/orgs/${SLUG}/refresh`);
  r.ok ? pass('POST /refresh (trigger cycle)') : fail('POST /refresh', JSON.stringify(r.data).slice(0, 100));
}

// ─── SUMMARY ─────────────────────────────────────────────────────────────────
await pool.end();

const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok);
console.log(`\n${'─'.repeat(50)}`);
console.log(`RESULT: ${passed}/${results.length} passed`);
if (failed.length) {
  console.log(`\nFAILED:`);
  for (const f of failed) console.log(`  ✗ ${f.name}: ${f.detail}`);
}
console.log('');
