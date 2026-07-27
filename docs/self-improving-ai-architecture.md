# Spill self-improving AI architecture

## Audit (27 July 2026)

Spill already had organisation-scoped prompt resolution, immutable trace/span
snapshots, feedback records, an organisation intelligence compiler, and
evaluation runs. The missing links were:

- traces recorded outputs but did not retain a structured explanation of the
  final surface/suppress decision;
- feedback had no first-class event/agent correctness verdict;
- learning actions existed but did not expose a clear recommendation for how a
  particular organisation's agent should improve;
- historical evaluation did not compose the same feedback context used at
  runtime; and
- the executive-summary agent accidentally used trend-agent configuration.

## Data contract

`ai_traces.decision_evidence` retains the relevance tier, category and
confidence, severity dimensions, and quality-gate threshold for a decision.
This is immutable execution evidence, not a reconstruction from current rules.

`agent_event_assessments` maps each feedback record to one or more derived
verdicts. A false positive, for example, marks the severity output and the
surface decision incorrect; a wrong category marks only category incorrect.
No feedback means the event is **unreviewed**, never assumed correct.

`agent_improvement_recommendations` is an organisation/agent-level, upserted
recommendation ledger. It gives the internal console a safe next action and
evidence without silently rewriting a production prompt.

`feedback_learning_actions` remains the audit log of the concrete change made:
prompt context, reviewed example, threshold adjustment, category refinement, or
evaluation case.

## Agent architecture

```text
Source Understanding (deterministic, versioned policy)
  → Relevance (deterministic tier or LLM decision)
  → Category (LLM with organisation intelligence and reviewed examples)
  → Severity (deterministic, organisation threshold/policy)
  → Executive Summary (deterministic, organisation summary policy)
  → Signal Quality Gate
  → Alert delivery actions
  → Trace + immutable spans + decision evidence

Customer feedback
  → event assessment (correct / incorrect / unknown)
  → improvement recommendation
  → reviewed prompt context/examples, guarded threshold/category updates
  → evaluation cases and historical comparisons
```

## Query contract

`GET /api/internal/observability/traces?trace_id=<id-or-trace-key>` returns
`question_answers` with:

1. why the issue surfaced, using persisted decision evidence;
2. the deciding agents and their outputs;
3. prompt IDs, versions, and hashes used at execution time;
4. an unreviewed or feedback-derived correctness verdict; and
5. current organisation-agent improvement recommendations.

This contract intentionally keeps feedback-derived changes bounded. One label
adds evidence; only repeated, consistent feedback can adjust a threshold or
category severity.
