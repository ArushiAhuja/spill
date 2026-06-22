import OpenAI from 'openai';
import { query } from './db.js';

let _openai = null;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const NEGATIVE_LABELS = new Set(['not_relevant', 'wrong_geography', 'unrelated_complaint', 'too_generic', 'duplicate', 'dismissed', 'false_positive']);
const POSITIVE_LABELS = new Set(['useful', 'high_signal', 'missed_category', 'wrong_category', 'missed_context', 'saved', 'good_match']);

// Strip common PII patterns before including post content in training data or prompts.
// Targets: email addresses, phone numbers, bare URLs.
function anonymizeText(text) {
  if (!text) return text;
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[phone]')
    .replace(/https?:\/\/[^\s)>]+/g, '[url]');
}

// Returns a concise, deduplicated context string (~200 tokens) for injection into
// classifier and relevance filter prompts each refresh cycle.
//
// Signal hierarchy:
//   1. Pre-extracted structured terms (intel_profile) — GPT-validated, highest confidence
//   2. Implicit saves — posts users bookmarked, grouped by category (positive pattern)
//   3. Explicit feedback patterns — deduplicated by (label, snippet), sorted by frequency
export async function getOrgFeedbackContext(orgId) {
  try {
    const [feedbackResult, orgResult, savedResult] = await Promise.all([
      query(
        `SELECT f.label, f.explanation, f.signal_type, p.title
         FROM post_feedback f
         LEFT JOIN posts p ON p.id = f.post_id
         WHERE f.org_id = $1 AND f.label IS NOT NULL
         ORDER BY f.created_at DESC
         LIMIT 120`,
        [orgId]
      ),
      query('SELECT intel_profile FROM organizations WHERE id = $1', [orgId]),
      // Implicit positive signal: what kinds of posts do users bookmark?
      query(
        `SELECT c.name as category_name, COUNT(*) as cnt
         FROM posts p
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.org_id = $1 AND p.saved_at IS NOT NULL
           AND p.saved_at > NOW() - INTERVAL '60 days'
         GROUP BY c.name
         ORDER BY cnt DESC
         LIMIT 5`,
        [orgId]
      ),
    ]);

    const intel = orgResult.rows[0]?.intel_profile || {};
    const lines = [];

    // 1. Structured terms — highest confidence, already GPT-validated
    if (intel.exclusionTerms?.length) {
      lines.push(`Learned exclusions: ${intel.exclusionTerms.slice(0, 10).join(', ')}`);
    }
    if (intel.boostTerms?.length) {
      lines.push(`Learned boosts (prioritize these): ${intel.boostTerms.slice(0, 6).join(', ')}`);
    }

    // 2. Implicit positive signals from saved posts
    if (savedResult.rows.length) {
      const topCategories = savedResult.rows
        .filter(r => r.category_name)
        .map(r => `${r.category_name} (×${r.cnt})`)
        .join(', ');
      if (topCategories) {
        lines.push(`Users most often save posts about: ${topCategories}`);
      }
    }

    if (!feedbackResult.rows.length) return lines.length ? lines.join('\n') : null;

    // 3. Explicit + implicit feedback patterns, deduplicated
    const patternMap = new Map();
    for (const row of feedbackResult.rows) {
      const snippet = row.explanation?.trim() || (row.title ? `"${row.title.slice(0, 60)}"` : null);
      if (!snippet) continue;
      const key = `${row.label}::${snippet.toLowerCase().slice(0, 60)}`;
      if (!patternMap.has(key)) {
        patternMap.set(key, { label: row.label, snippet, count: 0 });
      }
      patternMap.get(key).count++;
    }

    const patterns = [...patternMap.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    for (const p of patterns) {
      const labelDesc = p.label.replace(/_/g, ' ');
      const freq = p.count > 1 ? ` (×${p.count})` : '';
      if (NEGATIVE_LABELS.has(p.label)) {
        lines.push(`EXCLUDE (${labelDesc})${freq}: ${p.snippet}`);
      } else if (POSITIVE_LABELS.has(p.label)) {
        lines.push(`PRIORITIZE (${labelDesc})${freq}: ${p.snippet}`);
      }
    }

    return lines.length ? lines.join('\n') : null;
  } catch {
    return null;
  }
}

// Extracts exclusion + boost terms from recent feedback and replaces them in intel_profile.
//
// Design decisions that prevent model drift / catastrophic forgetting:
//   - 60-day rolling window: stale patterns age out naturally without manual pruning
//   - Replace (not merge): terms are regenerated fresh from current feedback, not accumulated forever
//   - Cap at 15 each: prevents the exclusion list from growing so large it over-filters
//   - Implicit saves included: saved posts are as valid a training signal as explicit labels
//   - 2-hour debounce: avoids redundant GPT calls when feedback bursts (multiple tabs / sessions)
export async function updateOrgIntelligence(orgId, { force = false } = {}) {
  if (!process.env.OPENAI_API_KEY) return;

  try {
    const { rows: [org] } = await query(
      'SELECT intel_profile FROM organizations WHERE id = $1',
      [orgId]
    );
    const intel = org?.intel_profile || {};

    if (!force && intel.feedbackUpdatedAt) {
      const msSince = Date.now() - new Date(intel.feedbackUpdatedAt).getTime();
      if (msSince < 2 * 60 * 60 * 1000) return;
    }

    // 60-day rolling window — ensures stale terms are not perpetuated
    const [feedbackResult, savedResult, categoryFeedbackResult] = await Promise.all([
      query(
        `SELECT f.label, f.explanation, f.signal_type, f.severity_direction, p.title, c.name as category_name
         FROM post_feedback f
         LEFT JOIN posts p ON p.id = f.post_id
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE f.org_id = $1 AND f.label IS NOT NULL
           AND f.created_at > NOW() - INTERVAL '60 days'
         ORDER BY f.created_at DESC
         LIMIT 150`,
        [orgId]
      ),
      query(
        `SELECT p.title, p.body, c.name as category_name
         FROM posts p
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.org_id = $1 AND p.saved_at IS NOT NULL
           AND p.saved_at > NOW() - INTERVAL '60 days'
         ORDER BY p.saved_at DESC LIMIT 30`,
        [orgId]
      ),
      // Count feedback by category to detect which categories are consistently wrong
      query(
        `SELECT c.name as category_name, f.label, COUNT(*) as cnt
         FROM post_feedback f
         LEFT JOIN posts p ON p.id = f.post_id
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE f.org_id = $1 AND f.label IS NOT NULL AND c.name IS NOT NULL
           AND f.created_at > NOW() - INTERVAL '60 days'
         GROUP BY c.name, f.label
         ORDER BY cnt DESC
         LIMIT 40`,
        [orgId]
      ),
    ]);

    const negativeRows = feedbackResult.rows.filter(r =>
      NEGATIVE_LABELS.has(r.label) ||
      (r.label === 'wrong_severity' && r.severity_direction === 'lower')
    );
    const positiveRows = feedbackResult.rows.filter(r =>
      POSITIVE_LABELS.has(r.label) ||
      (r.label === 'wrong_severity' && r.severity_direction === 'higher')
    );
    const falsePositiveRows = feedbackResult.rows.filter(r => r.label === 'false_positive');
    const missedContextRows = feedbackResult.rows.filter(r => r.label === 'missed_context');

    if (!negativeRows.length && !positiveRows.length && !savedResult.rows.length) return;

    const negativeFeedback = negativeRows.slice(0, 30)
      .map(r => {
        const text = anonymizeText(r.explanation || r.title || '');
        const prefix = r.label === 'false_positive' ? '[false positive] ' : r.label === 'wrong_severity' ? '[over-escalated] ' : '';
        return prefix + text;
      })
      .filter(Boolean)
      .map((t, i) => `${i + 1}. ${t}`).join('\n');

    const positiveFeedback = [
      ...positiveRows.slice(0, 15).map(r => {
        const text = anonymizeText(r.explanation || r.title || '');
        const prefix = r.label === 'missed_context' ? '[missed context] ' : r.label === 'wrong_severity' ? '[under-escalated] ' : '';
        return prefix + text;
      }),
      ...savedResult.rows.slice(0, 15).map(r => [r.category_name, r.title?.slice(0, 80)].filter(Boolean).join(' — ')),
    ].filter(Boolean).map((t, i) => `${i + 1}. ${t}`).join('\n');

    const falsePositiveFeedback = falsePositiveRows.length
      ? falsePositiveRows.slice(0, 10).map(r => anonymizeText(r.explanation || r.title || '')).filter(Boolean).map((t, i) => `${i + 1}. ${t}`).join('\n')
      : '';
    const missedContextFeedback = missedContextRows.length
      ? missedContextRows.slice(0, 10).map(r => anonymizeText(r.explanation || r.title || '')).filter(Boolean).map((t, i) => `${i + 1}. ${t}`).join('\n')
      : '';

    // Summarize category-level feedback patterns for the AI
    const categoryPatterns = {};
    for (const row of categoryFeedbackResult.rows) {
      if (!row.category_name) continue;
      if (!categoryPatterns[row.category_name]) categoryPatterns[row.category_name] = { negative: 0, positive: 0 };
      if (NEGATIVE_LABELS.has(row.label)) categoryPatterns[row.category_name].negative += parseInt(row.cnt);
      if (POSITIVE_LABELS.has(row.label)) categoryPatterns[row.category_name].positive += parseInt(row.cnt);
    }
    const categoryContext = Object.entries(categoryPatterns)
      .filter(([, v]) => v.negative > 2 || v.positive > 2)
      .map(([name, v]) => `"${name}": ${v.positive} positive signals, ${v.negative} negative signals`)
      .join('; ');

    const res = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 600,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: 'Extract content filtering rules and escalation signals from brand monitoring feedback. Return ONLY valid JSON.',
        },
        {
          role: 'user',
          content: `Based on user feedback for a brand monitoring system, extract filtering rules, escalation signals, and category insights.

${negativeFeedback ? `Posts marked irrelevant, over-escalated, or false positives:\n${negativeFeedback}\n` : ''}${positiveFeedback ? `\nPosts found valuable, under-escalated, or with missed context:\n${positiveFeedback}\n` : ''}${falsePositiveFeedback ? `\nFalse positive escalations (posts that escalated but shouldn't have):\n${falsePositiveFeedback}\n` : ''}${missedContextFeedback ? `\nMissed context (posts where AI misunderstood the significance):\n${missedContextFeedback}\n` : ''}${categoryContext ? `\nCategory feedback patterns: ${categoryContext}\n` : ''}
Return:
{
  "exclude": ["phrase 1", ...],
  "boost": ["phrase 1", ...],
  "typicalComplaints": ["complaint pattern 1", ...],
  "escalationPatterns": {"over": ["phrase for posts that over-escalated"], "under": ["phrase for posts that under-escalated"]},
  "categorySignals": {"category name": "increase" | "decrease" | "stable"}
}

Rules:
- exclude: 2-8 short phrases (2-4 words) for content consistently irrelevant to this company. Return [] if no pattern.
- boost: 2-6 short phrases for high-signal content this company should prioritize. Return [] if no pattern.
- typicalComplaints: 3-8 complaint patterns from negative feedback (short verb phrases like "refund not processed"). Return [] if no pattern.
- escalationPatterns.over: 0-5 phrases appearing in posts that were flagged as over-escalated or false positives. Return [] if no pattern.
- escalationPatterns.under: 0-5 phrases appearing in posts that were under-escalated or had missed context. Return [] if no pattern.
- categorySignals: categories with clear signal (>3 instances) — increase, decrease, or stable severity. Only include clear signals.
- No generic words like "content" or "posts".`,
        },
      ],
    });

    const text = res.choices[0].message.content.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const parsed = JSON.parse(jsonMatch[0]);

    // Normalise, deduplicate, cap — replace not merge to prevent drift
    const newExclusions = Array.isArray(parsed.exclude)
      ? [...new Set(parsed.exclude.filter(t => typeof t === 'string' && t.trim().length >= 3).map(t => t.toLowerCase().trim()))].slice(0, 15)
      : (intel.exclusionTerms || []);

    const newBoosts = Array.isArray(parsed.boost)
      ? [...new Set(parsed.boost.filter(t => typeof t === 'string' && t.trim().length >= 3).map(t => t.toLowerCase().trim()))].slice(0, 15)
      : (intel.boostTerms || []);

    const newTypicalComplaints = Array.isArray(parsed.typicalComplaints)
      ? [...new Set(parsed.typicalComplaints.filter(t => typeof t === 'string' && t.trim().length >= 5).map(t => t.trim()))].slice(0, 15)
      : (intel.typicalComplaints || []);

    const categorySignals = parsed.categorySignals && typeof parsed.categorySignals === 'object'
      ? parsed.categorySignals
      : {};

    // Escalation patterns inform future relevance filtering
    const overEscalationPatterns = Array.isArray(parsed.escalationPatterns?.over)
      ? [...new Set(parsed.escalationPatterns.over.filter(t => typeof t === 'string' && t.trim().length >= 3).map(t => t.toLowerCase().trim()))].slice(0, 8)
      : (intel.overEscalationPatterns || []);
    const underEscalationPatterns = Array.isArray(parsed.escalationPatterns?.under)
      ? [...new Set(parsed.escalationPatterns.under.filter(t => typeof t === 'string' && t.trim().length >= 3).map(t => t.toLowerCase().trim()))].slice(0, 8)
      : (intel.underEscalationPatterns || []);

    // Apply category severity adjustments based on feedback signal
    if (Object.keys(categorySignals).length > 0) {
      const { rows: categories } = await query(
        'SELECT id, name, severity FROM categories WHERE org_id = $1',
        [orgId]
      );
      for (const cat of categories) {
        const signal = categorySignals[cat.name];
        if (!signal) continue;
        const delta = signal === 'increase' ? 3 : signal === 'decrease' ? -3 : 0;
        if (delta !== 0) {
          const newSeverity = Math.min(30, Math.max(0, (cat.severity || 10) + delta));
          await query(
            'UPDATE categories SET severity = $1 WHERE id = $2',
            [newSeverity, cat.id]
          ).catch(() => {});
        }
      }
    }

    await query(
      `UPDATE organizations SET intel_profile = COALESCE(intel_profile, '{}')::jsonb || $1::jsonb WHERE id = $2`,
      [JSON.stringify({
        exclusionTerms: newExclusions,
        boostTerms: newBoosts,
        typicalComplaints: newTypicalComplaints,
        overEscalationPatterns,
        underEscalationPatterns,
        feedbackUpdatedAt: new Date().toISOString(),
      }), orgId]
    );

    console.log(`[feedback] org ${orgId} intelligence updated — exclusions: [${newExclusions.join(', ')}] | boosts: [${newBoosts.join(', ')}] | complaints: [${newTypicalComplaints.slice(0, 3).join(', ')}] | over-escalation: [${overEscalationPatterns.slice(0, 2).join(', ')}]`);
  } catch (err) {
    console.warn('[feedback] intelligence update failed:', err.message);
  }
}

// Exports feedback + post content as OpenAI fine-tuning JSONL.
// Each line is one training example: the original post → the correct classification
// (as inferred from user feedback). Post content is anonymized before export.
//
// Minimum 10 examples required by OpenAI fine-tuning API; 50+ recommended for meaningful improvement.
export async function exportTrainingData(orgId, limit = 200) {
  const [feedbackResult, orgResult] = await Promise.all([
    query(
      `SELECT
         f.label, f.explanation, f.signal_type,
         p.title, p.body, p.source,
         c.name as category_name
       FROM post_feedback f
       JOIN posts p ON p.id = f.post_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE f.org_id = $1 AND f.label IS NOT NULL AND p.title IS NOT NULL
       ORDER BY f.created_at DESC
       LIMIT $2`,
      [orgId, limit]
    ),
    query('SELECT name, description FROM organizations WHERE id = $1', [orgId]),
  ]);

  const org = orgResult.rows[0];
  const systemPrompt = `You classify social media posts for brand monitoring. Company: ${org?.name || 'unknown'}. ${org?.description ? `Context: ${org.description}` : ''}`.trim();

  return feedbackResult.rows.map(row => {
    const rawText = [row.title, row.body?.slice(0, 400)].filter(Boolean).join('\n');
    const postText = anonymizeText(rawText);
    const isRelevant = !NEGATIVE_LABELS.has(row.label);
    const assistantResponse = {
      category: isRelevant ? (row.category_name || 'General') : null,
      is_relevant: isRelevant,
      reasoning: anonymizeText(row.explanation) || (isRelevant ? 'relevant to company' : 'not relevant'),
    };

    return JSON.stringify({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Classify this ${row.source || 'social media'} post:\n\n${postText}` },
        { role: 'assistant', content: JSON.stringify(assistantResponse) },
      ],
    });
  }).join('\n');
}
