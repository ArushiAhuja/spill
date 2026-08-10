import OpenAI from 'openai';
import { query } from './db.js';
import { getOrganizationAgentConfig, saveOrganizationAgentConfig } from './organization-agent-config.js';
import { syncFeedbackAssessment, syncImprovementRecommendation } from './event-intelligence.js';
import { invalidateOrganizationAgentBriefing } from './organization-intelligence.js';
import { buildKeepRuleFromPost, primaryBrandMoniker } from './relevance-policy.js';

let _openai = null;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const NEGATIVE_LABELS = new Set(['not_relevant', 'wrong_geography', 'unrelated_complaint', 'too_generic', 'duplicate', 'dismissed', 'false_positive']);
const POSITIVE_LABELS = new Set(['useful', 'high_signal', 'missed_category', 'wrong_category', 'missed_context', 'saved', 'good_match', 'should_have_surfaced']);

// Strip common PII patterns before including post content in training data or prompts.
// Targets: email addresses, phone numbers, bare URLs.
function anonymizeText(text) {
  if (!text) return text;
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[phone]')
    .replace(/https?:\/\/[^\s)>]+/g, '[url]');
}

function compactText(value, max = 500) {
  return anonymizeText(String(value || '').replace(/\s+/g, ' ').trim()).slice(0, max);
}

async function recordLearningAction({ orgId, feedbackId = null, eventId, agentName, actionType, status = 'applied', before = {}, after = {}, reason = null }) {
  await query(
    `INSERT INTO feedback_learning_actions
       (org_id,feedback_id,event_id,agent_name,action_type,status,before_state,after_state,reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [orgId, feedbackId, eventId, agentName, actionType, status, JSON.stringify(before), JSON.stringify(after), compactText(reason, 1000) || null]
  );
}

function expectedFromFeedback({ label, categoryId, newValue, severityDirection }) {
  const isRelevant = !NEGATIVE_LABELS.has(label);
  const severity = label === 'wrong_severity'
    ? (severityDirection || null)
    : (label === 'should_have_surfaced' || label === 'missed_context' ? (severityDirection || 'higher') : null);
  return {
    relevant: isRelevant,
    should_surface: label === 'should_have_surfaced' ? true : (isRelevant && !['false_positive'].includes(label)),
    category_id: ['wrong_category', 'missed_category'].includes(label) ? (newValue || null) : (categoryId || null),
    severity_direction: severity,
  };
}

export function agentsForFeedbackLabel(label, { previousDecision = null } = {}) {
  if (label === 'should_have_surfaced') {
    return previousDecision === 'rejected_irrelevant' ? ['relevance', 'severity'] : ['severity', 'relevance'];
  }
  if (['wrong_category', 'missed_category'].includes(label)) return ['category'];
  if (['wrong_severity', 'missed_context', 'false_positive'].includes(label)) return ['severity', 'relevance'];
  if (NEGATIVE_LABELS.has(label)) return ['relevance'];
  if (POSITIVE_LABELS.has(label)) return ['relevance', 'severity'];
  return ['relevance'];
}

export function evaluationBucketForLabel(label) {
  if (NEGATIVE_LABELS.has(label)) return 'bad_signal';
  if (label === 'missed_context' || label === 'wrong_severity' || label === 'should_have_surfaced') return 'borderline';
  return 'good_signal';
}

async function createEvaluationCasesForFeedback({
  orgId,
  postId,
  feedbackId = null,
  eventId = null,
  agents,
  input,
  expected,
  bucket,
  notes = null,
  createdBy = null,
}) {
  const created = [];
  for (const agentName of agents) {
    try {
      const { rows: [row] } = await query(
        `INSERT INTO agent_evaluation_cases (org_id,post_id,agent_name,input,expected_output,bucket,notes,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id, agent_name`,
        [
          orgId,
          postId,
          agentName,
          JSON.stringify(input),
          JSON.stringify(expected),
          bucket,
          notes,
          createdBy,
        ]
      );
      if (row) created.push(row);
      if (feedbackId && eventId) {
        await recordLearningAction({
          orgId,
          feedbackId,
          eventId,
          agentName,
          actionType: 'evaluation_case',
          after: { case_id: row?.id || null, bucket, expected },
          reason: notes,
        });
      }
    } catch (err) {
      console.warn('[feedback] evaluation case skipped:', err.message);
    }
  }
  return created;
}

// Feedback can be incorporated immediately as a reviewed, organisation-scoped
// example. We retain the original prompt template: a single user label should
// never silently rewrite a production prompt.
async function addReviewedExample({ orgId, feedbackId, eventId, agentName, post, label, explanation, newValue, severityDirection, authorEmail }) {
  const config = await getOrganizationAgentConfig(orgId, agentName);
  const expected = expectedFromFeedback({ label, categoryId: post.category_id, newValue, severityDirection });
  const example = {
    source: 'user_feedback',
    feedback_id: feedbackId,
    event_id: eventId,
    input: {
      title: compactText(post.title, 300),
      body: compactText(post.body, 700),
      source: post.source || null,
    },
    expected,
    feedback: { label, reason: compactText(explanation, 400) || null },
  };
  const existing = Array.isArray(config.examples) ? config.examples : [];
  // A feedback edit keeps the same feedback ID. Replace its prior training
  // example rather than preserving stale label/reason text beside the revision.
  const existingWithoutThisFeedback = existing.filter(item => item?.feedback_id !== feedbackId);
  const fingerprint = `${label}:${example.input.title.toLowerCase()}:${expected.category_id || ''}:${expected.severity_direction || ''}`;
  const duplicate = existingWithoutThisFeedback.some(item => {
    const prior = item?.input || {};
    const priorExpected = item?.expected || {};
    return `${item?.feedback?.label || ''}:${String(prior.title || '').toLowerCase()}:${priorExpected.category_id || ''}:${priorExpected.severity_direction || ''}` === fingerprint;
  });

  if (duplicate) {
    await recordLearningAction({
      orgId, feedbackId, eventId, agentName, actionType: 'example_update', status: 'skipped',
      before: { example_count: existing.length }, after: { example_count: existingWithoutThisFeedback.length },
      reason: 'An equivalent reviewed feedback example already exists for this agent.',
    });
    return false;
  }

  const nextExamples = [example, ...existingWithoutThisFeedback].slice(0, 20);
  const saved = await saveOrganizationAgentConfig(
    orgId,
    agentName,
    { examples: nextExamples },
    authorEmail || 'spill-feedback-learning',
    `Feedback learning: added reviewed ${label || 'user'} example for event ${eventId}`
  );
  await recordLearningAction({
    orgId, feedbackId, eventId, agentName, actionType: 'example_update',
    before: { example_count: existing.length, config_version: config.version || 0 },
    after: { example_count: nextExamples.length, config_version: saved.version },
    reason: explanation || `Added a reviewed ${label || 'user'} feedback example.`,
  });
  return true;
}

// Threshold changes are deliberately aggregate-only. Three or more consistent
// corrections are required, a two-signal margin avoids ties, and the current
// aggregate signature prevents the same feedback set from changing it twice.
async function applyThresholdLearning({ orgId, feedbackId, eventId, agentName, explanation, authorEmail }) {
  if (agentName !== 'severity') return false;
  const { rows: [counts] } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE label='false_positive' OR (label='wrong_severity' AND severity_direction='lower'))::int AS over_count,
       COUNT(*) FILTER (
         WHERE label='missed_context'
            OR label='should_have_surfaced'
            OR (label='wrong_severity' AND severity_direction='higher')
       )::int AS under_count
     FROM post_feedback
     WHERE org_id=$1 AND created_at > NOW()-INTERVAL '60 days'`,
    [orgId]
  );
  const over = Number(counts?.over_count || 0);
  const under = Number(counts?.under_count || 0);
  const direction = over >= under + 2 && over >= 3 ? 'raise'
    : under >= over + 2 && under >= 3 ? 'lower'
      : null;
  if (!direction) return false;

  const config = await getOrganizationAgentConfig(orgId, 'severity');
  const rules = config.escalation_rules && typeof config.escalation_rules === 'object' ? config.escalation_rules : {};
  const signature = `${over}:${under}:${direction}`;
  if (rules.feedback_learning_signature === signature) return false;
  const baseline = Math.max(35, Math.min(85, Number(rules.escalation_threshold ?? (parseInt(process.env.ESCALATE_THRESHOLD, 10) || 60))));
  const nextThreshold = Math.max(35, Math.min(85, baseline + (direction === 'raise' ? 5 : -5)));
  if (nextThreshold === baseline) return false;

  const saved = await saveOrganizationAgentConfig(
    orgId,
    'severity',
    { escalation_rules: { ...rules, escalation_threshold: nextThreshold, feedback_learning_signature: signature, feedback_learning_updated_at: new Date().toISOString() } },
    authorEmail || 'spill-feedback-learning',
    `Feedback learning: ${direction === 'raise' ? 'raised' : 'lowered'} escalation threshold after ${over} over-escalation and ${under} under-escalation signals`
  );
  await recordLearningAction({
    orgId, feedbackId, eventId, agentName: 'severity', actionType: 'threshold_adjustment',
    before: { escalation_threshold: baseline, over_count: over, under_count: under, config_version: config.version || 0 },
    after: { escalation_threshold: nextThreshold, over_count: over, under_count: under, config_version: saved.version },
    reason: explanation || `Aggregate feedback ${direction === 'raise' ? 'indicated over-escalation' : 'indicated under-escalation'}.`,
  });
  return true;
}

// Applies the synchronous learning path for one submitted feedback record.
// The asynchronous intelligence compiler still turns the wider 60-day corpus
// into concise terms and category policy; this function makes the correction
// useful to the next execution immediately.
export async function applyFeedbackLearning({ orgId, feedbackId, eventId, agentName, post, label, explanation, newValue = null, severityDirection = null, authorEmail = null }) {
  const result = { prompt_context: false, example_update: false, threshold_adjustment: false, assessment: [], recommendation: null };
  try {
    invalidateOrganizationAgentBriefing(orgId);
    result.assessment = await syncFeedbackAssessment({
      orgId, eventId, traceId: post.ai_trace_id || null, postId: post.id || null,
      feedbackId, agentName, label, reason: explanation,
    });
    result.recommendation = await syncImprovementRecommendation({ orgId, feedbackId, eventId, agentName, label, reason: explanation });
    await recordLearningAction({
      orgId, feedbackId, eventId, agentName, actionType: 'prompt_context',
      before: {}, after: { injected_by: 'getOrgFeedbackContext', label },
      reason: explanation || `Feedback is available as organisation-scoped prompt context for ${agentName}.`,
    });
    result.prompt_context = true;
    result.example_update = await addReviewedExample({ orgId, feedbackId, eventId, agentName, post, label, explanation, newValue, severityDirection, authorEmail });
    result.threshold_adjustment = await applyThresholdLearning({ orgId, feedbackId, eventId, agentName, explanation, authorEmail });
  } catch (err) {
    console.warn('[feedback] immediate learning action failed:', err.message);
    try {
      await recordLearningAction({ orgId, feedbackId, eventId, agentName, actionType: 'prompt_context', status: 'failed', reason: err.message });
    } catch {}
  }
  return result;
}

// Shared orchestration for labelled feedback: evaluation cases + immediate
// reviewed examples + assessments/recommendations across the agents that own
// the correction. Optionally force an intelligence recompile.
export async function orchestrateFeedbackLearning({
  orgId,
  feedbackId,
  eventId,
  post,
  label,
  explanation = null,
  newValue = null,
  severityDirection = null,
  authorEmail = null,
  agents = null,
  previousDecision = null,
  forceIntel = false,
  evalInputExtra = null,
}) {
  const agentList = agents || agentsForFeedbackLabel(label, { previousDecision });
  const expected = {
    ...expectedFromFeedback({
      label,
      categoryId: post.category_id,
      newValue,
      severityDirection,
    }),
    previous_decision: previousDecision || null,
  };
  const evalInput = {
    title: compactText(post.title, 300),
    body: compactText(post.body, 700),
    source: post.source || null,
    ...(evalInputExtra && typeof evalInputExtra === 'object' ? evalInputExtra : {}),
  };
  const bucket = label === 'should_have_surfaced' ? 'good_signal' : evaluationBucketForLabel(label);

  const evaluationCases = await createEvaluationCasesForFeedback({
    orgId,
    postId: post.id,
    feedbackId,
    eventId,
    agents: agentList,
    input: evalInput,
    expected,
    bucket,
    notes: compactText(explanation, 1000) || null,
    createdBy: authorEmail || 'spill-feedback-learning',
  });

  const learningByAgent = {};
  for (const agentName of agentList) {
    learningByAgent[agentName] = await applyFeedbackLearning({
      orgId,
      feedbackId,
      eventId,
      agentName,
      post,
      label,
      explanation,
      newValue,
      severityDirection,
      authorEmail,
    });
  }

  // Positive surface feedback also writes hard keep policy (dashboard feedback path)
  let hard_policy = null;
  if (label === 'should_have_surfaced' || label === 'missed_context' || label === 'high_signal' || label === 'useful') {
    hard_policy = await absorbFeedbackIntoKeepPolicy({
      orgId,
      post,
      label,
      explanation,
      authorEmail,
      feedbackId,
      eventId,
    }).catch((err) => ({ applied: false, reason: err.message }));
  }

  if (forceIntel) {
    await updateOrgIntelligence(orgId, { force: true }).catch((err) => {
      console.warn('[feedback] intelligence compile skipped:', err.message);
    });
  }

  return {
    feedback_id: feedbackId,
    label,
    agents: agentList,
    evaluation_cases: evaluationCases,
    learning_by_agent: learningByAgent,
    hard_policy,
  };
}

// Operator overrides are a strong supervised signal: Spill wrongly rejected or
// suppressed a candidate that should appear on the dashboard. This orchestrates
// immediate learning for the relevant agents, evaluation-case creation, and a
// forced intelligence recompile so the next refresh can use the correction.
//
// Critical: soft few-shot alone is not enough (models still reject brand monikers).
// We also write deterministic learnedKeepRules into intel_profile so policy
// always surfaces matching third-party brand posts without asking the LLM.
export async function orchestrateOverrideLearning({
  orgId,
  post,
  traceId = null,
  eventId = null,
  previousDecision = null,
  note = '',
  authorEmail = null,
}) {
  const explanation = compactText(
    note || `Operator override: previously ${previousDecision || 'rejected/suppressed'}; forced onto dashboard.`,
    1000
  );
  const stableEventId = eventId || post?.id;
  const label = 'should_have_surfaced';
  const agents = agentsForFeedbackLabel(label, { previousDecision });
  const resultingAdjustment = previousDecision === 'rejected_irrelevant'
    ? 'override surfaced rejected candidate; relevance/quality examples + keep rules updated'
    : 'override surfaced suppressed candidate; quality/relevance examples + keep rules updated';

  const { rows: [feedback] } = await query(
    `INSERT INTO post_feedback (
       org_id, post_id, event_id, label, explanation, resulting_adjustment,
       agent_name, trace_id, created_by, signal_type
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'explicit')
     RETURNING *`,
    [
      orgId,
      post.id,
      stableEventId,
      label,
      explanation,
      resultingAdjustment,
      agents[0],
      traceId || post.ai_trace_id || null,
      authorEmail || 'internal-operator',
    ]
  );

  // Hard deterministic learning first — survives LLM stubbornness and DB prune.
  const hardLearning = await absorbFeedbackIntoKeepPolicy({
    orgId,
    post,
    label,
    explanation,
    authorEmail: authorEmail || 'internal-operator',
    feedbackId: feedback.id,
    eventId: stableEventId,
  });

  const learning = await orchestrateFeedbackLearning({
    orgId,
    feedbackId: feedback.id,
    eventId: stableEventId,
    post: { ...post, ai_trace_id: traceId || post.ai_trace_id || null },
    label,
    explanation,
    severityDirection: 'higher',
    authorEmail: authorEmail || 'internal-operator',
    agents,
    previousDecision,
    forceIntel: true,
    evalInputExtra: { override_note: explanation },
  });

  return {
    ...learning,
    hard_policy: hardLearning,
    explanation,
    resulting_adjustment: resultingAdjustment,
  };
}

/**
 * Persist a deterministic keep rule + relevance priority line from feedback/override
 * so the next pipeline run cannot re-reject the same (or similar) brand mention.
 */
export async function absorbFeedbackIntoKeepPolicy({
  orgId,
  post,
  label,
  explanation = '',
  authorEmail = null,
  feedbackId = null,
  eventId = null,
}) {
  if (!orgId || !post) return { applied: false, reason: 'missing org or post' };
  if (NEGATIVE_LABELS.has(label)) return { applied: false, reason: 'negative label skips keep policy' };
  if (!POSITIVE_LABELS.has(label) && label !== 'should_have_surfaced') {
    return { applied: false, reason: 'label not a surface signal' };
  }

  const { rows: [orgRow] } = await query(
    'SELECT id, name, website, intel_profile FROM organizations WHERE id=$1',
    [orgId]
  );
  if (!orgRow) return { applied: false, reason: 'org not found' };

  const intel = { ...(orgRow.intel_profile || {}) };
  const rule = buildKeepRuleFromPost({
    post,
    org: orgRow,
    note: explanation,
  });
  rule.feedback_id = feedbackId || null;

  const existing = Array.isArray(intel.learnedKeepRules) ? intel.learnedKeepRules : [];
  // Dedupe by exact_title + moniker fingerprint
  const fingerprint = `${String(rule.exact_title || '').toLowerCase()}|${rule.moniker || ''}|${(rule.requires || []).join(',')}`;
  const withoutDup = existing.filter((item) => {
    const fp = `${String(item.exact_title || '').toLowerCase()}|${item.moniker || ''}|${(item.requires || []).join(',')}`;
    return fp !== fingerprint;
  });
  const nextRules = [rule, ...withoutDup].slice(0, 40);

  const boosts = new Set((intel.boostTerms || []).map(t => String(t).toLowerCase()));
  if (rule.phrase) boosts.add(rule.phrase);
  if (rule.moniker && rule.requires?.length) boosts.add(`${rule.moniker} (${rule.requires.slice(0, 3).join('/')})`);
  const moniker = primaryBrandMoniker(orgRow.name);
  if (moniker) boosts.add(moniker);

  const nextIntel = {
    ...intel,
    learnedKeepRules: nextRules,
    boostTerms: [...boosts].slice(0, 20),
    feedbackUpdatedAt: new Date().toISOString(),
  };

  await query(
    'UPDATE organizations SET intel_profile=$1, updated_at=NOW() WHERE id=$2',
    [JSON.stringify(nextIntel), orgId]
  );

  // Strengthen relevance agent priority_instructions with a durable policy line
  const config = await getOrganizationAgentConfig(orgId, 'relevance');
  const keepLine = `OVERRIDE-LEARNED KEEP: treat posts like "${compactText(post.title, 80)}" (and similar ${moniker || 'brand'} + admissions/aviation context) as relevant. Operator said: ${compactText(explanation, 160)}`;
  let priority = String(config.priority_instructions || '').trim();
  if (!priority.includes(compactText(post.title, 60))) {
    priority = [keepLine, priority].filter(Boolean).join('\n').slice(0, 8000);
    await saveOrganizationAgentConfig(
      orgId,
      'relevance',
      { priority_instructions: priority },
      authorEmail || 'spill-feedback-learning',
      `Override learning: keep rule for "${compactText(post.title, 80)}"`
    );
  }

  if (feedbackId && eventId) {
    await recordLearningAction({
      orgId,
      feedbackId,
      eventId,
      agentName: 'relevance',
      actionType: 'keep_rule',
      before: { keep_rule_count: existing.length },
      after: { keep_rule_count: nextRules.length, rule },
      reason: explanation || 'Wrote deterministic keep rule from operator override.',
    }).catch(() => {});
  }

  invalidateOrganizationAgentBriefing(orgId);
  return {
    applied: true,
    keep_rule: rule,
    keep_rule_count: nextRules.length,
    boost_terms: nextIntel.boostTerms,
  };
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

    // Always inject a brand keep rule first so soft few-shot can't override it.
    lines.unshift(
      'ALWAYS KEEP: third-party posts that name this organisation (full brand, short moniker with admissions/training/aviation context, programme codes, or product names). Never mark those is_relevant=false. Church-bell/homonym uses of a moniker without industry context stay excluded.'
    );

    if (Array.isArray(intel.learnedKeepRules) && intel.learnedKeepRules.length) {
      const keepBrief = intel.learnedKeepRules.slice(0, 8).map((r) => {
        const bits = [r.exact_title ? `title~"${String(r.exact_title).slice(0, 40)}"` : null, r.moniker, (r.requires || []).slice(0, 3).join('+')].filter(Boolean);
        return bits.join(' / ');
      }).filter(Boolean);
      if (keepBrief.length) lines.push(`Hard keep rules from operator overrides: ${keepBrief.join('; ')}`);
    }

    if (!feedbackResult.rows.length) return lines.join('\n');

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

    return lines.join('\n');
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
    const missedContextRows = feedbackResult.rows.filter(r =>
      r.label === 'missed_context' || r.label === 'should_have_surfaced'
    );

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
        const prefix = r.label === 'should_have_surfaced' ? '[should have surfaced] '
          : r.label === 'missed_context' ? '[missed context] '
            : r.label === 'wrong_severity' ? '[under-escalated] '
              : '';
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
      : [];
    // Preserve operator-learned boosts / moniker hints (replace would wipe override learning)
    const keepBoosts = [
      ...(intel.boostTerms || []),
      ...((intel.learnedKeepRules || []).flatMap(r => [r.phrase, r.moniker].filter(Boolean))),
    ].map(t => String(t).toLowerCase().trim()).filter(t => t.length >= 3);
    const mergedBoosts = [...new Set([...newBoosts, ...keepBoosts])].slice(0, 20);

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
          // Keep the aggregate category refinement explainable. The action is
          // linked to the most recent supporting feedback event where possible.
          const { rows: [supportingFeedback] } = await query(
            `SELECT f.id, f.event_id, f.explanation
             FROM post_feedback f
             JOIN posts p ON p.id = f.post_id
             WHERE f.org_id=$1 AND p.category_id=$2
             ORDER BY f.created_at DESC LIMIT 1`,
            [orgId, cat.id]
          ).catch(() => ({ rows: [] }));
          if (supportingFeedback?.event_id) {
            await recordLearningAction({
              orgId,
              feedbackId: supportingFeedback.id,
              eventId: supportingFeedback.event_id,
              agentName: 'category',
              actionType: 'category_refinement',
              before: { category_id: cat.id, category_name: cat.name, severity: cat.severity || 0 },
              after: { category_id: cat.id, category_name: cat.name, severity: newSeverity, signal },
              reason: supportingFeedback.explanation || `Aggregate category feedback signalled ${signal} severity.`,
            }).catch(() => {});
          }
        }
      }
    }

    await query(
      `UPDATE organizations SET intel_profile = COALESCE(intel_profile, '{}')::jsonb || $1::jsonb WHERE id = $2`,
      [JSON.stringify({
        exclusionTerms: newExclusions,
        boostTerms: mergedBoosts,
        typicalComplaints: newTypicalComplaints,
        overEscalationPatterns,
        underEscalationPatterns,
        feedbackUpdatedAt: new Date().toISOString(),
      }), orgId]
    );

    console.log(`[feedback] org ${orgId} intelligence updated — exclusions: [${newExclusions.join(', ')}] | boosts: [${mergedBoosts.join(', ')}] | complaints: [${newTypicalComplaints.slice(0, 3).join(', ')}] | over-escalation: [${overEscalationPatterns.slice(0, 2).join(', ')}]`);
  } catch (err) {
    console.warn('[feedback] intelligence update failed:', err.message);
  }
}

// Replays historical labelled feedback through the same immediate learning path
// used by new submissions: reviewed examples, evaluation cases, assessments,
// and one forced intelligence recompile per organisation.
export async function backfillFeedbackLearning({ orgId = null, limit = null, skipLearned = true } = {}) {
  const params = [];
  const filters = ['f.label IS NOT NULL'];
  if (orgId) {
    params.push(orgId);
    filters.push(`f.org_id = $${params.length}`);
  }
  let limitSql = '';
  if (limit) {
    params.push(limit);
    limitSql = `LIMIT $${params.length}`;
  }

  const { rows } = await query(
    `SELECT
       f.id AS feedback_id,
       f.org_id,
       f.post_id,
       f.event_id,
       f.label,
       f.explanation,
       f.new_value,
       f.severity_direction,
       f.created_by,
       f.agent_name,
       p.id AS resolved_post_id,
       p.title,
       p.body,
       p.source,
       p.category_id,
       p.escalation_score,
       p.escalated,
       p.ai_trace_id
     FROM post_feedback f
     LEFT JOIN posts p ON p.id = f.post_id AND p.org_id = f.org_id
     WHERE ${filters.join(' AND ')}
     ORDER BY f.org_id ASC, f.created_at ASC
     ${limitSql}`,
    params
  );

  const summary = {
    scanned: rows.length,
    processed: 0,
    skipped_learned: 0,
    skipped_no_post: 0,
    failed: 0,
    orgs: {},
  };

  const touchedOrgs = new Set();

  for (const row of rows) {
    const orgBucket = summary.orgs[row.org_id] || (summary.orgs[row.org_id] = {
      processed: 0, skipped_learned: 0, skipped_no_post: 0, failed: 0,
    });

    if (!row.resolved_post_id) {
      summary.skipped_no_post += 1;
      orgBucket.skipped_no_post += 1;
      continue;
    }

    if (skipLearned) {
      const { rows: existing } = await query(
        `SELECT 1 FROM feedback_learning_actions
         WHERE feedback_id = $1 AND action_type = 'example_update' AND status = 'applied'
         LIMIT 1`,
        [row.feedback_id]
      );
      if (existing.length) {
        summary.skipped_learned += 1;
        orgBucket.skipped_learned += 1;
        continue;
      }
    }

    const post = {
      id: row.resolved_post_id,
      title: row.title,
      body: row.body,
      source: row.source,
      category_id: row.category_id,
      escalation_score: row.escalation_score,
      escalated: row.escalated,
      ai_trace_id: row.ai_trace_id,
    };
    const eventId = row.event_id || row.resolved_post_id;

    try {
      await orchestrateFeedbackLearning({
        orgId: row.org_id,
        feedbackId: row.feedback_id,
        eventId,
        post,
        label: row.label,
        explanation: row.explanation,
        newValue: row.new_value,
        severityDirection: row.severity_direction,
        authorEmail: row.created_by || 'feedback-backfill',
        agents: agentsForFeedbackLabel(row.label),
        forceIntel: false,
      });
      summary.processed += 1;
      orgBucket.processed += 1;
      touchedOrgs.add(row.org_id);
    } catch (err) {
      console.warn(`[feedback-backfill] feedback ${row.feedback_id} failed:`, err.message);
      summary.failed += 1;
      orgBucket.failed += 1;
    }
  }

  for (const id of touchedOrgs) {
    await updateOrgIntelligence(id, { force: true }).catch((err) => {
      console.warn(`[feedback-backfill] intel compile failed for ${id}:`, err.message);
    });
  }

  summary.orgs_recompiled = [...touchedOrgs];
  return summary;
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
