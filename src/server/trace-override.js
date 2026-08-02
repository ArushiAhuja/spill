import { query } from './db.js';
import { linkTraceToPost, recordTraceObservation } from './observability.js';
import { syncFeedbackAssessment, syncImprovementRecommendation } from './event-intelligence.js';

export function extractCandidateFromTrace(trace, observations = []) {
  const meta = trace?.metadata || {};
  let raw = null;
  for (const observation of observations) {
    const input = observation?.input || {};
    const candidate = input.raw_post || input.post || input.signal || input.candidate || null;
    if (candidate && typeof candidate === 'object') {
      raw = candidate;
      break;
    }
  }
  if (!raw) {
    for (const observation of observations) {
      const input = observation?.input || {};
      if (input.body || input.text || input.content || input.title) {
        raw = input;
        break;
      }
    }
  }
  raw = raw || {};
  const title = trace?.title || meta.title || raw.title || raw.headline || 'Operator-surfaced signal';
  const body = trace?.body || meta.body || meta.text || raw.body || raw.text || raw.content || raw.description || '';
  const url = trace?.url || meta.url || raw.url || raw.link || null;
  const author = meta.author || raw.author || null;
  const engagement = Number(meta.engagement ?? raw.engagement ?? raw.score ?? 0) || 0;
  const externalId = meta.external_id || raw.external_id || raw.id || `override-${trace.id}`;
  return {
    title: String(title).slice(0, 500),
    body: String(body).slice(0, 20000),
    url,
    author,
    engagement,
    external_id: String(externalId).slice(0, 500),
    source: trace.source || meta.source || 'manual_override',
  };
}

export function buildRejectionSummary(trace, observations = []) {
  const evidence = trace.decision_evidence || {};
  const decision = trace.decision || 'unknown';
  const relevanceObs = observations.find(item => item.prompt_key === 'relevance' || /relevance/i.test(item.name || ''));
  const qualityObs = observations.find(item => /signal quality/i.test(item.name || ''));
  const categoryObs = observations.find(item => item.prompt_key === 'category' || /category/i.test(item.name || ''));

  const lines = [];
  if (decision === 'rejected_irrelevant') {
    lines.push('Spill rejected this candidate as irrelevant to the organisation.');
  } else if (String(decision).startsWith('suppressed')) {
    lines.push('Spill suppressed this candidate below the signal-quality threshold.');
  } else if (decision === 'surfaced' || decision === 'surfaced_override') {
    lines.push(decision === 'surfaced_override'
      ? 'An operator overrode Spill and forced this candidate onto the dashboard.'
      : 'Spill surfaced this candidate onto the organisation dashboard.');
  } else {
    lines.push(`Spill decision: ${decision}.`);
  }

  const relevance = evidence.relevance || {};
  if (relevance.is_relevant === false) {
    lines.push(`Relevance gate: not relevant${relevance.tier ? ` (${relevance.tier})` : ''}.`);
  } else if (relevance.tier) {
    lines.push(`Relevance tier: ${relevance.tier}.`);
  } else if (relevanceObs?.output?.is_relevant === false) {
    lines.push('Relevance agent marked the candidate as not relevant.');
  }

  const qualityGate = evidence.quality_gate || qualityObs?.output || {};
  if (qualityGate.score != null && qualityGate.threshold != null) {
    lines.push(`Quality score ${qualityGate.score}/${qualityGate.threshold} threshold.`);
  }

  const category = evidence.category || {};
  if (category.reasoning) lines.push(`Classifier reasoning: ${category.reasoning}`);
  else if (categoryObs?.output?.reasoning) lines.push(`Classifier reasoning: ${categoryObs.output.reasoning}`);
  if (category.name) lines.push(`Suggested category: ${category.name}.`);

  return {
    decision,
    summary: lines.join(' '),
    lines,
    relevance,
    quality_gate: qualityGate,
    category,
    evidence,
  };
}

export async function overrideTraceToDashboard({ traceId, user, note = '' }) {
  const { rows: traces } = await query(
    `SELECT t.*, o.name AS org_name, o.slug AS org_slug
     FROM ai_traces t
     JOIN organizations o ON o.id = t.org_id
     WHERE t.id::text = $1 OR t.trace_key = $1`,
    [traceId]
  );
  const trace = traces[0];
  if (!trace) {
    const err = new Error('trace not found');
    err.status = 404;
    throw err;
  }

  const { rows: observations } = await query(
    'SELECT * FROM ai_observations WHERE trace_id=$1 ORDER BY created_at',
    [trace.id]
  );
  const candidate = extractCandidateFromTrace(trace, observations);
  if (!candidate.title && !candidate.body) {
    const err = new Error('trace has no recoverable source content to surface');
    err.status = 400;
    throw err;
  }

  const overrideNote = String(note || '').trim().slice(0, 1000);
  const reasoning = [
    'Operator override: forced onto dashboard from internal intelligence.',
    overrideNote ? `Note: ${overrideNote}` : null,
    trace.decision_evidence?.category?.reasoning || null,
  ].filter(Boolean).join(' ');

  let postId = trace.post_id;
  if (postId) {
    await query(
      `UPDATE posts SET
         title = COALESCE(NULLIF($2,''), title),
         body = COALESCE(NULLIF($3,''), body),
         url = COALESCE($4, url),
         author = COALESCE($5, author),
         reasoning = $6,
         escalated = true,
         manually_escalated = true,
         reviewed = true,
         post_status = COALESCE(NULLIF(post_status,''), 'unread'),
         dismiss_reason = NULL,
         snoozed_until = NULL,
         saved_at = COALESCE(saved_at, NOW()),
         ai_trace_id = $7,
         signal_quality = COALESCE(signal_quality, $8::jsonb)
       WHERE id = $1 AND org_id = $9`,
      [
        postId,
        candidate.title,
        candidate.body,
        candidate.url,
        candidate.author,
        reasoning,
        trace.id,
        JSON.stringify(trace.quality || { score: 100, relevance: 1, confidence: 1, impact: 1, novelty: 1 }),
        trace.org_id,
      ]
    );
  } else {
    const { rows: [inserted] } = await query(
      `INSERT INTO posts (
         org_id, source, external_id, title, body, author, url, raw_engagement,
         escalation_score, category_id, sentiment_intensity, reasoning, escalated,
         post_created_at, manually_escalated, reviewed, ai_trace_id, signal_quality, notes
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,
         $9,$10,$11,$12,true,
         NOW(), true, true, $13, $14, $15
       )
       ON CONFLICT (org_id, source, external_id) DO UPDATE SET
         title = EXCLUDED.title,
         body = EXCLUDED.body,
         url = COALESCE(EXCLUDED.url, posts.url),
         author = COALESCE(EXCLUDED.author, posts.author),
         reasoning = EXCLUDED.reasoning,
         escalated = true,
         manually_escalated = true,
         reviewed = true,
         post_status = CASE WHEN posts.post_status IN ('archived','dismissed') THEN 'unread' ELSE COALESCE(posts.post_status, 'unread') END,
         dismiss_reason = NULL,
         snoozed_until = NULL,
         ai_trace_id = EXCLUDED.ai_trace_id,
         signal_quality = EXCLUDED.signal_quality,
         notes = EXCLUDED.notes
       RETURNING id`,
      [
        trace.org_id,
        candidate.source,
        candidate.external_id,
        candidate.title,
        candidate.body,
        candidate.author,
        candidate.url,
        candidate.engagement,
        Math.max(Number(trace.decision_evidence?.severity?.escalation_score) || 0, 60),
        trace.decision_evidence?.category?.id || null,
        0,
        reasoning,
        trace.id,
        JSON.stringify(trace.quality || { score: 100, relevance: 1, confidence: 1, impact: 1, novelty: 1 }),
        overrideNote ? `Override note: ${overrideNote}` : 'Surfaced by operator override from internal intelligence',
      ]
    );
    postId = inserted.id;
    await linkTraceToPost(trace.id, postId);
  }

  const previousDecision = trace.decision;
  const decisionEvidence = {
    ...(trace.decision_evidence || {}),
    override: {
      at: new Date().toISOString(),
      by_user_id: user?.id || null,
      by_email: user?.email || null,
      previous_decision: previousDecision,
      note: overrideNote || null,
    },
  };

  await query(
    `UPDATE ai_traces
     SET decision = 'surfaced_override',
         post_id = $2,
         decision_evidence = $3,
         metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb,
         status = 'completed',
         completed_at = NOW()
     WHERE id = $1`,
    [
      trace.id,
      postId,
      JSON.stringify(decisionEvidence),
      JSON.stringify({
        title: candidate.title,
        body: candidate.body,
        url: candidate.url,
        author: candidate.author,
        external_id: candidate.external_id,
        overridden: true,
      }),
    ]
  );

  await recordTraceObservation(trace.id, {
    name: 'Operator Override',
    kind: 'event',
    model: 'human-operator',
    promptKey: null,
    input: {
      previous_decision: previousDecision,
      note: overrideNote || null,
      operator: { id: user?.id || null, email: user?.email || null },
    },
    output: {
      decision: 'surfaced_override',
      post_id: postId,
      dashboard_path: `/${trace.org_slug}`,
    },
  });

  // Treat override as labelled feedback that the original reject/suppress was wrong.
  try {
    const eventId = trace.event_id || postId;
    const { rows: [feedback] } = await query(
      `INSERT INTO post_feedback (org_id, post_id, label, explanation, trace_id, event_id, agent_name, created_by, signal_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'explicit')
       RETURNING id`,
      [
        trace.org_id,
        postId,
        previousDecision === 'rejected_irrelevant' ? 'missed_context' : 'useful',
        overrideNote || 'Operator overrode rejected/suppressed candidate onto dashboard',
        trace.id,
        eventId,
        previousDecision === 'rejected_irrelevant' ? 'relevance' : 'severity',
        user?.email || user?.id || 'internal-operator',
      ]
    );
    if (feedback?.id) {
      await syncFeedbackAssessment({
        orgId: trace.org_id,
        eventId,
        traceId: trace.id,
        postId,
        feedbackId: feedback.id,
        agentName: previousDecision === 'rejected_irrelevant' ? 'relevance' : 'severity',
        label: previousDecision === 'rejected_irrelevant' ? 'not_relevant' : 'false_positive',
        reason: overrideNote || 'Operator override surfaced a previously rejected/suppressed candidate',
      });
      await syncImprovementRecommendation({
        orgId: trace.org_id,
        feedbackId: feedback.id,
        eventId,
        agentName: previousDecision === 'rejected_irrelevant' ? 'relevance' : 'severity',
        label: previousDecision === 'rejected_irrelevant' ? 'not_relevant' : 'false_positive',
        reason: overrideNote || null,
      });
    }
  } catch (err) {
    // Feedback tables can vary by migration state; override itself must still succeed.
    console.warn('[overrideTraceToDashboard] feedback sync skipped:', err.message);
  }

  return {
    trace_id: trace.id,
    post_id: postId,
    org_id: trace.org_id,
    org_slug: trace.org_slug,
    org_name: trace.org_name,
    decision: 'surfaced_override',
    previous_decision: previousDecision,
    dashboard_path: `/${trace.org_slug}`,
    candidate,
  };
}
