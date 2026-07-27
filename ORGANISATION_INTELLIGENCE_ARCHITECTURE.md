# Spill Organisation Intelligence Architecture

> Audit scope: source, scheduler, fetchers, onboarding, feedback, prompt, detector,
> notification, digest, ticket-response, and API code under `src/`. This is a
> code-level audit; it does not infer behaviour from dashboard copy.

## System map

```text
Organisation config + intelligence profile
  ├─ onboarding AI → categories, source queries, context queries, intel profile
  └─ source configs → parallel fetchers
                         ↓
                    normalise / 24h cutoff / URL dedupe
                         ↓
       tier 1 brand match | tier 2 operational match | tier 3 AI relevance
                         ↓
              batch category + risk classification
                         ↓
      deterministic escalation score + signal-quality gate + clustering
                         ↓
          posts / traces → escalation rules → email, Slack, Sheets, webhook
                         └→ anomaly and incident detectors → notifications

Customer feedback → feedback-intelligence AI → organisation intel profile/category severity
Tickets → response-writing AI → proposed replies
Posts → scheduled digest formatter → email digest
```

## Retrieval and ingestion audit

| Stage | Implementation | Inputs → outputs | Risk / current gap |
|---|---|---|---|
| Source configuration | `source_configs`, `organizations.intel_profile` | Tenant credentials and source config → source-specific search terms | Query provenance is not stored per fetched item. |
| Fetch execution | `fetchAll()` | Enabled source configs → parallel normalized posts | One failing source becomes an empty result, reducing coverage without stopping the cycle. |
| Sources | Reddit, Hacker News, Google/Bing News RSS, NewsAPI, X, Play/App Store, LinkedIn, Instagram, YouTube, Trustpilot | Query/feed/app ID/account → common post shape | Recency and engagement quality vary significantly by source; scoring is not source-calibrated. |
| Reddit retrieval | Edge endpoint → Apify → direct fallback | Brand/context/operational queries, subreddits, custom threads → posts | Broad context queries create the highest unnecessary-query volume. |
| News retrieval | RSS per query plus optional NewsAPI | Query/RSS URL → articles | URL-only dedupe misses syndicated copies with different canonical URLs. |
| Normalisation | Fetcher normalizers | Vendor response → common post shape | Fallback sources can set current time/zero engagement, weakening scoring. |
| Global preprocessing | `fetchAll()` | All source posts → fresh (<24h), unique URLs | DB dedupe is `(org_id, source, external_id)`, so cross-source copies remain. |
| Candidate retrieval | Scheduler relevance tiers | Normalized posts + org/name/intel → candidate set | Tier 1 accepts brand/competitor matches without an LLM gate. |

## AI-agent inventory

| Agent | Responsibility | Input → output | Model / prompt | Dependencies | Failure modes | Optimisation opportunity |
|---|---|---|---|---|---|---|
| Onboarding Intelligence Agent | Builds tenant monitoring plan | Company details → categories, queries, subreddits, intel profile | `gpt-4o-mini`; embedded onboarding JSON prompt + `intel_extraction` rules | OpenAI, org/category/source tables, subreddit discovery | Wrong industry vocabulary, invalid JSON, broad queries, category reset removes refinements | Operator review, evidence/source attribution, preserve user-owned categories. |
| Tier-3 Relevance Agent | Validates broad subreddit content | 20 posts + company/intel/feedback → kept indexes | `gpt-4o-mini`; `relevance_filter` | OpenAI, source config, feedback context | JSON/index mistakes, false negatives under sparse context | Per-item structured decision, rationale/confidence, query caps, labelled evaluation. |
| Tier-1/2 Relevance Policy | Cheap deterministic prefilter | Keywords, geo/subreddit/exclusions → direct candidates | No model | Intel profile, source config | Homonyms, stale terms, phrase ambiguity | Term confidence/expiry and sampled AI audits. |
| Category & Severity Classifier | Classifies and estimates risk | Five posts + categories/context → category, four dimensions, response suggestion | `gpt-4o-mini`; `classifier_system`, `classifier_scoring` | OpenAI, categories, prompts, intel | Hallucinated relevance/category, malformed JSON, batch drift, self-reported confidence | Schema validation, evidence spans, abstention, source/category evaluation. |
| Keyword Fallback | Degraded classification | Post/categories → heuristic category/dimensions | No model | Category terms | Vocabulary bias; no tenant-context validation | Mark degraded; require higher evidence before alerting. |
| Escalation Scorer | Calculates urgency | Dimensions/category/engagement/age → 0–100 score | No model; fixed formula | Threshold, timestamp | Overlapping score components inflate low-value reports | Calibrate weights and expose component breakdown. |
| Signal Quality Evaluator | Suppresses weak candidates | Relevance/impact/confidence/novelty → quality decision | No model | Classifier, threshold | Confidence is model self-report; novelty is preliminary | Confidence calibration and pre-decision semantic novelty. |
| Feedback Intelligence Agent | Learns filtering/severity patterns | Feedback/saved posts → intel profile + severity deltas | `gpt-4o-mini`; embedded extraction prompt | OpenAI, feedback/posts/categories | Sparse feedback, noisy text, autonomous severity changes | Approval flow, before/after evaluation, minimum evidence. |
| Ticket Response Agent | Drafts reply alternatives | Ticket/org context/notes → replies | `gpt-4o-mini`; `response_writer` | OpenAI, tickets, intel | Unsupported promises, ticket prompt injection | Policy/fact guard, channel schema, separate traces. |
| Digest Formatter | Produces scheduled digest | Posts/categories/config → email digest | No generative model observed | DB, AgentMail | Repeats clustered issues, weak trend synthesis | Digest by cluster/change and include trace reasons. |

## Prompt and company-configuration audit

| Asset | Storage / scope | Current behaviour | Audit finding |
|---|---|---|---|
| Default prompts | `src/server/prompts.js`, global code | Used with no org override | Defaults are version 0; deployment can change behaviour outside DB history. |
| Org overrides | `prompts`, `prompt_versions`; per org | Versioned edit/reset/rollback | Strong foundation; trace layer now binds versions to decisions. |
| Intelligence profile | `organizations.intel_profile`; per org | Onboarding-generated then feedback-updated | Generated and learned data lack source ownership/expiry. |
| Categories/severity | `categories`; per org | Generated at onboarding; feedback can change severity | Re-onboarding deletes/recreates categories, breaking historic continuity. |
| Retrieval config | `source_configs.config`; per source/org | Generated then editable | No query budget, effectiveness, or result attribution. |
| Escalation config | rules + org thresholds | Rules/mutes/dedup log | Dedupe is rule/category-window, not semantic issue level. |

## Alerting, summarisation, and workflow audit

| Workflow | Trigger → destination | Failure mode / relevance risk |
|---|---|---|
| Escalation actions | Passing post/rule → AgentMail, Slack, Sheets, webhook | Rule dedupe cannot consolidate near-identical reports before alerting. |
| Command-center ticket | Influencer, viral, or ≥80 score → tickets/instant email | Viral/influencer logic can bypass quality nuance; reason is coarse. |
| Incident detector | Category threshold within two hours → incident | Counts posts, not clusters; reposts can manufacture an incident. |
| Anomaly detector | Count >2.5× seven-day cycle average → email | Measures candidate count rather than confirmed quality; source changes look anomalous. |
| Digest | Cron/config → email | Not a semantic executive summary; should lead with clusters/trends. |
| Response thread | Reply tracking + ticket AI route → dashboard/email | Needs independent trace, approval, and safety control. |

## Likely signal-quality failures

| Problem | Where | Root cause | Priority remediation |
|---|---|---|---|
| Hallucinated relevance | Tier-3/reclassifier | Broad industry context and plausible inference | Per-item evidence/confidence; benchmark each prompt version. |
| Hallucinated category/severity | Batched classifier | Heterogeneous batch shares long context; no evidence requirement | JSON schema, evidence spans, calibration and abstention. |
| Unnecessary queries | Onboarding context queries, Reddit fan-out, multi-provider news | Broad terms multiply endpoints/candidates | Attribute quality/cost to query; budgets; retire chronic-noise queries. |
| Duplicate signals | Syndicated news, reposts, overlapping search | Exact URL/source-ID dedupe only | Cluster before alert/incident; alert on cluster delta. |
| Irrelevant alerts | Tier-1 matching, fixed score, sparse feedback | Keyword accepted early; urgency differs from usefulness | Quality gate, evidence requirement, sampled review. |
| Feedback drift | Feedback Intelligence Agent | Sparse corrections can create broad exclusions/boosts/severity changes | Approval, evaluation, evidence minimum, reversible log. |

## Recommended measurements

- Relevance precision/recall by source, query, organisation, and prompt version.
- Alert precision: fraction marked useful versus noise/false positive.
- Category/severity agreement and confidence calibration.
- Token cost and latency per source, query, and agent.
- Cluster compression: raw posts ÷ clusters; alerts ÷ clusters.
- Coverage: fetch success, zero-result rate, and source freshness—not candidate count.

## Current pipeline

`Fetchers → relevance tiers → OpenAI classification → deterministic escalation → actions → anomaly / incident detection`

| Component | Responsibility | Input → output | Model / prompt | Key failure mode | Improvement now in place |
|---|---|---|---|---|---|
| Fetchers | Collect public posts | source APIs/RSS → normalized post | None | source outages, duplicate external IDs | Source health is already logged. |
| Relevance gate | Remove unrelated mentions | raw post + brand/intel context → candidate | Tier 3: gpt-4o-mini / `relevance_filter` | incidental brand mentions; AI-only tier has opaque outcome | Tier and policy are recorded on every trace. |
| Classifier | Category, dimensions, response suggestion | candidates + categories + feedback → classification | gpt-4o-mini / `classifier_system`, `classifier_scoring` | malformed JSON, hallucinated relevance, batch drift | Prompt version, raw agent output, usage, latency, and confidence are traced. |
| Escalation scorer | Determine alert threshold | dimensions, category, engagement, recency → 0–100 | Deterministic | high-engagement low-value posts can rise | Quality gate applies relevance × impact × confidence × novelty before surfacing. |
| Actions | Deliver escalation | escalated post + rule → email/Slack/sheets | None | repetitive alerts | Existing fire log plus cluster membership makes repetition visible. |
| Detectors | Identify anomalies/incidents | new classified posts → incident/anomaly | None | incorrect post linkage, sparse-data spikes | Existing incident logic and post-level trace IDs make decisions auditable. |
| Feedback learning | Learn customer corrections | admin labels → intel profile / prompt context | gpt-4o-mini | feedback can overfit or contain PII | Existing sanitizer; trace dashboard exposes false-positive rate. |

## Recommended target architecture

1. Keep ingestion and deterministic pre-filtering cheap; send only ambiguous candidates to an LLM.
2. Treat each candidate as an event with an immutable trace. Store source input, agent observations, model/prompt version, token/latency data, quality factors, and final decision.
3. Split quality from urgency: escalation answers *how severe*; quality answers *whether it deserves attention*. Suppress below a configured threshold (`SIGNAL_QUALITY_THRESHOLD`, default 20).
4. Cluster repeat reports by normalized fingerprint. A cluster holds volume and first/last seen, while the underlying posts remain inspectable.
5. Make feedback a measured evaluation set: compare useful/noise/wrong category/wrong severity rates by prompt version before promoting changes.

## Schema added for P0

- `ai_traces`: one durable event decision, including suppressed candidates.
- `ai_observations`: agent/evaluator inputs, outputs, prompt version, model, latency, and token usage.
- `posts.ai_trace_id`, `posts.signal_quality`, `posts.cluster_id`, `posts.duplicate_of`.
- `signal_clusters`: organization-scoped repeat-signal aggregation.
- `users.is_super_admin`: internal dashboard authorization; `SPILL_SUPER_ADMIN_EMAILS` safely bootstraps the first operator.

## Organisation-level event trace contract

Every surfaced event creates one `ai_traces` row and an ordered `ai_observations` ledger. The trace contains the tenant, source, detected-query evidence, original source content, prompt versions, model/token/latency data where a model runs, final signal-quality decision, and post link. The default trace sequence is:

1. **Source Processing Agent** — raw source content → normalized complaint.
2. **Relevance Agent** — deterministic tier or AI relevance policy → relevance decision.
3. **Category Detection Agent** — category/confidence/reasoning.
4. **Severity Agent** — four risk dimensions, exact escalation score and reason.
5. **Executive Summary Agent** — concise, deterministic executive summary from the decision evidence.
6. **Signal Quality Gate** — all quality factors and final suppress/surface outcome.
7. **Alert Delivery** — each successful or failed email, Slack, Sheets, webhook, or command-centre delivery with destination and latency.

The internal super-admin explorer at `/internal/intelligence` displays those observations in order. An alert action is appended after the original event trace rather than replacing it, so delivery is inspectable even when it occurs later in the cycle.

## Remaining P1/P2 work

- Replace exact token fingerprints with embeddings plus time-window clustering.
- Add prompt experiment assignments and offline replay against feedback-labelled historical events.
- Measure calibration (confidence vs. correctness) per source/category/model.
- Introduce model routing and budget caps, then use evaluation results—not autonomous mutation—to recommend prompt changes.

## Evo assessment

Evo is an autoresearch framework: it discovers a benchmark, runs parallel hypotheses over a tree-search frontier, preserves shared failure traces, and rejects experiments that fail gates. The useful Spill adaptation is an **offline, tenant-isolated prompt evaluation loop**: replay labelled historical events, score relevance/category/severity, and only recommend a prompt version when it beats a held-out set and passes regression gates. Spill should not import autonomous production mutation wholesale: alerting requires human promotion, deterministic rollback, tenant isolation, and cost controls. The trace/event schema here is the prerequisite that makes any evaluator trustworthy.
