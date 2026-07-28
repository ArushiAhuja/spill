import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ensureMigrations } from '../src/server/migrate.js';
import { query } from '../src/server/db.js';
import { composePrompt } from '../src/server/prompt-composer.js';
import { AGENT_DEFINITIONS, getOrganizationAgentConfig } from '../src/server/organization-agent-config.js';

const suffix = randomUUID().slice(0, 8);
const orgIds = [];

async function makeOrganisation({ name, description, profile, categoryName, note, feedbackLabel, feedbackReason }) {
  const { rows: [org] } = await query(
    `INSERT INTO organizations (name,slug,description,organization_profile,intel_profile)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [name, `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${suffix}`, description, JSON.stringify(profile), JSON.stringify({ customerPainPoints: [categoryName] })]
  );
  orgIds.push(org.id);
  const { rows: [category] } = await query(
    `INSERT INTO categories (org_id,name,description,severity,color) VALUES ($1,$2,$3,20,'#f87171') RETURNING *`,
    [org.id, categoryName, `${categoryName} monitoring category`]
  );
  const { rows: [post] } = await query(
    `INSERT INTO posts (org_id,source,external_id,title,body,category_id,post_status,saved_at,notes,escalation_score)
     VALUES ($1,'reddit',$2,$3,$4,$5,'dismissed',NOW(),$6,70) RETURNING *`,
    [org.id, `briefing-${suffix}`, `${categoryName} complaint`, `${categoryName} customer signal`, category.id, note]
  );
  await query(
    `INSERT INTO post_feedback (org_id,post_id,label,explanation,agent_name,signal_type)
     VALUES ($1,$2,$3,$4,'relevance','explicit')`,
    [org.id, post.id, feedbackLabel, feedbackReason]
  );
  return { org, category };
}

async function compose(org, category) {
  const config = await getOrganizationAgentConfig(org.id, 'response_writer');
  return composePrompt({
    agentName: 'response_writer', orgId: org.id, organization: org, categories: [category], agentConfig: config,
    runtimeContext: { customer_complaint: { title: 'A customer needs a response' } }, logExecution: false,
  });
}

async function run() {
  await ensureMigrations();
  try {
    const aviation = await makeOrganisation({
      name: 'Aviation Briefing Test',
      description: 'DGCA-approved pilot training and cadet programme provider.',
      profile: { priority_issues: ['cadet placement', 'training schedule'], brand_voice: 'calm and safety-conscious' },
      categoryName: 'pilot training delays', note: 'Operations already contacted the cadet coordinator.',
      feedbackLabel: 'missed_context', feedbackReason: 'Cadet placement concerns require an operational response.',
    });
    const delivery = await makeOrganisation({
      name: 'Delivery Briefing Test',
      description: 'On-demand food delivery platform serving urban customers.',
      profile: { priority_issues: ['late orders', 'refund handling'], brand_voice: 'warm and concise' },
      categoryName: 'cold food delivery', note: 'Refund route was offered by customer support.',
      feedbackLabel: 'false_positive', feedbackReason: 'Restaurant marketing posts should not be escalated as delivery failures.',
    });
    const [aviationPrompt, deliveryPrompt] = await Promise.all([
      compose(aviation.org, aviation.category), compose(delivery.org, delivery.category),
    ]);
    assert.match(aviationPrompt.systemPrompt, /DGCA-approved pilot training/);
    assert.match(aviationPrompt.systemPrompt, /pilot training delays/);
    assert.match(aviationPrompt.systemPrompt, /Operator outcomes/);
    assert.match(aviationPrompt.systemPrompt, /Operator note themes \(derived, not quoted\)/);
    assert.match(deliveryPrompt.systemPrompt, /On-demand food delivery/);
    assert.match(deliveryPrompt.systemPrompt, /cold food delivery/);
    assert.notEqual(aviationPrompt.systemPrompt, deliveryPrompt.systemPrompt);
    assert.notEqual(aviationPrompt.promptHash, deliveryPrompt.promptHash);
    for (const agent of AGENT_DEFINITIONS) {
      const config = await getOrganizationAgentConfig(aviation.org.id, agent.agent_name);
      const composition = await composePrompt({
        agentName: agent.agent_name, orgId: aviation.org.id, organization: aviation.org, categories: [aviation.category], agentConfig: config,
        runtimeContext: { signal: 'A customer signal for agent-briefing coverage.' }, logExecution: false,
      });
      assert.match(composition.systemPrompt, /COMPACT ORGANISATION AGENT BRIEFING/);
      assert.match(composition.systemPrompt, /DGCA-approved pilot training/);
    }
    console.log('✓ response writer receives a compact, role-aware organisation briefing');
    console.log('✓ feedback, dismissals, saved signals, notes, categories, and approved profile alter the briefing');
    console.log('✓ two organisations produce materially different response-writer prompts');
    console.log('✓ the shared briefing is injected into every registered agent role');
  } finally {
    for (const orgId of orgIds) await query('DELETE FROM organizations WHERE id=$1', [orgId]);
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
