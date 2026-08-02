import { NextResponse } from 'next/server';
import { ensureMigrations } from '../../../../../server/migrate.js';
import { backfillFeedbackLearning } from '../../../../../server/feedback.js';

export const maxDuration = 300;

function isAuthorized(request) {
  const incoming = request.headers.get('x-internal-secret') || '';
  const expected = process.env.CRON_SECRET || '';
  return Boolean(expected) && incoming === expected;
}

// POST /api/internal/feedback/backfill
// Replays historical labelled feedback into reviewed training examples + intel.
export async function POST(request) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    await ensureMigrations();
    const body = await request.json().catch(() => ({}));
    const summary = await backfillFeedbackLearning({
      orgId: body.org_id || null,
      limit: body.limit ? Number(body.limit) : null,
      skipLearned: body.force !== true,
    });
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error('[feedback-backfill]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
