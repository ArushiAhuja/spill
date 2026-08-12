import { query } from './db.js';
import { linkTraceToPost, recordTraceObservation } from './observability.js';
import { orchestrateOverrideLearning } from './feedback.js';
import { stripHtmlNoise } from './relevance-policy.js';

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
  const title = stripHtmlNoise(trace?.title || meta.title || raw.title || raw.headline || 'Operator-surfaced signal');
  const body = stripHtmlNoise(trace?.body || meta.body || meta.text || raw.body || raw.text || raw.content || raw.description || '');
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
    source: (trace.source || meta.source || 'reddit') === 'manual_override'
      ? 'reddit'
      : (trace.source || meta.source || 'reddit'),
  };
}

function formatAgentOutputSnippet(output) {
  if (!output || typeof output !== 'object') return null;
  const bits = [];
  if (output.is_relevant === false) bits.push('said not relevant');
  else if (output.is_relevant === true) bits.push('said relevant');
  if (output.reasoning) bits.push(String(output.reasoning).slice(0, 280));
  else if (output.reason) bits.push(String(output.reason).slice(0, 280));
  if (output.category) bits.push(`category=${output.category}`);
  if (output.escalation_score != null) bits.push(`score=${output.escalation_score}`);
  if (output.decision) bits.push(`decision=${output.decision}`);
  if (output.score != null && output.threshold != null) bits.push(`quality ${output.score}/${output.threshold}`);
  if (!bits.length) {
    try {
      const json = JSON.stringify(output);
      if (json && json !== '{}') return json.slice(0, 200);
    } catch { /* ignore */ }
  }
  return bits.length ? bits.join('; ') : null;
}

export function buildRejectionSummary(trace, observations = []) {
  const evidence = trace.decision_evidence || {};
  const decision = trace.decision || 'unknown';
  const relevanceObs = observations.find(item => item.prompt_key === 'relevance' || /relevance/i.test(item.name || ''));
  const qualityObs = observations.find(item => /signal quality/i.test(item.name || ''));
  const categoryObs = observations.find(item => item.prompt_key === 'category' || /category/i.test(item.name || ''));
  const severityObs = observations.find(item => item.prompt_key === 'severity' || /severity/i.test(item.name || ''));
  const sourceObs = observations.find(item => item.prompt_key === 'source_understanding' || /source/i.test(item.name || ''));

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
  const relevanceWhy = relevance.reason
    || relevanceObs?.output?.reason
    || relevanceObs?.output?.reasoning
    || null;

  // Lead with the concrete why — this is what operators need
  if (relevanceWhy) {
    lines.push(`Why: ${relevanceWhy}`);
  } else if (decision === 'rejected_irrelevant') {
    lines.push('Why: no specific brand-link explanation was stored for this trace (older run). Re-run after deploy for detailed reasons.');
  }

  // Per-agent: what each recorded agent produced
  const agentLines = [];
  for (const obs of [
    ['Source', sourceObs],
    ['Relevance', relevanceObs],
    ['Category', categoryObs],
    ['Severity', severityObs],
    ['Quality', qualityObs],
  ]) {
    const [label, obs] = obs;
    if (!obs) continue;
    const snippet = formatAgentOutputSnippet(obs.output);
    if (snippet) agentLines.push(`${label} agent: ${snippet}.`);
  }
  lines.push(...agentLines);

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

  // Final: why this decision won (after agents + gates)
  if (decision === 'rejected_irrelevant') {
    lines.push(relevanceWhy
      ? `Final: dropped — ${relevanceWhy}`
      : 'Final: candidate dropped because is_relevant=false.');
  } else if (decision === 'suppressed_low_quality') {
    lines.push('Final: candidate was considered relevant but fell below the signal-quality threshold, so it was not shown on the dashboard.');
  } else if (decision === 'surfaced_override') {
    lines.push(`Final: operator override${evidence?.override?.note ? ` — ${String(evidence.override.note).slice(0, 200)}` : ''}.`);
  } else if (decision === 'surfaced') {
    lines.push('Final: passed relevance and quality gates.');
  }

  return {
    decision,
    summary: lines.join(' '),
    lines,
    agents: agentLines,
    why: relevanceWhy,
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
  // Look like a normal dashboard post — not a forced "escalated/saved" highlight.
  // Prefer the classifier's own reasoning; fall back to a short neutral summary.
  const categoryReasoning = trace.decision_evidence?.category?.reasoning || null;
  const categoryName = trace.decision_evidence?.category?.name || null;
  const reasoning = categoryReasoning
    || (categoryName ? `Related to ${categoryName}.` : null)
    || (overrideNote ? overrideNote.slice(0, 280) : 'Relevant organisation signal surfaced from monitoring.');
  const escalationScore = Math.min(
    100,
    Math.max(
      Number(trace.decision_evidence?.severity?.escalation_score) || 0,
      Number(trace.quality?.score) || 0,
      35,
    ),
  );
  const shouldEscalate = escalationScore >= (Number(process.env.ESCALATE_THRESHOLD) || 60);
  const qualityPayload = {
    score: Math.max(Number(trace.quality?.score) || 0, 35),
    relevance: 1,
    confidence: Number(trace.quality?.confidence) || 0.7,
    impact: Number(trace.quality?.impact) || 0.35,
    novelty: Number(trace.quality?.novelty) || 1,
  };

  let postId = trace.post_id;
  if (postId) {
    await query(
      `UPDATE posts SET
         title = COALESCE(NULLIF($2,''), title),
         body = COALESCE(NULLIF($3,''), body),
         url = COALESCE($4, url),
         author = COALESCE($5, author),
         reasoning = $6,
         escalation_score = GREATEST(COALESCE(escalation_score, 0), $7),
         escalated = CASE WHEN $8 THEN true ELSE escalated END,
         manually_escalated = false,
         reviewed = false,
         post_status = COALESCE(NULLIF(post_status,''), 'unread'),
         dismiss_reason = NULL,
         snoozed_until = NULL,
         ai_trace_id = $9,
         signal_quality = COALESCE(signal_quality, $10::jsonb)
       WHERE id = $1 AND org_id = $11`,
      [
        postId,
        candidate.title,
        candidate.body,
        candidate.url,
        candidate.author,
        reasoning,
        escalationScore,
        shouldEscalate,
        trace.id,
        JSON.stringify(qualityPayload),
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
         $9,$10,$11,$12,$13,
         NOW(), false, false, $14, $15, NULL
       )
       ON CONFLICT (org_id, source, external_id) DO UPDATE SET
         title = EXCLUDED.title,
         body = EXCLUDED.body,
         url = COALESCE(EXCLUDED.url, posts.url),
         author = COALESCE(EXCLUDED.author, posts.author),
         reasoning = EXCLUDED.reasoning,
         escalation_score = GREATEST(COALESCE(posts.escalation_score, 0), EXCLUDED.escalation_score),
         escalated = EXCLUDED.escalated OR posts.escalated,
         manually_escalated = false,
         reviewed = false,
         post_status = CASE WHEN posts.post_status IN ('archived','dismissed') THEN 'unread' ELSE COALESCE(posts.post_status, 'unread') END,
         dismiss_reason = NULL,
         snoozed_until = NULL,
         ai_trace_id = EXCLUDED.ai_trace_id,
         signal_quality = EXCLUDED.signal_quality
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
        escalationScore,
        trace.decision_evidence?.category?.id || null,
        0,
        reasoning,
        shouldEscalate,
        trace.id,
        JSON.stringify(qualityPayload),
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

  // Immediate learning orchestration: reviewed examples for relevance/quality,
  // evaluation cases, assessments/recommendations, and forced intel recompile.
  let learning = null;
  try {
    const { rows: [postRow] } = await query(
      `SELECT id, title, body, source, category_id, escalation_score, escalated, ai_trace_id
       FROM posts WHERE id=$1 AND org_id=$2`,
      [postId, trace.org_id]
    );
    learning = await orchestrateOverrideLearning({
      orgId: trace.org_id,
      post: postRow || {
        id: postId,
        title: candidate.title,
        body: candidate.body,
        source: candidate.source,
        category_id: trace.decision_evidence?.category?.id || null,
        ai_trace_id: trace.id,
      },
      traceId: trace.id,
      eventId: trace.event_id || postId,
      previousDecision,
      note: overrideNote,
      authorEmail: user?.email || null,
    });
  } catch (err) {
    console.warn('[overrideTraceToDashboard] learning orchestration skipped:', err.message);
    learning = { error: err.message };
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
    learning,
  };
}
