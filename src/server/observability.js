import { query } from './db.js';

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'after', 'about', 'have', 'has', 'are', 'was', 'were', 'been', 'your', 'our', 'their', 'users', 'user']);

export function signalQuality(post, novelty = 1) {
  const d = post.escalation_dimensions || {};
  const relevance = post.is_relevant === false ? 0 : 1;
  const impact = Math.min(1, ((d.customer_impact || 0) * .45 + (d.operational_urgency || 0) * .35 + (d.trust_risk || 0) * .20) / 10);
  const confidence = Math.max(.05, Math.min(1, Number(post.classification_confidence ?? .65)));
  const score = Math.round(relevance * impact * confidence * novelty * 100);
  return { relevance, impact: Number(impact.toFixed(2)), confidence: Number(confidence.toFixed(2)), novelty, score };
}

export async function createEventTrace({ orgId, post, quality, decision, decisionEvidence = {}, promptVersions = {}, observations = [], sourceObservation = null }) {
  const { rows: [trace] } = await query(
    `INSERT INTO ai_traces (org_id, source, status, decision, quality, decision_evidence, metadata, trace_key)
     VALUES ($1,$2,'completed',$3,$4,$5,$6,'spill_trace_' || replace(gen_random_uuid()::text,'-','')) RETURNING id,trace_key,event_id`,
    [orgId, post.source || null, decision, JSON.stringify(quality), JSON.stringify(decisionEvidence), JSON.stringify({
      external_id: post.id,
      title: post.title || '',
      body: post.body || '',
      url: post.url || null,
      author: post.author || null,
      engagement: post.score || 0,
      detected_query: post.detected_query || null,
      prompt_versions: promptVersions,
    })]
  );
  const base = [{
    name: 'Source Processing Agent', kind: 'agent', model: sourceObservation?.model || null,
    promptKey: sourceObservation?.promptKey || null, promptVersion: sourceObservation?.promptVersion || null,
    input: { source: post.source, detected_query: post.detected_query || null, raw_post: { title: post.title, body: post.body, url: post.url, author: post.author, engagement: post.score } },
    output: { cleaned_customer_complaint: `${post.title || ''} ${post.body || ''}`.replace(/\s+/g, ' ').trim().slice(0, 1200) }, latencyMs: 0,
    promptSnapshot: sourceObservation?.promptSnapshot || null,
  }, ...observations];
  for (const observation of base) {
    await query(
      `INSERT INTO ai_observations (trace_id,name,kind,model,prompt_key,prompt_version,input,output,latency_ms,input_tokens,output_tokens,error,span_key,prompt_snapshot,config_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'spill_span_' || replace(gen_random_uuid()::text,'-',''),$13,$14)`,
      [trace.id, observation.name, observation.kind || 'agent', observation.model || null, observation.promptKey || null,
       observation.promptVersion || null, JSON.stringify(observation.input || {}), JSON.stringify(observation.output || {}),
       observation.latencyMs || null, observation.inputTokens || null, observation.outputTokens || null, observation.error || null,
       JSON.stringify(observation.promptSnapshot || (observation.promptKey ? { key: observation.promptKey, version: observation.promptVersion, content: observation.input?.prompt_system || observation.input?.policy || null } : {})),
       JSON.stringify(observation.configSnapshot || (observation.input?.agent_policy ? { agent_policy: observation.input?.agent_policy, agent_config_version: observation.input?.agent_config_version ?? null } : {}))]
    );
  }
  return trace.id;
}

export async function linkTraceToPost(traceId, postId) {
  // event_id is allocated when the execution starts and remains stable even
  // when a surfaced candidate later receives a persistent post ID.
  if (traceId && postId) await query('UPDATE ai_traces SET post_id = $1 WHERE id = $2', [postId, traceId]);
}

// Observations may happen after the initial decision (for example, an alert
// delivery). Append instead of overwriting so a trace remains an ordered ledger.
export async function recordTraceObservation(traceId, observation) {
  if (!traceId) return;
  await query(
    `INSERT INTO ai_observations (trace_id,name,kind,model,prompt_key,prompt_version,input,output,latency_ms,input_tokens,output_tokens,error,span_key,prompt_snapshot,config_snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'spill_span_' || replace(gen_random_uuid()::text,'-',''),$13,$14)`,
    [traceId, observation.name, observation.kind || 'event', observation.model || null, observation.promptKey || null,
      observation.promptVersion || null, JSON.stringify(observation.input || {}), JSON.stringify(observation.output || {}),
     observation.latencyMs || null, observation.inputTokens || null, observation.outputTokens || null, observation.error || null,
     JSON.stringify(observation.promptSnapshot || {}), JSON.stringify(observation.configSnapshot || {})]
  );
}

export function executiveSummary(post, categoryName = 'Uncategorized') {
  const d = post.escalation_dimensions || {};
  const factors = [
    d.customer_impact >= 5 ? 'meaningful customer impact' : null,
    d.operational_urgency >= 5 ? 'operational urgency' : null,
    d.trust_risk >= 5 ? 'trust risk' : null,
    d.virality_potential >= 5 ? 'potential reach' : null,
  ].filter(Boolean);
  const subject = (post.title || post.body || 'Customer signal').replace(/\s+/g, ' ').trim().slice(0, 220);
  return `${categoryName}: ${subject}${factors.length ? ` — flagged for ${factors.join(', ')}` : ''}.`;
}

export function fingerprintFor(post) {
  // Titles are usually the stable issue description; falling back to body keeps
  // review-only sources clusterable. Sorted tokens make wording order irrelevant.
  const basis = post.title || (post.body || '').slice(0, 240);
  const tokens = basis.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
  return [...new Set(tokens)].sort().slice(0, 8).join(':') || `source:${post.source}:${post.id}`;
}

function similarity(a, b) {
  const left = new Set(a.split(':').filter(Boolean)); const right = new Set(b.split(':').filter(Boolean));
  let overlap = 0; for (const token of left) if (right.has(token)) overlap++;
  return overlap / Math.max(1, new Set([...left, ...right]).size);
}

export async function assignCluster(orgId, postId, post) {
  const fingerprint = fingerprintFor(post);
  let { rows: existing } = await query('SELECT id FROM signal_clusters WHERE org_id=$1 AND fingerprint=$2', [orgId, fingerprint]);
  // Near-duplicate fallback: same organisation/category within seven days and
  // token Jaccard >= .60. This is deterministic and explainable; embeddings can
  // replace it later without changing the cluster contract.
  if (!existing[0]) {
    const { rows: candidates } = await query(
      `SELECT id, fingerprint FROM signal_clusters WHERE org_id=$1 AND category_id IS NOT DISTINCT FROM $2 AND last_seen_at > NOW() - interval '7 days'`,
      [orgId, post.category_id || null]
    );
    const nearest = candidates.map(c => ({ ...c, score: similarity(fingerprint, c.fingerprint) })).sort((a, b) => b.score - a.score)[0];
    if (nearest?.score >= .60) existing = [nearest];
  }
  let clusterId;
  let duplicateOf = null;
  if (existing[0]) {
    clusterId = existing[0].id;
    const { rows } = await query('SELECT id FROM posts WHERE cluster_id=$1 ORDER BY created_at ASC LIMIT 1', [clusterId]);
    duplicateOf = rows[0]?.id || null;
    await query('UPDATE signal_clusters SET volume=volume+1,last_seen_at=NOW() WHERE id=$1', [clusterId]);
  } else {
    const { rows } = await query(
      `INSERT INTO signal_clusters (org_id,category_id,fingerprint,title) VALUES ($1,$2,$3,$4) RETURNING id`,
      [orgId, post.category_id || null, fingerprint, (post.title || 'Untitled signal').slice(0, 500)]
    );
    clusterId = rows[0].id;
  }
  await query('UPDATE posts SET cluster_id=$1, duplicate_of=$2 WHERE id=$3', [clusterId, duplicateOf, postId]);
  return { clusterId, duplicateOf };
}
