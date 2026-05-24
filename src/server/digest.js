import { query } from './db.js';
import nodemailer from 'nodemailer';

function makeTransporter(user, pass) {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user, pass },
  });
}

export async function sendDigestForOrg(orgId) {
  const { rows: [org] } = await query(`
    SELECT name, digest_enabled, digest_frequency, digest_recipients,
           digest_last_sent, digest_gmail_user, digest_gmail_app_password
    FROM organizations WHERE id = $1
  `, [orgId]);

  if (!org?.digest_enabled || !org.digest_recipients?.length) return;

  const gmailUser = org.digest_gmail_user || process.env.GMAIL_USER;
  const gmailPass = org.digest_gmail_app_password || process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass) return;

  const isWeekly = org.digest_frequency === 'weekly';
  const hours = isWeekly ? 168 : 24;
  const windowLabel = isWeekly ? 'last 7 days' : 'last 24 hours';
  const minGapMs = (isWeekly ? 6 : 0.9) * 24 * 3600 * 1000;

  if (org.digest_last_sent && Date.now() - new Date(org.digest_last_sent).getTime() < minGapMs) return;

  const { rows: [stats] } = await query(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE escalated = true) as escalated,
      COUNT(*) FILTER (WHERE is_competitor = true) as competitor,
      COUNT(*) FILTER (WHERE is_influencer = true) as influencer,
      ROUND(AVG(sentiment_intensity)::numeric, 1) as avg_sentiment
    FROM posts
    WHERE org_id = $1 AND created_at > NOW() - INTERVAL '${hours} hours'
  `, [orgId]);

  if (parseInt(stats?.total) === 0) {
    await query('UPDATE organizations SET digest_last_sent = NOW() WHERE id = $1', [orgId]);
    return;
  }

  const { rows: topPosts } = await query(`
    SELECT p.title, p.url, p.source, p.author, p.escalation_score, c.name as cat_name
    FROM posts p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.org_id = $1 AND p.escalated = true
      AND p.created_at > NOW() - INTERVAL '${hours} hours'
    ORDER BY p.escalation_score DESC LIMIT 5
  `, [orgId]);

  const { rows: catBreakdown } = await query(`
    SELECT c.name, COUNT(*) as count
    FROM posts p
    JOIN categories c ON c.id = p.category_id
    WHERE p.org_id = $1 AND p.created_at > NOW() - INTERVAL '${hours} hours'
    GROUP BY c.id, c.name ORDER BY count DESC LIMIT 5
  `, [orgId]);

  const { rows: incidentRows } = await query(`
    SELECT title, post_count, status FROM incidents
    WHERE org_id = $1 AND created_at > NOW() - INTERVAL '${hours} hours'
    ORDER BY post_count DESC LIMIT 3
  `, [orgId]);

  const html = buildHtml(org.name, windowLabel, stats, topPosts, catBreakdown, incidentRows);
  const text = buildText(org.name, windowLabel, stats, topPosts);

  const transporter = makeTransporter(gmailUser, gmailPass);
  await transporter.sendMail({
    from: `"Spill" <${gmailUser}>`,
    to: org.digest_recipients.join(', '),
    subject: `[Spill Digest] ${org.name} — ${windowLabel} · ${stats.total} signals`,
    html,
    text,
  });

  await query('UPDATE organizations SET digest_last_sent = NOW() WHERE id = $1', [orgId]);
  console.log(`[digest] sent for org ${orgId}`);
}

export async function sendDigestForAll() {
  const { rows: orgs } = await query(
    `SELECT id FROM organizations WHERE digest_enabled = true`
  );
  await Promise.allSettled(orgs.map(o => sendDigestForOrg(o.id)));
}

function buildHtml(orgName, window, stats, topPosts, cats, incidents) {
  const s = (tag, style, content) => `<${tag} style="${style}">${content}</${tag}>`;

  const statCards = [
    ['signals', stats.total, '#64748b'],
    ['escalated', stats.escalated, '#818cf8'],
    ['competitors', stats.competitor, '#60a5fa'],
    ['influencers', stats.influencer, '#4ade80'],
  ].map(([label, val, color]) => `
    <td style="padding:0 6px 0 0;">
      <div style="background:#13161f;border:1px solid #1e2535;border-radius:8px;padding:12px;text-align:center;min-width:100px;">
        <div style="font-size:24px;font-weight:500;color:${color};">${val || 0}</div>
        <div style="font-size:10px;color:#334155;text-transform:uppercase;letter-spacing:0.08em;margin-top:2px;">${label}</div>
      </div>
    </td>
  `).join('');

  const postRows = topPosts.map(p => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #1e2535;font-size:12px;">
        <a href="${p.url || '#'}" style="color:#3b82f6;text-decoration:none;">${(p.title || '').slice(0, 80)}${(p.title||'').length>80?'…':''}</a>
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #1e2535;font-size:11px;color:#64748b;white-space:nowrap;">${p.source}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #1e2535;font-size:11px;color:#64748b;white-space:nowrap;">${p.cat_name||'—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #1e2535;font-size:11px;color:#818cf8;font-weight:500;white-space:nowrap;">${p.escalation_score}</td>
    </tr>
  `).join('');

  const catSection = cats.length ? `
    <h3 style="font-size:11px;color:#64748b;letter-spacing:0.1em;text-transform:uppercase;margin:24px 0 10px;">by category</h3>
    <table style="width:100%;border-collapse:collapse;background:#13161f;border:1px solid #1e2535;border-radius:8px;overflow:hidden;">
      ${cats.map(c => `<tr>
        <td style="padding:7px 12px;font-size:12px;color:#e2e8f0;border-bottom:1px solid #1e2535;">${c.name}</td>
        <td style="padding:7px 12px;font-size:12px;color:#64748b;text-align:right;border-bottom:1px solid #1e2535;">${c.count}</td>
      </tr>`).join('')}
    </table>
  ` : '';

  const incidentSection = incidents.length ? `
    <h3 style="font-size:11px;color:#f87171;letter-spacing:0.1em;text-transform:uppercase;margin:24px 0 10px;">⚡ incidents</h3>
    ${incidents.map(i => `<div style="padding:8px 12px;background:rgba(248,113,113,0.06);border:1px solid rgba(248,113,113,0.2);border-radius:6px;margin-bottom:6px;font-size:12px;color:#fca5a5;">${i.title} · ${i.post_count} signals · ${i.status}</div>`).join('')}
  ` : '';

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#0d0f1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:620px;margin:0 auto;padding:32px 24px;">
  <div style="font-size:18px;font-weight:500;color:#e2e8f0;letter-spacing:0.08em;margin-bottom:4px;">spill digest</div>
  <div style="font-size:13px;color:#64748b;margin-bottom:28px;">${orgName} · ${window}</div>
  <table style="margin-bottom:24px;"><tr>${statCards}</tr></table>
  ${incidentSection}
  <h3 style="font-size:11px;color:#64748b;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 10px;">top escalated</h3>
  <table style="width:100%;border-collapse:collapse;background:#13161f;border:1px solid #1e2535;border-radius:8px;overflow:hidden;">
    <thead><tr style="background:#191d2b;">
      <th style="padding:7px 12px;text-align:left;font-size:10px;color:#334155;text-transform:uppercase;letter-spacing:0.08em;">title</th>
      <th style="padding:7px 12px;text-align:left;font-size:10px;color:#334155;text-transform:uppercase;letter-spacing:0.08em;">source</th>
      <th style="padding:7px 12px;text-align:left;font-size:10px;color:#334155;text-transform:uppercase;letter-spacing:0.08em;">category</th>
      <th style="padding:7px 12px;text-align:left;font-size:10px;color:#334155;text-transform:uppercase;letter-spacing:0.08em;">score</th>
    </tr></thead>
    <tbody>${postRows || '<tr><td colspan="4" style="padding:16px 12px;font-size:12px;color:#334155;">no escalated posts in this period</td></tr>'}</tbody>
  </table>
  ${catSection}
  <div style="margin-top:32px;font-size:11px;color:#334155;text-align:center;">Sent by Spill Social Watch · <a href="https://getspill.vercel.app" style="color:#334155;">getspill.vercel.app</a></div>
</div>
</body></html>`;
}

function buildText(orgName, window, stats, topPosts) {
  return [
    `SPILL DIGEST — ${orgName}`,
    `${window}`,
    '',
    `Signals: ${stats.total}  |  Escalated: ${stats.escalated}  |  Competitors: ${stats.competitor}  |  Influencers: ${stats.influencer}`,
    '',
    'TOP ESCALATED:',
    ...topPosts.map(p => `  [${p.escalation_score}] ${(p.title||'').slice(0,80)} — ${p.url||''}`),
    '',
    '—',
    'Spill Social Watch · https://getspill.vercel.app',
  ].join('\n');
}
