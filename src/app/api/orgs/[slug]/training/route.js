import { NextResponse } from 'next/server';
import { getUser, getOrgAccess } from '../../../../../server/api-auth.js';
import { exportTrainingData } from '../../../../../server/feedback.js';

// GET /api/orgs/[slug]/training/export
// Returns an OpenAI fine-tuning JSONL file built from this org's accumulated feedback.
// Each line = one training example (post content → correct classification).
// Minimum 10 examples required; 50+ recommended for meaningful fine-tuning improvement.
// All post content is anonymized (PII stripped) before export.
export async function GET(request, { params }) {
  try {
    const { slug } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const jsonl = await exportTrainingData(access.orgId);
    const lineCount = jsonl ? jsonl.split('\n').filter(Boolean).length : 0;

    if (lineCount < 10) {
      return NextResponse.json({
        error: 'not enough training data yet',
        examples: lineCount,
        needed: 10,
        tip: 'Every save, dismiss, and explicit feedback submission builds the training dataset. Keep using Spill and check back when you have more activity.',
      }, { status: 422 });
    }

    const filename = `spill-training-${slug}-${new Date().toISOString().slice(0, 10)}.jsonl`;
    return new Response(jsonl, {
      headers: {
        'Content-Type': 'application/jsonl',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Training-Examples': String(lineCount),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
