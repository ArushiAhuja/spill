import { NextResponse } from 'next/server';
import { query } from '../../../../../../../server/db.js';
import { getUser, getOrgAccess } from '../../../../../../../server/api-auth.js';
import { sendEmail } from '../../../../../../../server/actions/emailer.js';
import { sendSlack } from '../../../../../../../server/actions/slack.js';

const TEST_POST = {
  id: 'test-0',
  source: 'reddit',
  title: '[test alert] this is a simulated escalation from spill',
  url: null,
  author: 'test-user',
  escalation_score: 85,
  reasoning: 'this is a test alert triggered manually from the spill dashboard.',
  response_template: null,
  is_competitor: false,
  competitor_name: null,
  is_influencer: false,
  post_created_at: new Date().toISOString(),
};

// POST /api/orgs/[slug]/escalations/[id]/test
export async function POST(request, { params }) {
  try {
    const { slug, id } = params;
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const access = await getOrgAccess(user, slug);
    if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { rows } = await query(
      'SELECT * FROM escalation_rules WHERE id = $1 AND org_id = $2',
      [id, access.orgId]
    );
    if (!rows.length) return NextResponse.json({ error: 'rule not found' }, { status: 404 });

    const rule = rows[0];

    if (rule.action_type === 'email') {
      const emailRecipients = rule.config.emails?.length
        ? rule.config.emails
        : rule.config.to?.trim().split(/[\s,]+/).filter(Boolean);
      if (!emailRecipients?.length) {
        return NextResponse.json({ error: 'no email recipients configured' }, { status: 400 });
      }
      await sendEmail(TEST_POST, { name: 'test category' }, { ...rule.config, emails: emailRecipients });

    } else if (rule.action_type === 'slack') {
      const webhookUrl = rule.config.webhook_url || rule.config.slack_webhook_url;
      if (!webhookUrl) {
        return NextResponse.json({ error: 'no Slack webhook URL configured' }, { status: 400 });
      }
      await sendSlack(TEST_POST, { name: 'test category' }, rule.config);

    } else if (rule.action_type === 'webhook') {
      if (!rule.config.url) {
        return NextResponse.json({ error: 'no webhook URL configured' }, { status: 400 });
      }
      const res = await fetch(rule.config.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: TEST_POST.source,
          title: TEST_POST.title,
          url: TEST_POST.url,
          score: TEST_POST.escalation_score,
          category: 'test category',
          reasoning: TEST_POST.reasoning,
          is_competitor: false,
          competitor_name: null,
          is_influencer: false,
          test: true,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return NextResponse.json({ error: `webhook returned ${res.status}: ${text.slice(0, 200)}` }, { status: 400 });
      }

    } else if (rule.action_type === 'sheets') {
      return NextResponse.json({ error: 'sheets test not supported — check your sheet manually' }, { status: 400 });
    }

    return NextResponse.json({ ok: true, action_type: rule.action_type });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
