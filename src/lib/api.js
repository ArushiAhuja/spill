const BASE = '/api'

function getToken() {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('spill_token')
}

async function request(method, path, body) {
  const token = getToken()
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  if (res.status === 401) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('spill_token')
      window.location.href = '/login'
    }
    throw new Error('unauthorized')
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

export const api = {
  // Auth
  signup: (body) => request('POST', '/auth/signup', body),
  login: (body) => request('POST', '/auth/login', body),

  // Orgs
  getOrgs: () => request('GET', '/orgs'),
  createOrg: (body) => request('POST', '/orgs', body),
  getOrg: (slug) => request('GET', `/orgs/${slug}`),
  updateOrg: (slug, body) => request('PATCH', `/orgs/${slug}`, body),

  // Sources
  getSources: (slug) => request('GET', `/orgs/${slug}/sources`),
  updateSource: (slug, source, body) => request('PATCH', `/orgs/${slug}/sources/${source}`, body),

  // Categories
  getCategories: (slug) => request('GET', `/orgs/${slug}/categories`),
  createCategory: (slug, body) => request('POST', `/orgs/${slug}/categories`, body),
  updateCategory: (slug, id, body) => request('PATCH', `/orgs/${slug}/categories/${id}`, body),
  deleteCategory: (slug, id) => request('DELETE', `/orgs/${slug}/categories/${id}`),

  // Escalations
  getEscalations: (slug) => request('GET', `/orgs/${slug}/escalations`),
  createEscalation: (slug, body) => request('POST', `/orgs/${slug}/escalations`, body),
  updateEscalation: (slug, id, body) => request('PATCH', `/orgs/${slug}/escalations/${id}`, body),
  deleteEscalation: (slug, id) => request('DELETE', `/orgs/${slug}/escalations/${id}`),
  testEscalation: (slug, id) => request('POST', `/orgs/${slug}/escalations/${id}/test`),

  // Posts
  getPosts: (slug, params = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params).filter(([, v]) => v != null && v !== '')
      )
    ).toString()
    return request('GET', `/orgs/${slug}/posts${qs ? `?${qs}` : ''}`)
  },
  updatePost: (slug, id, body) => request('PATCH', `/orgs/${slug}/posts/${id}`, body),
  getStatus: (slug) => request('GET', `/orgs/${slug}/status`),
  triggerRefresh: (slug) => request('POST', `/orgs/${slug}/refresh`),

  // Incidents
  getIncidents: (slug, status = 'open') => request('GET', `/orgs/${slug}/incidents?status=${status}`),
  resolveIncident: (slug, id) => request('PATCH', `/orgs/${slug}/incidents/${id}`, { status: 'resolved' }),
  patchIncident: (slug, id, body) => request('PATCH', `/orgs/${slug}/incidents/${id}`, body),

  // Stats
  getSentimentStats: (slug, days = 14) => request('GET', `/orgs/${slug}/stats?days=${days}`),
  getStats: (slug, days = 14) => request('GET', `/orgs/${slug}/stats?days=${days}`),
  getOperations: (slug) => request('GET', `/orgs/${slug}/operations`),

  // Post notes
  updatePostNotes: (slug, id, notes) => request('PATCH', `/orgs/${slug}/posts/${id}`, { notes }),

  // Post feedback (AI classification correction + learning)
  submitFeedback: (slug, id, body) => request('POST', `/orgs/${slug}/posts/${id}/feedback`, body),
  getPostFeedback: (slug, id) => request('GET', `/orgs/${slug}/posts/${id}/feedback`),

  // Org-level feedback history
  getFeedback: (slug, params = {}) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))).toString()
    return request('GET', `/orgs/${slug}/feedback${qs ? `?${qs}` : ''}`)
  },
  updateFeedback: (slug, id, body) => request('PATCH', `/orgs/${slug}/feedback/${id}`, body),
  deleteFeedback: (slug, id) => request('DELETE', `/orgs/${slug}/feedback/${id}`),

  // AI training data export (JSONL for OpenAI fine-tuning)
  getTrainingExport: (slug) => fetch(`/api/orgs/${slug}/training`, {
    headers: { Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('spill_token') : ''}` },
  }),

  // Date range posts
  getPostsInRange: (slug, from_date, to_date, params = {}) =>
    request('GET', `/orgs/${slug}/posts?${new URLSearchParams({ from_date, to_date, limit: 200, ...params }).toString()}`),

  // Digest test
  testDigest: (slug) => request('POST', `/orgs/${slug}/digest/test`),

  // Onboarding
  onboard: (slug) => request('POST', `/orgs/${slug}/onboard`),

  // Invitations
  getInvitations: (slug) => request('GET', `/orgs/${slug}/invitations`),
  createInvitation: (slug, body) => request('POST', `/orgs/${slug}/invitations`, body),
  revokeInvitation: (slug, id) => request('DELETE', `/orgs/${slug}/invitations/${id}`),
  resendInvitation: (slug, id) => request('POST', `/orgs/${slug}/invitations/${id}/resend`),

  // Activity log
  getActivity: (slug, params = {}) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))).toString()
    return request('GET', `/orgs/${slug}/activity${qs ? `?${qs}` : ''}`)
  },

  // Snooze
  snoozePost: (slug, id, until) => request('PATCH', `/orgs/${slug}/posts/${id}`, { snoozed_until: until || null }),

  // Tickets
  getTickets: (slug, params = {}) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))).toString()
    return request('GET', `/orgs/${slug}/tickets${qs ? `?${qs}` : ''}`)
  },
  createTicket: (slug, body) => request('POST', `/orgs/${slug}/tickets`, body),
  getTicket: (slug, id) => request('GET', `/orgs/${slug}/tickets/${id}`),
  updateTicket: (slug, id, body) => request('PATCH', `/orgs/${slug}/tickets/${id}`, body),
  addTicketNote: (slug, id, body) => request('POST', `/orgs/${slug}/tickets/${id}/notes`, body),
  bulkTickets: (slug, body) => request('POST', `/orgs/${slug}/tickets/bulk`, body),
  getAIResponse: (slug, id, body) => request('POST', `/orgs/${slug}/tickets/${id}/ai-response`, body),
  exportTickets: (slug, format = 'csv') => fetch(`/api/orgs/${slug}/tickets/export?format=${format}`, {
    headers: { Authorization: `Bearer ${getToken() || ''}` },
  }).then(async res => {
    if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || `HTTP ${res.status}`) }
    return format === 'json' ? res.json() : res.blob()
  }),

  // Prompt management
  listPrompts: (slug) => request('GET', `/orgs/${slug}/prompts`),
  getPrompt: (slug, key) => request('GET', `/orgs/${slug}/prompts/${key}`),
  savePrompt: (slug, key, body) => request('PUT', `/orgs/${slug}/prompts/${key}`, body),
  getPromptVersions: (slug, key) => request('GET', `/orgs/${slug}/prompts/${key}/versions`),
  rollbackPrompt: (slug, key, version) => request('POST', `/orgs/${slug}/prompts/${key}/rollback`, { version }),
  resetPrompt: (slug, key) => request('POST', `/orgs/${slug}/prompts/${key}/reset`),

  // Canned responses
  getCannedResponses: (slug) => request('GET', `/orgs/${slug}/canned-responses`),
  createCannedResponse: (slug, body) => request('POST', `/orgs/${slug}/canned-responses`, body),
  updateCannedResponse: (slug, id, body) => request('PATCH', `/orgs/${slug}/canned-responses/${id}`, body),
  deleteCannedResponse: (slug, id) => request('DELETE', `/orgs/${slug}/canned-responses/${id}`),

  // MMT features
  mmtGetSessions: (slug, date) => request('GET', `/orgs/${slug}/mmt/sessions${date ? `?date=${date}` : ''}`),
  mmtPostSession: (slug, body) => request('POST', `/orgs/${slug}/mmt/sessions`, body),
  mmtGetOutageLog: (slug) => request('GET', `/orgs/${slug}/mmt/outage-log`),
  mmtCreateOutage: (slug, body) => request('POST', `/orgs/${slug}/mmt/outage-log`, body),
  mmtUpdateOutage: (slug, id, body) => request('PATCH', `/orgs/${slug}/mmt/outage-log/${id}`, body),
  mmtGetSupervisor: (slug, days) => request('GET', `/orgs/${slug}/mmt/supervisor${days ? `?days=${days}` : ''}`),
  mmtTranslate: (slug, body) => request('POST', `/orgs/${slug}/mmt/translate`, body),

  // Hidden Spill operator console — server verifies super-admin access on every call.
  getObservabilityOverview: () => request('GET', '/internal/observability/overview'),
  getObservabilityTraces: (params = {}) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))).toString()
    return request('GET', `/internal/observability/traces${qs ? `?${qs}` : ''}`)
  },
  overrideObservabilityTrace: (trace_id, note = '') => request('POST', '/internal/observability/traces', { action: 'override', trace_id, note }),
  getObservabilityOperators: () => request('GET', '/internal/observability/operators'),
  setObservabilityOperator: (email, granted, org_id = null) => request('POST', '/internal/observability/operators', { email, granted, org_id }),
  createObservabilityWorkspace: (body) => request('POST', '/internal/observability/workspaces', body),
  // Prefer query params: some browsers/CDNs strip JSON bodies on DELETE.
  deleteObservabilityWorkspace: (org_id, confirmation) => {
    const qs = new URLSearchParams({
      org_id: String(org_id || ''),
      confirmation: String(confirmation || ''),
    }).toString()
    return request('DELETE', `/internal/observability/workspaces?${qs}`)
  },
  getObservabilityOrg: (id) => request('GET', `/internal/observability/organizations/${id}`),
  saveObservabilityPrompt: (id, body) => request('PUT', `/internal/observability/organizations/${id}`, body),
  rollbackObservabilityPrompt: (id, prompt_key, target_version) => request('PUT', `/internal/observability/organizations/${id}`, { prompt_key, target_version, action: 'rollback' }),
  saveObservabilityAgentConfig: (id, agent_name, config, change_summary = '') => request('PUT', `/internal/observability/organizations/${id}`, { action: 'save_agent_config', agent_name, config, change_summary }),
  saveObservabilityProfile: (id, organization_profile) => request('PUT', `/internal/observability/organizations/${id}`, { action: 'save_organization_profile', organization_profile }),
  runObservabilityPlayground: (body) => request('POST', '/internal/observability/playground', body),
  getObservabilityEvaluations: (org_id) => request('GET', `/internal/observability/evaluations?org_id=${encodeURIComponent(org_id)}`),
  createObservabilityEvaluationCase: (body) => request('POST', '/internal/observability/evaluations', { action: 'create_case', ...body }),
  runObservabilityEvaluation: (body) => request('POST', '/internal/observability/evaluations', { action: 'run', ...body }),
  createObservabilityExperiment: (body) => request('POST', '/internal/observability/evaluations', { action: 'create_experiment', ...body }),
}
