import nodemailer from 'nodemailer';
import { randomUUID } from 'crypto';

const DRY_RUN = process.env.DRY_RUN === 'true';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://getspill.vercel.app';

function buildSubject(post, category) {
  const categoryName = category?.name ?? 'uncategorized';
  const title = (post.title || '').slice(0, 60) + ((post.title || '').length > 60 ? '…' : '');
  const tags = [];
  if (post.is_competitor) tags.push('competitor');
  if (post.is_influencer) tags.push('influencer');
  const tagSuffix = tags.length ? ` · ${tags.join(' · ')}` : '';
  return `⚡ ${categoryName}${tagSuffix} — ${title}`;
}

function buildHtml(post, category) {
  const categoryName = category?.name ?? 'uncategorized';
  const source = post.source ?? 'unknown';
  const score = post.escalation_score ?? 0;
  const title = post.title || '(no title)';
  const author = post.author || 'unknown';
  const reasoning = post.reasoning || null;
  const postUrl = post.url || null;
  const responseTemplate = post.response_template || null;
  const dashUrl = `${APP_URL}`;

  const tags = [];
  if (post.is_competitor) tags.push(`<span style="background:#1e3a5f;color:#60a5fa;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:500;letter-spacing:0.05em;">competitor</span>`);
  if (post.is_influencer) tags.push(`<span style="background:#1a3a2a;color:#4ade80;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:500;letter-spacing:0.05em;">influencer</span>`);
  const tagRow = tags.length ? `<div style="margin-bottom:16px;display:flex;gap:6px;">${tags.join(' ')}</div>` : '';

  const scoreColor = score >= 70 ? '#f87171' : score >= 40 ? '#f59e0b' : '#64748b';

  const reasoningBlock = reasoning ? `
    <div style="background:#f8fafc;border-left:3px solid #e2e8f0;border-radius:0 6px 6px 0;padding:14px 16px;margin:20px 0;">
      <p style="margin:0 0 4px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.1em;font-family:'Courier New',monospace;">why spill flagged this</p>
      <p style="margin:0;font-size:13px;color:#475569;line-height:1.6;">${reasoning}</p>
    </div>
  ` : '';

  const responseBlock = responseTemplate ? `
    <div style="background:#f0fdf4;border-left:3px solid #86efac;border-radius:0 6px 6px 0;padding:14px 16px;margin:16px 0;">
      <p style="margin:0 0 4px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.1em;font-family:'Courier New',monospace;">suggested response</p>
      <p style="margin:0;font-size:13px;color:#166534;line-height:1.6;">${responseTemplate}</p>
      <p style="margin:8px 0 0;font-size:11px;color:#86efac;">reply to this email to refine →</p>
    </div>
  ` : '';

  const viewOriginal = postUrl ? `
    <a href="${postUrl}" style="display:inline-block;color:#64748b;text-decoration:none;font-size:13px;border:1px solid #e2e8f0;padding:10px 20px;border-radius:8px;">
      view on ${source} &rarr;
    </a>
  ` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>spill alert</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 16px;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">

  <!-- header -->
  <tr>
    <td style="background:#0d0f1a;padding:24px 36px;border-radius:12px 12px 0 0;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <span style="font-size:11px;letter-spacing:0.25em;color:#475569;text-transform:lowercase;font-family:'Courier New',monospace;">spill</span>
          </td>
          <td align="right">
            <span style="font-size:11px;color:#f87171;letter-spacing:0.08em;font-family:'Courier New',monospace;">⚡ escalation</span>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- body -->
  <tr>
    <td style="background:#ffffff;padding:32px 36px;">

      <!-- category + source metadata -->
      <p style="margin:0 0 10px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.12em;font-family:'Courier New',monospace;">
        ${categoryName} &middot; ${source}
      </p>

      <!-- title -->
      <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#0f172a;letter-spacing:-0.02em;line-height:1.3;">
        ${title}
      </h1>

      <!-- tag badges -->
      ${tagRow}

      <!-- meta row -->
      <table cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
        <tr>
          <td style="padding-right:20px;">
            <span style="font-size:11px;color:#94a3b8;">score</span><br/>
            <span style="font-size:16px;font-weight:600;color:${scoreColor};">${score}<span style="font-size:11px;font-weight:400;color:#cbd5e1;">/100</span></span>
          </td>
          <td style="padding-right:20px;">
            <span style="font-size:11px;color:#94a3b8;">author</span><br/>
            <span style="font-size:13px;color:#475569;">${author}</span>
          </td>
        </tr>
      </table>

      <!-- divider -->
      <div style="height:1px;background:#f1f5f9;margin:0 0 20px;"></div>

      <!-- reasoning -->
      ${reasoningBlock}

      <!-- suggested response -->
      ${responseBlock}

      <!-- CTAs -->
      <div style="margin-top:24px;">
        <a href="${dashUrl}"
           style="display:inline-block;background:#0d0f1a;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:13px;font-weight:500;letter-spacing:0.01em;margin-right:10px;">
          open spill &rarr;
        </a>
        ${viewOriginal}
      </div>

    </td>
  </tr>

  <!-- footer -->
  <tr>
    <td style="background:#f8fafc;padding:18px 36px;border-radius:0 0 12px 12px;border-top:1px solid #e2e8f0;">
      <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.7;">
        sent by <strong style="color:#64748b;">spill</strong> because this post matched your escalation rules.<br/>
        ${postUrl ? `<a href="${postUrl}" style="color:#94a3b8;">${postUrl.slice(0, 80)}${postUrl.length > 80 ? '…' : ''}</a>` : ''}
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function buildText(post, category) {
  const categoryName = category?.name ?? 'uncategorized';
  const lines = [
    `⚡ escalation alert — ${categoryName}`,
    ``,
    post.title || '(no title)',
    ``,
    `source   ${post.source ?? 'unknown'}`,
    `author   ${post.author || 'unknown'}`,
    `score    ${post.escalation_score ?? 0}/100`,
  ];
  if (post.is_competitor) lines.push(`competitor  ${post.competitor_name || 'yes'}`);
  if (post.is_influencer) lines.push(`influencer  yes`);
  if (post.reasoning) {
    lines.push(``, `why spill flagged this:`, post.reasoning);
  }
  if (post.response_template) {
    lines.push(``, `suggested response:`, post.response_template, ``, `reply to this email to refine.`);
  }
  if (post.url) lines.push(``, `→ ${post.url}`);
  lines.push(``, `open spill → ${APP_URL}`, ``, `—`, `spill`);
  return lines.join('\n');
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

// Returns { messageId, gmailUser, recipients } so callers can track reply threads
export async function sendEmail(post, category, config) {
  const emails = config?.emails;
  if (!emails?.length) throw new Error('no recipient emails in config');

  const gmailUser = config?.gmail_user?.trim() || process.env.GMAIL_USER;
  const gmailPass = config?.gmail_app_password?.trim() || process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser) throw new Error('Gmail address not configured — add it to this rule or set GMAIL_USER env var');
  if (!gmailPass) throw new Error('Gmail App Password not configured — add it to this rule or set GMAIL_APP_PASSWORD env var');

  const to = emails.join(', ');
  const subject = buildSubject(post, category);
  const html = buildHtml(post, category);
  const text = buildText(post, category);
  const messageId = `<spill-${randomUUID()}@getspill>`;

  if (DRY_RUN) {
    console.log(`[emailer] DRY RUN — would send to ${to}`);
    console.log(`  Subject: ${subject}`);
    return { messageId };
  }

  const transporter = config?.gmail_user?.trim()
    ? makeTransporter(gmailUser, gmailPass)
    : getEnvTransporter();

  await transporter.sendMail({
    from: `"spill" <${gmailUser}>`,
    to,
    subject,
    html,
    text,
    messageId,
  });

  console.log(`[emailer] sent to ${to} (messageId: ${messageId})`);
  return { messageId, gmailUser, recipients: emails };
}
