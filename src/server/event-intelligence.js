import { query } from './db.js';

const NEGATIVE_RELEVANCE = new Set(['not_relevant', 'wrong_geography', 'unrelated_complaint', 'too_generic', 'duplicate']);

function compact(value, max = 1000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function assessmentDefinitions(label, agentName) {
  const reason = `Customer feedback: ${String(label || 'unlabelled').replace(/_/g, ' ')}`;
  if (NEGATIVE_RELEVANCE.has(label)) return [
    { agentName: 'relevance', scope: 'agent_output', verdict: 'incorrect', reason },
    { agentName: 'surface_decision', scope: 'surface_decision', verdict: 'incorrect', reason },
  ];
  if (label === 'false_positive') return [
    { agentName: 'severity', scope: 'agent_output', verdict: 'incorrect', reason },
    { agentName: 'surface_decision', scope: 'surface_decision', verdict: 'incorrect', reason },
  ];
  if (label === 'wrong_category' || label === 'missed_category') return [
    { agentName: 'category', scope: 'agent_output', verdict: 'incorrect', reason },
  ];
  if (label === 'wrong_severity' || label === 'missed_context') return [
    { agentName: 'severity', scope: 'agent_output', verdict: 'incorrect', reason },
  ];
  if (label === 'useful' || label === 'high_signal' || label === 'saved' || label === 'good_match') return [
    { agentName: agentName || 'relevance', scope: 'agent_output', verdict: 'correct', reason },
    { agentName: 'surface_decision', scope: 'surface_decision', verdict: 'correct', reason },
  ];
  return [{ agentName: agentName || 'relevance', scope: 'agent_output', verdict: 'unknown', reason }];
}

function recommendationFor(label, agentName) {
  if (NEGATIVE_RELEVANCE.has(label)) return {
    agentName: 'relevance', key: 'tighten_relevance', priority: 'high',
    text: 'Tighten the organisation relevance boundary with the reviewed exclusions and examples; require a direct company or approved operational-intelligence connection before surfacing.',
  };
  if (label === 'false_positive' || label === 'wrong_severity' || label === 'missed_context') return {
    agentName: 'severity', key: 'calibrate_escalation', priority: 'high',
    text: 'Calibrate escalation using reviewed severity examples and the organisation threshold controller; change the threshold only after a consistent aggregate pattern.',
  };
  if (label === 'wrong_category' || label === 'missed_category') return {
    agentName: 'category', key: 'refine_category_policy', priority: 'medium',
    text: 'Add the corrected category as a reviewed example and refine category descriptions or severity only when the same correction pattern repeats.',
  };
  if (label === 'useful' || label === 'high_signal' || label === 'saved') return {
    agentName: agentName || 'relevance', key: 'reinforce_high_signal', priority: 'low',
    text: 'Retain this reviewed high-signal example so similar organisation-specific complaints are prioritised without broadening the policy beyond the evidence.',
  };
  return null;
}

// A feedback record is the source of truth. These rows make the resulting
// correctness answer queryable by event and agent without inferring it from UI
// labels every time a trace is inspected.
export async function syncFeedbackAssessment({ orgId, eventId, traceId = null, postId = null, feedbackId, agentName, label, reason = null }) {
  const definitions = assessmentDefinitions(label, agentName);
  await Promise.all(definitions.map(definition => query(
    `INSERT INTO agent_event_assessments
       (org_id,event_id,trace_id,post_id,feedback_id,agent_name,assessment_scope,verdict,reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (feedback_id,agent_name,assessment_scope) DO UPDATE
       SET event_id=EXCLUDED.event_id,trace_id=EXCLUDED.trace_id,post_id=EXCLUDED.post_id,
           verdict=EXCLUDED.verdict,reason=EXCLUDED.reason,updated_at=NOW()`,
    [orgId, eventId, traceId, postId, feedbackId, definition.agentName, definition.scope, definition.verdict, compact(reason || definition.reason)]
  )));
  return definitions;
}

export async function syncImprovementRecommendation({ orgId, feedbackId, eventId, agentName, label, reason = null }) {
  const recommendation = recommendationFor(label, agentName);
  if (!recommendation) return null;
  const evidence = { event_id: eventId, feedback_id: feedbackId, label, reason: compact(reason, 500) || null };
  const { rows: [saved] } = await query(
    `INSERT INTO agent_improvement_recommendations
       (org_id,agent_name,recommendation_key,priority,status,recommendation,evidence,source_feedback_id)
     VALUES ($1,$2,$3,$4,'open',$5,$6,$7)
     ON CONFLICT (org_id,agent_name,recommendation_key) DO UPDATE
       SET priority=EXCLUDED.priority,status='open',recommendation=EXCLUDED.recommendation,
           evidence=EXCLUDED.evidence,source_feedback_id=EXCLUDED.source_feedback_id,updated_at=NOW()
     RETURNING *`,
    [orgId, recommendation.agentName, recommendation.key, recommendation.priority, recommendation.text, JSON.stringify(evidence), feedbackId]
  );
  return saved;
}

export async function getEventAssessmentSummary({ orgId, eventId }) {
  const { rows } = await query(
    `SELECT agent_name,assessment_scope,verdict,reason,created_at
     FROM agent_event_assessments
     WHERE org_id=$1 AND event_id=$2
     ORDER BY created_at DESC`,
    [orgId, eventId]
  );
  const surface = rows.find(row => row.assessment_scope === 'surface_decision') || null;
  const byAgent = {};
  for (const row of rows) {
    if (row.assessment_scope === 'agent_output' && !byAgent[row.agent_name]) byAgent[row.agent_name] = row;
  }
  return {
    review_status: rows.length ? 'reviewed' : 'unreviewed',
    surface_decision: surface ? { verdict: surface.verdict, reason: surface.reason, reviewed_at: surface.created_at } : { verdict: 'unknown', reason: 'No customer feedback has reviewed this event yet.', reviewed_at: null },
    agents: byAgent,
  };
}

function promptFor(observation) {
  const snapshot = observation.prompt_snapshot || {};
  const input = observation.input || {};
  return {
    id: snapshot.id || input.prompt_id || null,
    key: observation.prompt_key || snapshot.key || null,
    version: observation.prompt_version ?? snapshot.version ?? null,
    hash: snapshot.hash || input.prompt_hash || null,
  };
}

function agentSummary(observation) {
  return {
    name: observation.name,
    kind: observation.kind,
    model: observation.model,
    prompt: promptFor(observation),
    output: observation.output || {},
    latency_ms: observation.latency_ms,
    input_tokens: observation.input_tokens,
    output_tokens: observation.output_tokens,
    error: observation.error || null,
  };
}

// This is the single server-side explanation contract used by the internal
// trace explorer. It deliberately relies on persisted trace snapshots rather
// than current prompts/configuration, so historical answers stay reproducible.
export async function explainTrace({ trace, observations }) {
  const relevance = observations.find(item => item.prompt_key === 'relevance' || /relevance/i.test(item.name || ''));
  const category = observations.find(item => item.prompt_key === 'category' || /category/i.test(item.name || ''));
  const severity = observations.find(item => item.prompt_key === 'severity' || /severity/i.test(item.name || ''));
  const quality = observations.find(item => /signal quality/i.test(item.name || ''));
  const evidence = trace.decision_evidence || {};
  const decision = trace.decision || quality?.output?.decision || 'unknown';
  const lines = [];
  if (relevance) lines.push(`Relevance: ${relevance.output?.is_relevant === false ? 'excluded' : 'accepted'} via ${relevance.input?.tier || 'recorded policy'}.`);
  if (category?.output?.category) lines.push(`Category: ${category.output.category}${category.output.confidence != null ? ` (${Math.round(Number(category.output.confidence) * 100)}% confidence)` : ''}.`);
  if (severity?.output?.escalation_score != null) lines.push(`Escalation score: ${severity.output.escalation_score}${severity.output.escalated ? ' (escalated)' : ''}.`);
  if (quality?.output?.score != null) lines.push(`Signal quality: ${quality.output.score}/${quality.input?.threshold ?? 0} threshold.`);
  if (!lines.length) lines.push('The trace has no agent observations yet; inspect the stored source and decision metadata.');
  const [correctness, improvementsResult] = await Promise.all([
    getEventAssessmentSummary({ orgId: trace.org_id, eventId: trace.event_id }),
    query(`SELECT agent_name,recommendation_key,priority,status,recommendation,evidence,updated_at
           FROM agent_improvement_recommendations
           WHERE org_id=$1 AND status IN ('open','applied')
           ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, updated_at DESC
           LIMIT 20`, [trace.org_id]),
  ]);
  return {
    question_answers: {
      why_surfaced: { decision, explanation: lines.join(' '), evidence },
      deciding_agents: observations.map(agentSummary),
      prompt_versions: observations.map(observation => ({ agent: observation.name, ...promptFor(observation) })).filter(item => item.id || item.version != null),
      correctness,
      how_to_improve: improvementsResult.rows,
    },
  };
}
