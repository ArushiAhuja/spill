import OpenAI from 'openai';
import { query } from './db.js';

let _openai = null;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const NEGATIVE_LABELS = ['not_relevant', 'wrong_geography', 'unrelated_complaint', 'too_generic', 'duplicate'];
const POSITIVE_LABELS = ['useful', 'high_signal', 'missed_category'];

// Returns a context string for injection into classifier/relevance prompts.
// Summarizes recent user feedback as explicit EXCLUDE / PRIORITIZE directives.
export async function getOrgFeedbackContext(orgId) {
  try {
    const { rows } = await query(
      `SELECT f.label, f.explanation, p.title
       FROM post_feedback f
       LEFT JOIN posts p ON p.id = f.post_id
       WHERE f.org_id = $1 AND f.label IS NOT NULL
       ORDER BY f.created_at DESC
       LIMIT 80`,
      [orgId]
    );

    if (!rows.length) return null;

    const lines = [];
    for (const row of rows) {
      const snippet = row.explanation || (row.title ? `"${row.title.slice(0, 70)}"` : null);
      if (!snippet) continue;
      if (NEGATIVE_LABELS.includes(row.label)) {
        lines.push(`EXCLUDE (${row.label.replace(/_/g, ' ')}): ${snippet}`);
      } else if (POSITIVE_LABELS.includes(row.label)) {
        lines.push(`PRIORITIZE (${row.label.replace(/_/g, ' ')}): ${snippet}`);
      }
    }

    return lines.length ? lines.slice(0, 20).join('\n') : null;
  } catch {
    return null;
  }
}

// After feedback is submitted, use GPT to extract exclusion terms and merge
// them into intel_profile.exclusionTerms — picked up on the next refresh cycle
// by the existing containsExclusion() filter in scheduler.js.
export async function updateOrgIntelligence(orgId) {
  if (!process.env.OPENAI_API_KEY) return;

  try {
    const { rows } = await query(
      `SELECT f.label, f.explanation, p.title
       FROM post_feedback f
       LEFT JOIN posts p ON p.id = f.post_id
       WHERE f.org_id = $1 AND f.label IN (${NEGATIVE_LABELS.map((_, i) => `$${i + 2}`).join(',')}) AND f.explanation IS NOT NULL
       ORDER BY f.created_at DESC
       LIMIT 40`,
      [orgId, ...NEGATIVE_LABELS]
    );

    if (!rows.length) return;

    const feedbackText = rows.map(r =>
      `Label: ${r.label}\nExplanation: ${r.explanation}\nPost: ${r.title || '(none)'}`
    ).join('\n---\n');

    const res = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 200,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: 'Extract 2-6 short keyword phrases (2-4 words each) that represent topics to exclude from future monitoring. Return ONLY a JSON array of strings.',
        },
        {
          role: 'user',
          content: `Based on this user feedback marking posts as irrelevant, extract the specific topic keywords to exclude:\n\n${feedbackText}\n\nReturn: ["phrase 1", "phrase 2", ...]`,
        },
      ],
    });

    const text = res.choices[0].message.content.trim();
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return;

    const newTerms = JSON.parse(match[0]).filter(t => typeof t === 'string' && t.trim().length >= 3);
    if (!newTerms.length) return;

    const { rows: [org] } = await query('SELECT intel_profile FROM organizations WHERE id = $1', [orgId]);
    const intel = org?.intel_profile || {};
    const existing = intel.exclusionTerms || [];
    const merged = [...new Set([...existing, ...newTerms.map(t => t.toLowerCase().trim())])];

    await query(
      `UPDATE organizations SET intel_profile = COALESCE(intel_profile, '{}')::jsonb || $1::jsonb WHERE id = $2`,
      [JSON.stringify({ exclusionTerms: merged, feedbackUpdatedAt: new Date().toISOString() }), orgId]
    );

    console.log(`[feedback] org ${orgId} intelligence updated — exclusions:`, newTerms);
  } catch (err) {
    console.warn('[feedback] intelligence update failed:', err.message);
  }
}
