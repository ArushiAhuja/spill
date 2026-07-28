// Turns the classified issue into practical next steps. These recommendations
// are deliberately deterministic: they guide investigation without claiming
// that an internal CRM fact is true for the individual customer.

const GUIDANCE_RULES = [
  {
    match: /refund|payment|charge|billing|wallet|transaction/i,
    crmChecks: ['Refund status and promised completion date', 'Payment method, transaction ID, and failure code', 'Ticket tags for refund, payment, chargeback, and duplicate charge'],
    impacts: [['CX', 'customers may need a clear status update'], ['Payments', 'a transaction or refund workflow may be involved'], ['Finance', 'refund SLA breaches can require reconciliation']],
    actions: ['Find matching refund or payment tickets from the last seven days.', 'Check whether the stated refund SLA or transaction status has been breached.', 'Assign CX and Payments an owner before responding publicly.'],
  },
  {
    match: /delivery|shipping|logistics|courier|order|late|missing/i,
    crmChecks: ['Order status, promised delivery date, and latest tracking event', 'Ticket tags for late delivery, missing item, and address issue', 'Delayed-order volume and delivery SLA breaches by region or partner'],
    impacts: [['CX', 'customers may contact support before delivery completes'], ['Logistics', 'carrier, fulfilment, or routing delays may need review'], ['Product', 'tracking and ETA accuracy may affect the experience']],
    actions: ['Check for matching delayed orders and the latest carrier or fulfilment milestone.', 'Compare the issue against delivery SLA and regional delay metrics.', 'Give CX a verified status and next-update time before replying.'],
  },
  {
    match: /training|cadet|pilot|aviation|course|class|student|admission/i,
    crmChecks: ['Student or cadet record, programme, and assigned coordinator', 'Schedule changes, attendance, and placement or progression status', 'Ticket tags for training delay, schedule, placement, and documentation'],
    impacts: [['CX', 'prospective or enrolled students may seek clarification'], ['Operations', 'programme schedules or coordinator workflows may need review'], ['Student Success', 'case ownership and follow-up may be required']],
    actions: ['Locate the related student or programme record and confirm the latest approved status.', 'Check whether similar schedule, placement, or documentation concerns are recurring.', 'Assign a single accountable coordinator for the verified response.'],
  },
  {
    match: /outage|error|bug|crash|app|login|service|technical/i,
    crmChecks: ['Affected product area, error code, and account or device context', 'Support ticket tags for outage, login, crash, and degraded service', 'Error volume, incident timeline, and support-contact spike'],
    impacts: [['CX', 'support demand may rise while the issue persists'], ['Product', 'a workflow or experience may be degraded'], ['Engineering', 'error patterns may require incident triage']],
    actions: ['Check the incident log and error trend for the affected product area.', 'Group matching support tickets by error, device, and time window.', 'Name an incident owner and give CX the current verified status.'],
  },
];

const DEFAULT_GUIDANCE = {
  crmChecks: ['Customer or account record and current case owner', 'Ticket tags matching the reported issue and sentiment', 'Recent ticket volume, reopen rate, and unresolved cases for the category'],
  impacts: [['CX', 'customers may need a consistent, verified update'], ['Operations', 'the underlying workflow may need review'], ['Product', 'recurring friction may reveal an experience gap']],
  actions: ['Review the source against matching CRM cases and recent signals.', 'Check whether the category has a rise in unresolved or reopened tickets.', 'Assign an owner and agree the first customer-safe update.'],
};

function issueText(post) {
  return [post?.category_name, post?.title, post?.reasoning].filter(Boolean).join(' ');
}

function selectRule(post) {
  return GUIDANCE_RULES.find(rule => rule.match.test(issueText(post))) || DEFAULT_GUIDANCE;
}

export function buildAlertGuidance(post) {
  const rule = selectRule(post);
  const elevated = Number(post?.escalation_score || 0) >= 70;
  const highReach = Number(post?.escalation_dimensions?.virality_potential || 0) >= 7 || post?.is_influencer;
  const impacts = [...rule.impacts];
  if (highReach && !impacts.some(([team]) => team === 'Communications')) {
    impacts.push(['Communications', 'high reach may require aligned external messaging']);
  }
  return {
    crmChecks: rule.crmChecks,
    impacts: impacts.slice(0, 3).map(([team, reason]) => ({ team, reason })),
    actions: elevated
      ? rule.actions
      : [rule.actions[0], rule.actions[1], 'Monitor for recurrence before expanding the response.'],
  };
}
