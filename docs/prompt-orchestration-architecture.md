# Prompt orchestration architecture

## Resolution and composition

`prompt_registry` is the canonical version registry. Each row has the required
identity and lifecycle fields: `prompt_id`, `agent_name`, `scope`,
`organization_id`, `version`, `status`, `prompt_template`, `created_by`, and
`created_at`. At runtime, `getActivePrompt` resolves in this order:

1. active organisation prompt for the agent;
2. active global prompt for the agent.

Existing rows from the legacy `prompts` table are migrated to active
organisation versions (relevance, category, severity, response writer, and
intelligence extraction). Global defaults are lazily persisted as active
version 1 registry rows. Creating, activating, listing, and rolling a prompt
version is provided by `src/server/prompt-registry.js`; activation deprecates
the prior active version in its scope.

`composePrompt` is the single assembly point. Its final system/user prompt is
always layered in this order:

1. Base identity
2. Task instructions from the resolved registry version
3. Organisation Intelligence Layer
4. Reviewed organisation examples
5. Reviewed feedback
6. Bounded runtime context

The Organisation Intelligence Layer is compiled separately by
`src/server/organization-intelligence.js`. It keeps customer-supplied facts,
human-approved profile, monitoring taxonomy, and Spill-inferred intelligence
separate and labelled. It never includes source credentials.

The composer stores `org_id`, agent, prompt ID/version, SHA-256 final prompt
hash, model, and timestamp in `prompt_execution_debug`. Full prompt snapshots
are retained on trace observations where an event trace exists.

## Agent coverage

| Agent | Execution mode | Composer use |
| --- | --- | --- |
| Source understanding | deterministic | resolves and logs versioned policy per refresh |
| Relevance | LLM | composed system prompt and runtime candidate set |
| Category | LLM | composed classification prompt; severity policy resolves independently |
| Severity | deterministic scoring | resolves/logs a separate scoring policy/version |
| Executive summary | deterministic | resolves/logs policy per surfaced candidate |
| Trend | deterministic clustering | resolves/logs policy per surfaced candidate |
| Response writer | LLM | composed organisation-aware ticket response prompt |
| Intelligence extraction | LLM | composed onboarding intelligence prompt |

## Examples from the current database

These excerpts demonstrate the same global prompt version becoming
organisation-specific through the intelligence layer; they do not imply that
either company has a bespoke override. A custom active organisation version
would replace only the Task Instructions section.

### Chimes Aviation — response writer

```text
BASE IDENTITY
You are Spill's Response Writer Agent...

TASK INSTRUCTIONS
Write a public-facing customer response...

ORGANISATION INTELLIGENCE LAYER
COMPANY IDENTITY
- Company: Chimes Aviation
- Company description: We provide comprehensive pilot training for aspiring
  commercial aviators...

SPILL-INFERRED INTELLIGENCE
- typicalComplaints: [current learned complaint patterns]
- exclusionTerms: [current learned false-positive terms]

RUNTIME CONTEXT
tone, customer complaint, prior public replies, and response-count rule
```

### Swiggy — relevance agent

```text
BASE IDENTITY
You are Spill's Relevance Agent. Minimise false positives...

TASK INSTRUCTIONS
Include a post ONLY if it directly concerns the company, its products, or
services; exclude incidental or generic mentions.

ORGANISATION INTELLIGENCE LAYER
COMPANY IDENTITY
- Company: Swiggy
- Company description: Swiggy is an on-demand convenience platform...

MONITORING TAXONOMY
- [the organisation's configured categories and severity]

RUNTIME CONTEXT
source context terms, bounded candidate posts, and JSON-only index output rule
```

## Historical evaluation

The existing evaluation-case/run tables remain the historical test harness.
The next run should execute the same composer against labelled relevance and
category cases, recording relevance accuracy, classification accuracy,
hallucination/parse-error rate, and false-positive rate for each prompt
version. A candidate version is created as `draft`, evaluated, then explicitly
activated only after review; production never silently changes version.
