import nodemailer from 'nodemailer';
import { randomUUID } from 'crypto';

const DRY_RUN = process.env.DRY_RUN === 'true';

function buildSubject(post, category) {
  const tags = [];
  if (post.is_competitor) tags.push('COMPETITOR');
  if (post.is_influencer) tags.push('INFLUENCER ⭐');
  const tagStr = tags.length ? ` [${tags.join('·')}]` : '';
  const categoryName = category?.name ?? 'Uncategorized';
  const truncated = (post.title || '').slice(0, 55) + ((post.title || '').length > 55 ? '…' : '');
  return `[SPILL ALERT]${tagStr} ${categoryName} | Score: ${post.escalation_score} | ${truncated}`;
}

function buildBody(post, category) {
  const tags = [];
  if (post.is_competitor) tags.push(`Competitor: ${post.competitor_name}`);
  if (post.is_influencer) tags.push('High-influence account ⭐');

  return [
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'SPILL SOCIAL WATCH — ESCALATION ALERT',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    `Title    : ${post.title || '(no title)'}`,
    `Source   : ${post.source}`,
    `Author   : ${post.author || 'unknown'}`,
    `Category : ${category?.name ?? 'Uncategorized'}`,
    `Score    : ${post.escalation_score} / 100`,
    `Posted   : ${post.post_created_at ? new Date(post.post_created_at).toISOString() : 'unknown'}`,
    `URL      : ${post.url || ''}`,
    ...(tags.length ? ['', `Tags     : ${tags.join(' · ')}`] : []),
    '',
    '─── AI Reasoning ────────────────────────',
    post.reasoning || '(no reasoning)',
    '',
    ...(post.response_template ? [
      '─── Suggested Response ──────────────────',
      post.response_template,
      '',
      'To refine this response, reply to this email with your feedback.',
      'The AI will generate an improved version (up to 5 iterations).',
      '',
    ] : []),
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'Sent by Spill Social Watch (automated)',
  ].join('\n');
}

let _envTransporter = null;
function getEnvTransporter() {
  if (!_envTransporter) {
    _envTransporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
  }
  return _envTransporter;
}

function makeTransporter(user, pass) {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass },
  });
}

// Returns { messageId } so callers can track reply threads
export async function sendEmail(post, category, config) {
  const emails = config?.emails;
  if (!emails?.length) throw new Error('no recipient emails in config');

  const gmailUser = config?.gmail_user?.trim() || process.env.GMAIL_USER;
  const gmailPass = config?.gmail_app_password?.trim() || process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser) throw new Error('Gmail address not configured — add it to this rule or set GMAIL_USER env var');
  if (!gmailPass) throw new Error('Gmail App Password not configured — add it to this rule or set GMAIL_APP_PASSWORD env var');

  const to = emails.join(', ');
  const subject = buildSubject(post, category);
  const text = buildBody(post, category);
  const messageId = `<spill-${randomUUID()}@getspill>`;

  if (DRY_RUN) {
    console.log(`[emailer] DRY RUN — would send to ${to}`);
    console.log(`  Subject: ${subject}`);
    return { messageId };
  }

  const transporter = (config?.gmail_user?.trim())
    ? makeTransporter(gmailUser, gmailPass)
    : getEnvTransporter();

  await transporter.sendMail({
    from: `"Spill Social Watch" <${gmailUser}>`,
    to,
    subject,
    text,
    messageId,
  });

  console.log(`[emailer] sent to ${to} (messageId: ${messageId})`);
  return { messageId, gmailUser, recipients: emails };
}
