import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ensureMigrations } from '../src/server/migrate.js';
import { query } from '../src/server/db.js';
import { createEventTrace } from '../src/server/observability.js';
import { explainTrace } from '../src/server/event-intelligence.js';

const suffix = randomUUID().slice(0, 8);
const slug = `observability-trace-test-${suffix}`;
let orgId = null;

async function run() {
  await ensureMigrations();
  const { rows: [org] } = await query(
    'INSERT INTO organizations (name,slug,description) VALUES ($1,$2,$3) RETURNING id',
    ['Observability Trace Test Co', slug, 'Temporary integration test organisation']
  );
  orgId = org.id;
  try {
    const traceId = await createEventTrace({
      orgId,
      post: { id: 'external-event-42', source: 'reddit', title: 'Refund delayed', body: 'Customer reports a delayed refund.', detected_query: 'refund delay', score: 12 },
      quality: { relevance: 1, confidence: .94, score: 87 }, decision: 'surfaced',
      decisionEvidence: { relevance: { tier: 'tier_3_ai_verified', is_relevant: true }, category: { name: 'Refund delay', confidence: .94 }, severity: { escalation_score: 87, escalated: true }, quality_gate: { score: 87, threshold: 20, decision: 'surfaced' } },
      sourceObservation: { promptKey: 'source_understanding', promptVersion: 2, model: 'deterministic-policy', promptSnapshot: { id: 'source_agent_test_v2' } },
      observations: [
        { name: 'Category Agent', kind: 'agent', model: 'gpt-4o-mini', promptKey: 'category', promptVersion: 5, input: { prompt_id: 'category_agent_test_v5' }, output: { category: 'Refund delay', confidence: 94 }, latencyMs: 400 },
        { name: 'Severity Agent', kind: 'evaluator', model: 'deterministic-severity-v1', promptKey: 'severity', promptVersion: 3, output: { escalation_score: 87 }, latencyMs: 0 },
        { name: 'Executive Summary Agent', kind: 'agent', model: 'deterministic-summary-v1', promptKey: 'summary', promptVersion: 1, output: { summary: 'Refund delay affecting customers.' }, latencyMs: 0 },
      ],
    });
    const { rows: [trace] } = await query('SELECT id,trace_key,org_id,event_id,decision,decision_evidence FROM ai_traces WHERE id=$1', [traceId]);
    const { rows: spans } = await query('SELECT * FROM ai_observations WHERE trace_id=$1 ORDER BY created_at', [traceId]);
    assert.match(trace.trace_key, /^spill_trace_/);
    assert.equal(trace.org_id, orgId);
    assert.ok(trace.event_id);
    assert.equal(trace.decision, 'surfaced');
    assert.deepEqual(spans.map(span => span.name), ['Source Processing Agent', 'Category Agent', 'Severity Agent', 'Executive Summary Agent']);
    assert.ok(spans.every(span => /^spill_span_/.test(span.span_key)));
    const explanation = await explainTrace({ trace, observations: spans });
    assert.equal(explanation.question_answers.why_surfaced.decision, 'surfaced');
    assert.match(explanation.question_answers.why_surfaced.explanation, /Category: Refund delay/);
    assert.equal(explanation.question_answers.correctness.review_status, 'unreviewed');
    assert.ok(explanation.question_answers.prompt_versions.some(prompt => prompt.key === 'category'));
    console.log(`✓ ${trace.trace_key} has organisation_id=${trace.org_id} and event_id=${trace.event_id}`);
    console.log('✓ source, category, severity, and summary spans are inspectable');
    console.log('✓ trace explanation answers why, agent, prompt version, and review status');
  } finally {
    if (orgId) await query('DELETE FROM organizations WHERE id=$1', [orgId]);
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
