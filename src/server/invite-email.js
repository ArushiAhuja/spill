import { sendEmail } from './agentmail.js';

function buildHtml({ inviterName, orgName, acceptUrl }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>you've been invited to spill</title>
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
    <td style="background:#ffffff;padding:36px 40px;">
      <p style="margin:0 0 4px;font-size:13px;color:#64748b;">${inviterName} invited you to</p>
      <h1 style="margin:0 0 24px;font-size:24px;font-weight:600;color:#0f172a;letter-spacing:-0.02em;">${orgName}</h1>

      <p style="margin:0 0 6px;font-size:15px;color:#0f172a;line-height:1.5;">the internet is already talking.</p>
      <p style="margin:0 0 36px;font-size:15px;color:#64748b;line-height:1.5;">join the room.</p>

      <a href="${acceptUrl}"
         style="display:inline-block;background:#0d0f1a;color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:8px;font-size:14px;font-weight:500;letter-spacing:0.01em;">
        accept invitation &rarr;
      </a>

      <p style="margin:28px 0 0;font-size:12px;color:#94a3b8;">
        this invite expires in 7 days.
      </p>
    </td>
  </tr>

  <!-- footer -->
  <tr>
    <td style="background:#f8fafc;padding:20px 40px;border-radius:0 0 12px 12px;border-top:1px solid #e2e8f0;">
      <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.7;">
        you received this because <strong style="color:#64748b;">${inviterName}</strong> invited you to the
        <strong style="color:#64748b;">${orgName}</strong> workspace on spill.<br/>
        if you weren't expecting this, you can safely ignore it.<br/>
        <a href="${acceptUrl}" style="color:#64748b;">${acceptUrl}</a>
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function buildText({ inviterName, orgName, acceptUrl }) {
  return [
    `you've been invited to spill.`,
    ``,
    `${inviterName} invited you to ${orgName}.`,
    ``,
    `the internet is already talking.`,
    `join the room.`,
    ``,
    `→ ${acceptUrl}`,
    ``,
    `this invite expires in 7 days.`,
    `if you weren't expecting this, ignore this email.`,
    ``,
    `—`,
    `spill`,
  ].join('\n');
}

export async function sendInviteEmail({ to, inviterName, orgName, acceptUrl }) {
  await sendEmail({
    to,
    subject: `you've been invited to spill`,
    html: buildHtml({ inviterName, orgName, acceptUrl }),
    text: buildText({ inviterName, orgName, acceptUrl }),
    labels: ['invite'],
  });
  console.log(`[invite-email] sent to ${to}`);
}
