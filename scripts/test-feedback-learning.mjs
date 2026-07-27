import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ensureMigrations } from '../src/server/migrate.js';
import { query } from '../src/server/db.js';
import { applyFeedbackLearning, getOrgFeedbackContext } from '../src/server/feedback.js';
import { getOrganizationAgentConfig } from '../src/server/organization-agent-config.js';
import { composePrompt } from '../src/server/prompt-composer.js';
import { getEventAssessmentSummary } from '../src/server/event-intelligence.js';

const suffix = randomUUID().slice(0, 8);
const slug = `feedback-learning-test-${suffix}`;
let orgId = null;

async function insertFeedback({ postId, eventId, label, agentName = 'relevance', direction = null, reason }) {
  const { rows: [feedback] } = await query(
    `INSERT INTO post_feedback (org_id,post_id,event_id,label,explanation,agent_name,severity_direction,signal_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'explicit') RETURNING *`,
    [orgId, postId, eventId, label, reason, agentName, direction]
  );
  return feedback;
}

async function run() {
  await ensureMigrations();
  const { rows: [org] } = await query(
    `INSERT INTO organizations (name,slug,description) VALUES ($1,$2,$3) RETURNING *`,
    ['Feedback Learning Test Co', slug, 'A temporary company used to prove the feedback learning loop.']
  );
  orgId = org.id;
  try {
    const { rows: [category] } = await query(
      `INSERT INTO categories (org_id,name,description,severity,color) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [orgId, 'refund delays', 'Refunds not received on time', 20, '#f87171']
    );
    const { rows: [post] } = await query(
      `INSERT INTO posts (org_id,source,external_id,title,body,category_id,escalation_score)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [orgId, 'reddit', `feedback-test-${suffix}`, 'Refund has not arrived after 30 days', 'Several customers report a delayed refund.', category.id, 72]
    );
    const { rows: [trace] } = await query(
      `INSERT INTO ai_traces (org_id,post_id,source,decision) VALUES ($1,$2,$3,'surfaced') RETURNING id,event_id`,
      [orgId, post.id, 'reddit']
    );
    await query('UPDATE posts SET ai_trace_id=$1 WHERE id=$2', [trace.id, post.id]);

    const categoryFeedback = await insertFeedback({
      postId: post.id, eventId: trace.event_id, label: 'wrong_category', agentName: 'category',
      reason: 'This is a refund delay, not a generic product complaint.',
    });
    const categoryLearning = await applyFeedbackLearning({
      orgId, feedbackId: categoryFeedback.id, eventId: trace.event_id, agentName: 'category', post,
      label: 'wrong_category', explanation: categoryFeedback.explanation, newValue: category.id, authorEmail: 'test@spill.local',
    });
    assert.equal(categoryLearning.prompt_context, true);
    assert.equal(categoryLearning.example_update, true);
    const categoryConfig = await getOrganizationAgentConfig(orgId, 'category');
    assert.equal(categoryConfig.examples.length, 1);
    assert.equal(categoryConfig.examples[0].feedback.label, 'wrong_category');
    assert.equal(categoryConfig.examples[0].event_id, trace.event_id);

    const feedbackContext = await getOrgFeedbackContext(orgId);
    const composed = await composePrompt({
      agentName: 'category', orgId, organization: org, categories: [category], agentConfig: categoryConfig,
      feedbackContext, runtimeContext: { title: post.title }, logExecution: false,
    });
    assert.match(composed.finalPrompt, /REVIEWED ORGANISATION EXAMPLES/);
    assert.match(composed.finalPrompt, /REVIEWED FEEDBACK/);

    // Threshold tuning must not react to one or two labels. The third coherent
    // false-positive signal raises it by the bounded five-point increment.
    for (let index = 0; index < 3; index++) {
      const feedback = await insertFeedback({
        postId: post.id, eventId: trace.event_id, label: 'false_positive', agentName: 'severity',
        reason: 'Marketing chatter should not trigger an escalation.',
      });
      if (index === 2) {
        const learned = await applyFeedbackLearning({
          orgId, feedbackId: feedback.id, eventId: trace.event_id, agentName: 'severity', post,
          label: 'false_positive', explanation: feedback.explanation, authorEmail: 'test@spill.local',
        });
        assert.equal(learned.threshold_adjustment, true);
      }
    }
    const severityConfig = await getOrganizationAgentConfig(orgId, 'severity');
    const defaultThreshold = parseInt(process.env.ESCALATE_THRESHOLD, 10) || 60;
    assert.equal(severityConfig.escalation_rules.escalation_threshold, Math.min(85, Math.max(35, defaultThreshold) + 5));
    const assessment = await getEventAssessmentSummary({ orgId, eventId: trace.event_id });
    assert.equal(assessment.review_status, 'reviewed');
    assert.equal(assessment.surface_decision.verdict, 'incorrect');
    assert.equal(assessment.agents.severity.verdict, 'incorrect');

    const { rows: actions } = await query(
      `SELECT action_type,status,event_id FROM feedback_learning_actions WHERE org_id=$1`, [orgId]
    );
    assert.ok(actions.some(action => action.action_type === 'prompt_context' && action.status === 'applied'));
    assert.ok(actions.some(action => action.action_type === 'example_update' && action.status === 'applied'));
    assert.ok(actions.some(action => action.action_type === 'threshold_adjustment' && action.status === 'applied'));
    assert.ok(actions.every(action => action.event_id));
    const { rows: recommendations } = await query(
      `SELECT agent_name,recommendation_key,status FROM agent_improvement_recommendations WHERE org_id=$1`, [orgId]
    );
    assert.ok(recommendations.some(row => row.agent_name === 'category' && row.recommendation_key === 'refine_category_policy'));
    assert.ok(recommendations.some(row => row.agent_name === 'severity' && row.recommendation_key === 'calibrate_escalation'));

    console.log('✓ feedback stores an organisation-scoped event ID and agent');
    console.log('✓ feedback is injected into composed prompts and reviewed examples');
    console.log('✓ three coherent severity corrections adjust the live organisation threshold');
    console.log('✓ every applied learning action is auditable');
    console.log('✓ feedback produces event correctness and organisation-agent improvement recommendations');
  } finally {
    if (orgId) await query('DELETE FROM organizations WHERE id=$1', [orgId]);
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
