// Derives human-readable "why flagged" signals from a post's stored data.
// Pure function — no DB access, no side effects.

const DIM_LABELS = {
  customer_impact:    'customer impact',
  operational_urgency: 'operational urgency',
  trust_risk:         'trust risk',
  virality_potential: 'virality potential',
}

export function buildSignals(post) {
  const signals = []
  const dims = post.escalation_dimensions || {}
  const {
    customer_impact    = 0,
    operational_urgency = 0,
    trust_risk         = 0,
    virality_potential = 0,
  } = dims

  const hasDims = post.escalation_dimensions !== null && post.escalation_dimensions !== undefined

  // ── Trust risk ──────────────────────────────────────────────────────────
  if (trust_risk >= 7) {
    signals.push({ id: 'trust_risk', label: 'high trust risk', detail: `${trust_risk}/10`, color: '#f87171', priority: 100 })
  } else if (trust_risk >= 4) {
    signals.push({ id: 'trust_risk', label: 'trust concern', detail: `${trust_risk}/10`, color: '#f59e0b', priority: 65 })
  }

  // ── Customer impact ──────────────────────────────────────────────────────
  if (customer_impact >= 7) {
    signals.push({ id: 'customer_impact', label: 'high customer impact', detail: `${customer_impact}/10`, color: '#f87171', priority: 95 })
  } else if (customer_impact >= 4) {
    signals.push({ id: 'customer_impact', label: 'customer impact', detail: `${customer_impact}/10`, color: '#f59e0b', priority: 60 })
  }

  // ── Operational urgency ──────────────────────────────────────────────────
  if (operational_urgency >= 7) {
    signals.push({ id: 'operational_urgency', label: 'urgent — respond now', detail: `${operational_urgency}/10`, color: '#f87171', priority: 90 })
  } else if (operational_urgency >= 4) {
    signals.push({ id: 'operational_urgency', label: 'operational flag', detail: `${operational_urgency}/10`, color: '#f59e0b', priority: 55 })
  }

  // ── Virality ─────────────────────────────────────────────────────────────
  if (virality_potential >= 7) {
    signals.push({ id: 'virality', label: 'viral potential', detail: `${virality_potential}/10`, color: '#818cf8', priority: 75 })
  } else if (virality_potential >= 4) {
    signals.push({ id: 'virality', label: 'spreading', detail: `${virality_potential}/10`, color: '#64748b', priority: 30 })
  }

  // ── Category ─────────────────────────────────────────────────────────────
  if (post.category_name) {
    signals.push({
      id: 'category',
      label: `matches ${post.category_name}`,
      color: post.category_color || '#60a5fa',
      priority: 50,
    })
  }

  // ── Previous positive feedback ────────────────────────────────────────────
  if (post.positive_feedback_count > 0) {
    signals.push({ id: 'feedback', label: 'previously marked relevant', color: '#4ade80', priority: 85 })
  }

  // ── Competitor mention ────────────────────────────────────────────────────
  if (post.is_competitor && post.competitor_name) {
    signals.push({ id: 'competitor', label: `competitor — ${post.competitor_name}`, color: '#f59e0b', priority: 70 })
  }

  // ── Influencer ────────────────────────────────────────────────────────────
  if (post.is_influencer) {
    signals.push({ id: 'influencer', label: 'influencer account', color: '#60a5fa', priority: 68 })
  }

  // ── Engagement ────────────────────────────────────────────────────────────
  const eng = post.raw_engagement || 0
  if (eng >= 500) {
    signals.push({ id: 'engagement', label: `${eng.toLocaleString()} upvotes`, color: '#60a5fa', priority: 40 })
  } else if (eng >= 100) {
    signals.push({ id: 'engagement', label: `${eng} engagement`, color: '#334155', priority: 25 })
  }

  // Sort by priority descending
  signals.sort((a, b) => b.priority - a.priority)
  return signals
}

// Returns a compact description sentence for a post's top signal.
// Used in notification bodies, digest summaries, etc.
export function topSignalText(post) {
  const signals = buildSignals(post)
  if (!signals.length) return `escalation score ${post.escalation_score || 0}`
  const top = signals[0]
  return top.detail ? `${top.label} (${top.detail})` : top.label
}

// Builds the 4-dimension array for display as bars.
export function buildDimensions(post) {
  const dims = post.escalation_dimensions
  if (!dims) return null
  return [
    { key: 'customer_impact',    label: 'customer impact',    value: dims.customer_impact    || 0 },
    { key: 'operational_urgency', label: 'operational urgency', value: dims.operational_urgency || 0 },
    { key: 'trust_risk',         label: 'trust risk',         value: dims.trust_risk         || 0 },
    { key: 'virality_potential', label: 'virality potential', value: dims.virality_potential  || 0 },
  ]
}
