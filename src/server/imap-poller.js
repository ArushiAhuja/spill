import { ImapFlow } from 'imapflow';
import { query } from './db.js';
import OpenAI from 'openai';
import nodemailer from 'nodemailer';

let _openai = null;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

export async function pollEmailReplies() {
  const { rows: threads } = await query(`
    SELECT rt.id, rt.message_id, rt.recipient, rt.current_template, rt.iteration,
           p.title, p.body, p.source, p.url, p.reasoning, p.org_id,
           rt.org_id as thread_org_id
    FROM response_threads rt
    JOIN posts p ON p.id = rt.post_id
    WHERE rt.status = 'active' AND rt.iteration < 5
    ORDER BY rt.created_at
  `);

  if (!threads.length) return;

  // Resolve credentials per org
  const orgCreds = {};
  for (const t of threads) {
    const oid = t.thread_org_id;
    if (orgCreds[oid]) continue;
    const { rows: rules } = await query(
      `SELECT config FROM escalation_rules WHERE org_id = $1 AND action_type = 'email' AND enabled = true LIMIT 1`,
      [oid]
    );
    if (!rules.length) continue;
    const cfg = rules[0].config;
    const user = cfg.gmail_user?.trim() || process.env.GMAIL_USER;
    const pass = cfg.gmail_app_password?.trim() || process.env.GMAIL_APP_PASSWORD;
    if (user && pass) orgCreds[oid] = { user, pass };
  }

  // Group threads by credentials
  const byAccount = {};
  for (const t of threads) {
    const creds = orgCreds[t.thread_org_id];
    if (!creds) continue;
    const key = creds.user;
    if (!byAccount[key]) byAccount[key] = { creds, threads: [] };
    byAccount[key].threads.push(t);
  }

  for (const { creds, threads: accountThreads } of Object.values(byAccount)) {
    try {
      await processAccountReplies(creds.user, creds.pass, accountThreads);
    } catch (err) {
      console.error(`[imap] error for ${creds.user}:`, err.message);
    }
  }
}

async function processAccountReplies(gmailUser, gmailPass, threads) {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: gmailUser, pass: gmailPass },
    logger: false,
  });

  await client.connect();

  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      for (const thread of threads) {
        if (!thread.message_id) continue;
        try {
          // Search for messages replying to our message
          const msgIds = await client.search({ header: { 'In-Reply-To': thread.message_id } });
          if (!msgIds?.length) continue;

          // Fetch the latest reply
          const uid = msgIds[msgIds.length - 1];
          const msg = await client.fetchOne(String(uid), { bodyStructure: true, source: true, envelope: true });
          if (!msg) continue;

          const rawSource = msg.source?.toString('utf8') || '';
          const replyText = extractReplyText(rawSource);
          if (!replyText.trim()) continue;

          console.log(`[imap] reply for thread ${thread.id} (iter ${thread.iteration}): "${replyText.slice(0, 80)}"`);

          const revised = await generateRefinedTemplate(thread, replyText);
          await sendThreadReply(gmailUser, gmailPass, thread, revised);

          await query(`
            UPDATE response_threads
            SET current_template = $1, iteration = iteration + 1, updated_at = NOW()
            WHERE id = $2
          `, [revised, thread.id]);

          if (thread.iteration + 1 >= 5) {
            await query(`UPDATE response_threads SET status = 'resolved' WHERE id = $1`, [thread.id]);
          }
        } catch (err) {
          console.error(`[imap] thread ${thread.id} error:`, err.message);
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

function extractReplyText(raw) {
  // Find text/plain content in MIME message
  let text = raw;

  // Try to extract plain text part from multipart
  const plainMatch = raw.match(/Content-Type:\s*text\/plain[\s\S]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n--|\r?\nContent-Type:|$)/i);
  if (plainMatch) {
    text = plainMatch[1];
  } else {
    // Fallback: take everything after double newline
    const bodyMatch = raw.match(/\r?\n\r?\n([\s\S]*)/);
    if (bodyMatch) text = bodyMatch[1];
  }

  // Strip quoted reply lines (lines starting with > or "On ... wrote:")
  const lines = text.split('\n');
  const replyLines = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('>')) break;
    if (/^On .{10,} wrote:/.test(trimmed)) break;
    if (trimmed.startsWith('--')) break;
    replyLines.push(line);
  }

  return replyLines.join('\n').trim().replace(/=\r?\n/g, ''); // handle quoted-printable
}

async function generateRefinedTemplate(thread, feedback) {
  const prompt = `You are helping a company craft a public social media response to a customer complaint.

Original post:
Title: ${thread.title}
Body: ${(thread.body || '').slice(0, 400)}
Source: ${thread.source}
AI Analysis: ${thread.reasoning || ''}

Current response template (iteration ${thread.iteration}):
${thread.current_template}

Feedback from the team:
${feedback}

Generate a refined response template addressing the feedback. Requirements:
- Empathetic and professional tone
- Specific to the complaint
- 2-4 sentences, concise
- Ready to post publicly on ${thread.source}

Reply with ONLY the response text, no preamble.`;

  const res = await getOpenAI().chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });

  return res.choices[0].message.content.trim();
}

async function sendThreadReply(gmailUser, gmailPass, thread, revised) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: gmailUser, pass: gmailPass },
  });

  const body = [
    `Thanks for the feedback! Here's iteration ${thread.iteration + 1}:`,
    '',
    '─────────────────────────────────',
    revised,
    '─────────────────────────────────',
    '',
    thread.iteration + 1 < 5
      ? 'Reply to this email with further feedback to refine again (up to 5 iterations).'
      : 'This is the final iteration. Copy the response above to use it.',
    '',
    '—',
    'Spill Social Watch',
  ].join('\n');

  await transporter.sendMail({
    from: `"Spill Social Watch" <${gmailUser}>`,
    to: thread.recipient,
    subject: `Re: [SPILL] Response for: ${(thread.title || '').slice(0, 55)}`,
    text: body,
    headers: {
      'In-Reply-To': thread.message_id,
      'References': thread.message_id,
    },
  });
}
