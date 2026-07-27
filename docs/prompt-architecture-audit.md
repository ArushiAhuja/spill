# Prompt architecture audit — 2026-07-27

## Scope

This is an implementation audit of the AI execution paths, not a dashboard audit. It covers the agents that can influence a surfaced signal or a customer-facing AI response: source understanding, relevance, category, severity, summary, trend, response writing, and organisation-intelligence extraction.

## Current shared prompt storage

`src/server/prompts.js` is the current prompt source. It keeps five global defaults in code and optionally replaces each whole prompt with one row in `prompts` for an organisation. `prompt_versions` records writes to those organisation rows. There is no persisted global prompt, no status (`draft`/`active`/`deprecated`), no prompt identity independent of the key, and no single resolver for all callers. `buildEffectivePromptPreview` creates a useful display/playground preview, but production agent execution does not use it.

Organisation context currently comes from several overlapping paths:

- human input in `organizations` and `organization_profile`;
- Spill-learned data in `intel_profile`;
- reviewer feedback returned by `getOrgFeedbackContext`;
- `organization_agent_configs`, which mix policy, examples, model selection, and escalation settings.

As a result, the same facts are hand-assembled differently across agents.

## Agent audit

| Agent | Prompt source | Organisation context source | Final assembly / execution | Problems |
| --- | --- | --- | --- | --- |
| Source Understanding | None | Raw source, configured source rules, brand/intelligence keywords | Deterministic checks in `scheduler.js` | Its policy config is only partially observed; no common execution contract or prompt/debug record. |
| Relevance | `relevance_filter` default or `prompts` override | `intel_profile`, merged `organization_profile`, Reddit context queries, feedback, agent policy | `aiRelevanceFilter` manually concatenates a system role and a user string in `scheduler.js` | Context is duplicated and varies from other agents; prompt version is looked up later rather than being the actual resolved execution prompt. |
| Category classification | `classifier_system` default/override plus `classifier_scoring` default/override | Description, learned/human intelligence, categories, feedback, category agent policy | `classifyBatch` manually builds `orgContext`, uses one system prompt and puts scoring rules in the user message | Two prompt keys make one agent’s version ambiguous; raw organisation facts and feedback are concatenated at call site. |
| Severity | `classifier_scoring` is adjacent guidance, not a true execution prompt | Category severity, classification dimensions, `organization_agent_configs.escalation_rules` | Deterministic `scorePost` in `classifier.js` | No explicit prompt contract despite being logged as an agent; configuration affects math but is not composed or version-resolved. |
| Executive summary | None | Category, classification reasoning, escalation dimensions | Deterministic `executiveSummary` in `observability.js` | No organisation tone/priorities or prompt/version contract. |
| Trend detection | None | Post/category cluster fingerprints, trend agent config only in trace snapshots | Deterministic `assignCluster` in `observability.js` | Config is not a meaningful runtime input; no common execution/debug record. |
| Response writer | `response_writer` default/override | Ticket org name/description and learned brand voice, ICP, complaints; user-selected tone and notes | Ticket route manually interpolates its own system prompt, then appends the stored instructions | Does not load human `organization_profile` or agent config; trace hard-codes prompt version `0`; organisation data is assembled ad hoc. |
| Organisation intelligence extraction | `intel_extraction` default/override | Onboarding description, website copy, competitors | Onboarding route appends rules to a large user prompt; feedback/reprocess have separate direct prompts | Input schema and instruction composition are not centralized; custom prompt handling differs from feedback/reprocess. |

## Additional execution paths

- The internal evaluation and playground routes independently use `buildEffectivePromptPreview`, so their result can differ from production.
- `feedback.js` and `internal/reprocess` call OpenAI with their own hand-built prompts. They are intelligence-maintenance paths, and should share the intelligence layer and composer where they use an agent prompt.
- IMAP classification uses an independent direct OpenAI call; it is not one of the named Spill monitoring agents, but it is an unregistered prompt path.

## Principal failure modes

1. A dashboard preview can look organisation-specific while the live agent uses a different assembly.
2. Different agents receive conflicting/duplicated facts (for example, `organization_profile` is merged in the scheduler but not in ticket response generation).
3. Prompt versions are organisation override versions only; global defaults have no durable version or lifecycle and traces cannot identify a complete final prompt reliably.
4. Examples and feedback are either raw JSON/string inserts or omitted; they are not a bounded, labelled few-shot layer.
5. Deterministic agents have config but no explicit execution/version contract, making their behaviour hard to reproduce.
6. Evaluation/playground and production execution compose prompts differently, invalidating comparisons.

## Required architecture change

Implement a central persisted registry with active global and organisation prompt versions; a separate, typed organisation-intelligence compiler; and a single Prompt Composer. Every agent will ask the composer for its instructions and runtime message. The composer will resolve the active organisation prompt first, otherwise the active global prompt, then assemble layers in a fixed order: base identity, task instructions, organisation intelligence, organisation examples, reviewed feedback, and bounded runtime context. Each execution will retain the resolved prompt identity, version, SHA-256 hash, model, organisation, and timestamp in the existing trace/debug ledger.
