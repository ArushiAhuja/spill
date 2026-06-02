import { sendEmail } from './agentmail.js';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://getspill.vercel.app';

function buildHtml({ name }) {
  const firstName = name?.split(' ')[0] || 'there';
  const dashUrl = APP_URL;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>welcome to spill</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 16px;">
<tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;">

  <!-- header -->
  <tr>
    <td style="background:#0d0f1a;padding:28px 40px;border-radius:12px 12px 0 0;">
      <span style="font-size:11px;letter-spacing:0.25em;color:#475569;text-transform:lowercase;font-family:'Courier New',monospace;">spill</span>
    </td>
  </tr>

  <!-- body -->
  <tr>
    <td style="background:#ffffff;padding:40px 40px 32px;">

      <!-- headline -->
      <h1 style="margin:0 0 8px;font-size:32px;font-weight:700;color:#0f172a;letter-spacing:-0.03em;line-height:1.1;">
        you're in.
      </h1>
      <p style="margin:0 0 32px;font-size:15px;color:#64748b;line-height:1.6;">
        spill is now watching the internet with you, ${firstName}.
      </p>

      <!-- divider -->
      <div style="height:1px;background:#f1f5f9;margin:0 0 28px;"></div>

      <!-- what's next -->
      <p style="margin:0 0 12px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.12em;font-family:'Courier New',monospace;">
        what&rsquo;s next
      </p>
      <p style="margin:0 0 6px;font-size:15px;color:#0f172a;line-height:1.5;font-weight:500;">
        connect your sources.
      </p>
      <p style="margin:0 0 28px;font-size:14px;color:#64748b;line-height:1.6;">
        build your first monitoring room — Reddit, Hacker News, Google News, Play Store.
        point it at your brand. spill does the rest.
      </p>

      <!-- CTA -->
      <a href="${dashUrl}"
         style="display:inline-block;background:#0d0f1a;color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:8px;font-size:14px;font-weight:500;letter-spacing:0.01em;">
        open spill &rarr;
      </a>

      <!-- bottom tagline -->
      <p style="margin:36px 0 0;font-size:13px;color:#94a3b8;font-style:italic;line-height:1.5;">
        quiet internet day. suspicious.
      </p>
    </td>
  </tr>

  <!-- footer -->
  <tr>
    <td style="background:#f8fafc;padding:20px 40px;border-radius:0 0 12px 12px;border-top:1px solid #e2e8f0;">
      <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.7;">
        you received this because you signed up at spill.<br/>
        <a href="${dashUrl}" style="color:#64748b;">${dashUrl}</a>
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function buildText({ name }) {
  const firstName = name?.split(' ')[0] || 'there';
  return [
    `you're in.`,
    ``,
    `spill is now watching the internet with you, ${firstName}.`,
    ``,
    `— what's next —`,
    ``,
    `connect your sources and build your first monitoring room.`,
    `Reddit, Hacker News, Google News, Play Store.`,
    `point it at your brand. spill does the rest.`,
    ``,
    `→ ${APP_URL}`,
    ``,
    `quiet internet day. suspicious.`,
    ``,
    `—`,
    `spill`,
  ].join('\n');
}

export async function sendWelcomeEmail({ to, name }) {
  await sendEmail({
    to,
    subject: `welcome to spill`,
    html: buildHtml({ name }),
    text: buildText({ name }),
    labels: ['welcome'],
  });
  console.log(`[welcome-email] sent to ${to}`);
}
