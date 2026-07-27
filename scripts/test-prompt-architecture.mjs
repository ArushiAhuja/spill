import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ensureMigrations } from '../src/server/migrate.js';
import { query } from '../src/server/db.js';
import { composePrompt } from '../src/server/prompt-composer.js';
import { createPromptVersion, activatePromptVersion, selectActivePrompt } from '../src/server/prompt-registry.js';

const suffix = randomUUID().slice(0, 8);
const slug = `prompt-architecture-test-${suffix}`;
let orgId = null;

async function createTestOrg() {
  const { rows: [org] } = await query(
    `INSERT INTO organizations (name,slug,description,organization_profile,intel_profile)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    ['Prompt Architecture Test Co', slug, 'A modular interiors company for prompt-composer integration tests.', JSON.stringify({ priority_issues: ['installation delays'], terminology: ['modular furniture'] }), JSON.stringify({ typicalComplaints: ['delivery delayed beyond promised date'] })]
  );
  orgId = org.id;
  return org;
}

async function run() {
  await ensureMigrations();
  const org = await createTestOrg();
  try {
    // 1. Missing organisation configuration falls back to the active global prompt.
    const global = await composePrompt({ agentName: 'category', orgId, organization: org, runtimeContext: { signal: 'delivery delay' }, logExecution: false });
    assert.equal(global.prompt.scope, 'global');
    assert.match(global.finalPrompt, /Prompt Architecture Test Co/);
    assert.match(global.finalPrompt, /installation delays/);
    assert.equal(global.promptHash.length, 64);

    // 2. An active organisation version overrides the global version.
    const override = await createPromptVersion({
      agentName: 'category', organizationId: orgId, status: 'active', createdBy: 'automated-test',
      changeSummary: 'Test organisation-specific delivery policy', promptTemplate: 'Treat installation and delivery delays as the primary category for this organisation.',
    });
    const overridden = await composePrompt({ agentName: 'category', orgId, organization: org, runtimeContext: { signal: 'delivery delay' }, logExecution: false });
    assert.equal(overridden.prompt.id, override.prompt_id);
    assert.equal(overridden.prompt.scope, 'organization');
    assert.match(overridden.finalPrompt, /primary category/);

    // 3. Activating a later version and then re-activating the previous version is rollback.
    const candidate = await createPromptVersion({
      agentName: 'category', organizationId: orgId, status: 'draft', createdBy: 'automated-test',
      changeSummary: 'Test candidate policy', promptTemplate: 'Candidate policy for test only.',
    });
    await activatePromptVersion(candidate.prompt_id);
    assert.equal((await composePrompt({ agentName: 'category', orgId, organization: org, runtimeContext: {}, logExecution: false })).prompt.id, candidate.prompt_id);
    await activatePromptVersion(override.prompt_id);
    assert.equal((await composePrompt({ agentName: 'category', orgId, organization: org, runtimeContext: {}, logExecution: false })).prompt.id, override.prompt_id);

    // 4. A corrupt multi-active result must fail closed, even though the database
    // unique index normally prevents this state.
    assert.throws(
      () => selectActivePrompt([{ scope: 'organization', prompt_id: 'a' }, { scope: 'organization', prompt_id: 'b' }, { scope: 'global', prompt_id: 'global' }], 'category'),
      /prompt registry conflict/
    );

    console.log('✓ prompt composer output');
    console.log('✓ global fallback and organisation override');
    console.log('✓ missing organisation configuration');
    console.log('✓ prompt version rollback');
    console.log('✓ multiple-active conflict fails closed');
  } finally {
    if (orgId) await query('DELETE FROM organizations WHERE id=$1', [orgId]);
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
