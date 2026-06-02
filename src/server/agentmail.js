import { AgentMailClient } from 'agentmail';

export const SPILL_INBOX = 'spill@agentmail.to';

let _client = null;
function getClient() {
  if (!_client) _client = new AgentMailClient({ apiKey: process.env.AGENTMAIL_API_KEY });
  return _client;
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

  if (!process.env.AGENTMAIL_API_KEY) {
    throw new Error('AGENTMAIL_API_KEY is not set');
  }

  const payload = { to: recipients, subject, html, text };
  if (replyTo) payload.replyTo = replyTo;
  if (labels?.length) payload.labels = labels;

  const res = await getClient().inboxes.messages.send(SPILL_INBOX, payload);
  console.log(`[agentmail] sent "${subject}" to ${recipients.join(', ')} (messageId: ${res.messageId})`);
  return { messageId: res.messageId, threadId: res.threadId };
}
