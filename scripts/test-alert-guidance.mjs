import assert from 'node:assert/strict';
import { buildAlertGuidance } from '../src/lib/alert-guidance.js';

const delivery = buildAlertGuidance({
  category_name: 'late delivery',
  title: 'My order never arrived',
  escalation_score: 82,
  escalation_dimensions: { virality_potential: 8 },
});
assert.match(delivery.crmChecks.join(' '), /tracking/i);
assert.deepEqual(delivery.impacts.map(item => item.team), ['CX', 'Logistics', 'Product']);
assert.equal(delivery.actions.length, 3);

const refund = buildAlertGuidance({ category_name: 'refund delay', escalation_score: 40 });
assert.match(refund.crmChecks.join(' '), /refund status/i);
assert.match(refund.actions[2], /Monitor for recurrence/i);

const aviation = buildAlertGuidance({ category_name: 'pilot training delays', escalation_score: 75 });
assert.match(aviation.crmChecks.join(' '), /Student or cadet record/i);
assert.match(aviation.impacts.map(item => item.team).join(' '), /Student Success/);

console.log('✓ alert guidance maps issue types to CRM checks, impact teams, and a three-step playbook');
