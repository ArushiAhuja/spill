// AgentMail REST client — avoids bundling the SDK which has a dynamic
// @x402/fetch import that webpack can't tree-shake in Next.js builds.

export const SPILL_INBOX = 'spill@agentmail.to';
const BASE_URL = 'https://api.agentmail.to';

async function agentMailFetch(path, body) {
  const apiKey = process.env.AGENTMAIL_API_KEY;
  if (!apiKey) throw new Error('AGENTMAIL_API_KEY is not set');

  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`AgentMail ${res.status}: ${text}`);
  }

  return res.json();
}

/**
 * Send an email from spill@agentmail.to.
 * Returns { messageId, threadId }.
 */
export async function sendEmail({ to, subject, html, text, replyTo, labels } = {}) {
  const recipients = Array.isArray(to) ? to : [to];

  if (process.env.DRY_RUN === 'true') {
    console.log(`[agentmail] DRY RUN — would send to ${recipients.join(', ')}: ${subject}`);
    return { messageId: `dry-run-${Date.now()}` };
  }

  const payload = { to: recipients, subject };
  if (html) payload.html = html;
  if (text) payload.text = text;
  if (replyTo) payload.reply_to = replyTo;
  if (labels?.length) payload.labels = labels;

  const data = await agentMailFetch(
    `/inboxes/${encodeURIComponent(SPILL_INBOX)}/messages/send`,
    payload
  );

  console.log(`[agentmail] sent "${subject}" to ${recipients.join(', ')} (messageId: ${data.message_id})`);
  return { messageId: data.message_id, threadId: data.thread_id };
}
