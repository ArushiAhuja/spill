'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { TraceDetail } from '@/components/TraceDetail'

const card = { background: '#12151e', border: '1px solid #1e2535', borderRadius: 10, padding: 16 }
const mono = { fontFamily: 'var(--font-mono),ui-monospace,monospace' }

export default function OrgIntelligencePage({ params }) {
  const id = params.orgId
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [pageError, setPageError] = useState('')
  const [selected, setSelected] = useState(null)
  const [content, setContent] = useState('')
  const [summary, setSummary] = useState('')
  const [saving, setSaving] = useState(false)
  const [complaint, setComplaint] = useState('')
  const [override, setOverride] = useState('')
  const [model, setModel] = useState('gpt-4o-mini')
  const [run, setRun] = useState(null)
  const [running, setRunning] = useState(false)
  const [evaluations, setEvaluations] = useState(null)
  const [evaluating, setEvaluating] = useState(false)
  const [selectedTraceId, setSelectedTraceId] = useState(null)
  const [traceDetail, setTraceDetail] = useState(null)
  const [traceError, setTraceError] = useState('')
  const [traceLoading, setTraceLoading] = useState(false)
  const [traceList, setTraceList] = useState([])
  const [tracePage, setTracePage] = useState(null)
  const [traceTotals, setTraceTotals] = useState(null)
  const [traceRange, setTraceRange] = useState('all')
  const [traceDecision, setTraceDecision] = useState('all')
  const [traceQuery, setTraceQuery] = useState('')
  const [traceListLoading, setTraceListLoading] = useState(false)
  const [traceListBusy, setTraceListBusy] = useState(false)

  function choose(prompt) {
    setSelected(prompt.prompt_key)
    setContent(prompt.content)
    setSummary('')
  }

  async function loadTraces({ append = false, before = null } = {}) {
    if (append) setTraceListBusy(true)
    else setTraceListLoading(true)
    setTraceError('')
    try {
      const result = await api.getObservabilityTraces({
        org_id: id,
        range: traceRange,
        decision: traceDecision === 'all' ? undefined : traceDecision,
        q: traceQuery.trim() || undefined,
        limit: 100,
        before: before || undefined,
      })
      const next = result.traces || []
      setTraceList((prev) => (append ? [...prev, ...next] : next))
      setTracePage(result.page || null)
      setTraceTotals(result.totals || null)
    } catch (e) {
      setTraceError(e.message)
      if (!append) setTraceList([])
    } finally {
      setTraceListLoading(false)
      setTraceListBusy(false)
    }
  }

  async function load() {
    const [next, evaluationData] = await Promise.all([api.getObservabilityOrg(id), api.getObservabilityEvaluations(id)])
    setData(next)
    setEvaluations(evaluationData)
    if (!selected && next.prompts?.[0]) choose(next.prompts[0])
  }

  useEffect(() => { load().catch(e => setPageError(e.message)) }, [id])
  useEffect(() => { loadTraces().catch(() => {}) }, [id, traceRange, traceDecision])

  async function openTrace(traceId) {
    setTraceLoading(true)
    setTraceError('')
    try {
      const detail = await api.getObservabilityTraces({ trace_id: traceId, org_id: id })
      setSelectedTraceId(traceId)
      setTraceDetail(detail)
    } catch (e) {
      setTraceError(e.message)
    } finally {
      setTraceLoading(false)
    }
  }

  async function overrideTrace({ traceId, note }) {
    const result = await api.overrideObservabilityTrace(traceId, note)
    const detail = await api.getObservabilityTraces({ trace_id: traceId, org_id: id })
    setTraceDetail(detail)
    return result
  }

  async function suppressTrace({ traceId, label, note }) {
    const result = await api.confirmObservabilityTraceSuppression(traceId, { label, note })
    const detail = await api.getObservabilityTraces({ trace_id: traceId, org_id: id })
    setTraceDetail(detail)
    return result
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      await api.saveObservabilityPrompt(id, { prompt_key: selected, content, change_summary: summary })
      await load()
      setSummary('')
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  async function rollback(version) {
    setSaving(true)
    setError('')
    try {
      await api.rollbackObservabilityPrompt(id, selected, version)
      await load()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  async function execute() {
    setRunning(true)
    setRun(null)
    setError('')
    try {
      const baseline = { org_id: id, complaint, prompt_key: selected || 'classifier_system', model }
      const current = await api.runObservabilityPlayground(baseline)
      const alternative = override.trim()
        ? await api.runObservabilityPlayground({ ...baseline, prompt_override: override })
        : null
      setRun({ current, alternative })
    } catch (e) { setError(e.message) } finally { setRunning(false) }
  }

  async function saveAgentConfig(agentName, config, changeSummary) {
    setSaving(true)
    setError('')
    try { await api.saveObservabilityAgentConfig(id, agentName, config, changeSummary); await load() } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  async function saveProfile(profile) {
    setSaving(true)
    setError('')
    try { await api.saveObservabilityProfile(id, profile); await load() } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  async function runEvaluation() {
    const agent = data.agent_configs?.find(config => config.prompt_key === selected) || data.agent_configs?.find(config => config.agent_name === 'category')
    setEvaluating(true)
    setError('')
    try { await api.runObservabilityEvaluation({ org_id: id, agent_name: agent?.agent_name || 'category', prompt_key: selected || 'classifier_system', model }); await load() } catch (e) { setError(e.message) } finally { setEvaluating(false) }
  }

  async function createEvaluationCase(input, expected_output, bucket) {
    const agent = data.agent_configs?.find(config => config.prompt_key === selected) || data.agent_configs?.find(config => config.agent_name === 'category')
    setError('')
    try { await api.createObservabilityEvaluationCase({ org_id: id, agent_name: agent?.agent_name || 'category', input, expected_output, bucket }); await load() } catch (e) { setError(e.message) }
  }

  async function saveExperiment() {
    const agent = data.agent_configs?.find(config => config.prompt_key === selected) || data.agent_configs?.find(config => config.agent_name === 'category')
    setError('')
    try { await api.createObservabilityExperiment({ org_id: id, agent_name: agent?.agent_name || 'category', prompt_key: selected || 'classifier_system', baseline_content: content, candidate_content: override, baseline_model: model, candidate_model: model }); await load() } catch (e) { setError(e.message) }
  }

  if (pageError) return <main style={{ padding: 40, color: '#f87171', background: '#0d0f1a', minHeight: '100vh' }}>Internal dashboard: {pageError}</main>
  if (!data) return <main style={{ padding: 40, color: '#94a3b8', background: '#0d0f1a', minHeight: '100vh' }}>Loading organisation intelligence…</main>

  const active = data.prompts?.find(p => p.prompt_key === selected)
  const metrics = [
    ['events', data.metrics.total_events], ['surfaced', data.metrics.surfaced], ['suppressed', data.metrics.suppressed],
    ['avg relevance', data.metrics.avg_relevance ?? '—'], ['avg escalation', data.metrics.avg_escalation ?? '—'],
    ['last event', data.metrics.last_event_at ? new Date(data.metrics.last_event_at).toLocaleDateString() : '—'],
  ]

  return <main style={{ minHeight: '100vh', background: '#0d0f1a', color: '#e2e8f0', padding: '32px clamp(18px,4vw,56px)', fontFamily: 'system-ui,sans-serif' }}>
    <Link href="/internal/intelligence" style={{ color: '#60a5fa', fontSize: 12, textDecoration: 'none' }}>← all organisations</Link>
    <div style={{ margin: '16px 0 24px' }}>
      <div style={{ ...mono, color: '#60a5fa', fontSize: 10 }}>ORGANISATION INTELLIGENCE</div>
      <h1 style={{ margin: '6px 0', fontSize: 26 }}>{data.organization.name}</h1>
      <div style={{ color: '#64748b', fontSize: 12 }}>{data.organization.slug} · {data.organization.active_sources?.join(' · ') || 'No active sources'}</div>
    </div>

    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 18 }}>
      {metrics.map(([label, value]) => <div key={label} style={card}><div style={{ ...mono, fontSize: 9, color: '#64748b' }}>{label}</div><div style={{ fontSize: 18, marginTop: 4 }}>{value}</div></div>)}
    </section>

    <section style={{ ...card, marginBottom: 18 }}>
      <div style={{ ...mono, fontSize: 10, color: '#94a3b8', marginBottom: 10 }}>AGENT PIPELINE</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {data.agents.map(agent => <div key={`${agent.name}-${agent.model}`} style={{ border: '1px solid #243047', borderRadius: 7, padding: '8px 10px', minWidth: 160 }}>
          <div style={{ fontSize: 12 }}>{agent.name}</div>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>{agent.model} · prompt v{agent.prompt_version ?? 0}</div>
          <div style={{ fontSize: 10, color: '#64748b' }}>{agent.successful}/{agent.executions} successful · last {agent.last_execution ? new Date(agent.last_execution).toLocaleString() : '—'}</div>
        </div>)}
      </div>
    </section>

    {error && <div style={{ ...card, marginBottom: 18, color: '#f87171', fontSize: 12 }}>{error}</div>}

    <RecentTraces
      traces={traceList}
      selectedId={selectedTraceId}
      detail={traceDetail}
      loading={traceLoading}
      listLoading={traceListLoading}
      listBusy={traceListBusy}
      error={traceError}
      range={traceRange}
      decision={traceDecision}
      query={traceQuery}
      page={tracePage}
      totals={traceTotals}
      onRange={setTraceRange}
      onDecision={setTraceDecision}
      onQuery={setTraceQuery}
      onSearch={() => loadTraces()}
      onLoadOlder={() => loadTraces({ append: true, before: tracePage?.next_before })}
      onOpen={openTrace}
      onOverride={overrideTrace}
      onSuppress={suppressTrace}
    />

    <ContextPanel organization={data.organization} context={data.prompt_context} agentConfigs={data.agent_configs} saving={saving} onSaveProfile={saveProfile} />
    <AgentConfigPanel configs={data.agent_configs} versions={data.agent_config_versions} saving={saving} onSave={saveAgentConfig} />
    <EvaluationPanel evaluations={evaluations} running={evaluating} onRun={runEvaluation} onCreate={createEvaluationCase} />

    <section style={{ display: 'grid', gridTemplateColumns: 'minmax(190px,260px) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
      <div style={card}>
        <div style={{ ...mono, fontSize: 10, color: '#94a3b8', marginBottom: 8 }}>PROMPTS</div>
        {data.prompts.map(prompt => <button key={prompt.prompt_key} onClick={() => choose(prompt)} style={{ width: '100%', textAlign: 'left', padding: 9, marginBottom: 5, border: '1px solid #243047', borderRadius: 6, background: selected === prompt.prompt_key ? '#191d2b' : 'transparent', color: '#e2e8f0', cursor: 'pointer' }}>
          <div style={{ fontSize: 12 }}>{prompt.name}</div>
          <div style={{ fontSize: 10, color: '#64748b' }}>v{prompt.version} · {prompt.is_default ? 'global instruction' : 'org instruction override'} · company context injected</div>
        </button>)}
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <div><div style={{ ...mono, fontSize: 10, color: '#94a3b8' }}>PROMPT MANAGEMENT</div><div style={{ fontSize: 14, marginTop: 3 }}>{active?.name}</div></div>
            <span style={{ fontSize: 11, color: active?.is_default ? '#fbbf24' : '#4ade80' }}>{active?.is_default ? 'global instruction' : 'organisation override'}</span>
          </div>
          <p style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>Edit reusable instructions below. Spill adds the organisation context shown above to each agent run; use the read-only preview to audit the complete effective prompt.</p>
          <textarea value={content} onChange={e => setContent(e.target.value)} rows={13} style={{ width: '100%', boxSizing: 'border-box', background: '#0d0f1a', color: '#d1d5db', border: '1px solid #243047', borderRadius: 7, padding: 10, fontSize: 12, fontFamily: 'ui-monospace,monospace' }} />
          <input value={summary} onChange={e => setSummary(e.target.value)} placeholder="Change summary for version history" style={{ marginTop: 8, width: '100%', boxSizing: 'border-box', background: '#0d0f1a', color: '#e2e8f0', border: '1px solid #243047', borderRadius: 6, padding: 8, fontSize: 12 }} />
          <button onClick={save} disabled={saving || !selected} style={{ marginTop: 8, padding: '8px 12px', background: '#2563eb', color: 'white', border: 0, borderRadius: 6, cursor: 'pointer' }}>{saving ? 'saving…' : 'save new version'}</button>
          <details open style={{ marginTop: 14, borderTop: '1px solid #1e2535', paddingTop: 12 }}>
            <summary style={{ ...mono, fontSize: 10, color: '#60a5fa', cursor: 'pointer' }}>EFFECTIVE PROMPT PREVIEW — company context included</summary>
            <pre style={{ margin: '9px 0 0', maxHeight: 440, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 10.5, lineHeight: 1.5, background: '#0d0f1a', color: '#cbd5e1', padding: 10, borderRadius: 6 }}>{active?.effective_content || 'Select a prompt to preview its runtime context.'}</pre>
          </details>
          <div style={{ marginTop: 14, ...mono, fontSize: 10, color: '#64748b' }}>VERSION HISTORY</div>
          {(data.versions?.[selected] || []).map(version => <div key={version.id} style={{ borderTop: '1px solid #1e2535', padding: '8px 0', fontSize: 11 }}>
            v{version.version} · {version.author_email || 'Spill internal'} · {new Date(version.created_at).toLocaleString()}<br />
            <span style={{ color: '#64748b' }}>{version.change_summary || 'No summary'}</span>
            <button disabled={saving || version.version === active?.version} onClick={() => rollback(version.version)} style={{ marginLeft: 8, padding: '3px 6px', border: '1px solid #475569', borderRadius: 4, background: 'transparent', color: '#93c5fd', cursor: 'pointer', fontSize: 10 }}>{version.version === active?.version ? 'current' : 'restore this version'}</button>
          </div>)}
        </div>

        <div style={card}>
          <div style={{ ...mono, fontSize: 10, color: '#94a3b8' }}>AGENT PLAYGROUND</div>
          <p style={{ fontSize: 12, color: '#64748b' }}>Runs the effective {data.organization.name} prompt first, then an optional alternative using the chosen model. Playground changes are never saved automatically.</p>
          <textarea value={complaint} onChange={e => setComplaint(e.target.value)} rows={4} placeholder="Example customer complaint" style={{ width: '100%', boxSizing: 'border-box', background: '#0d0f1a', color: '#e2e8f0', border: '1px solid #243047', borderRadius: 6, padding: 8 }} />
          <textarea value={override} onChange={e => setOverride(e.target.value)} rows={4} placeholder="Optional alternative instruction" style={{ width: '100%', boxSizing: 'border-box', marginTop: 8, background: '#0d0f1a', color: '#e2e8f0', border: '1px solid #243047', borderRadius: 6, padding: 8 }} />
          <select value={model} onChange={e => setModel(e.target.value)} style={{ marginTop: 8, background: '#0d0f1a', color: '#e2e8f0', border: '1px solid #243047', borderRadius: 6, padding: 8 }}><option>gpt-4o-mini</option><option>gpt-4o</option></select>
          <button disabled={running || !complaint.trim()} onClick={execute} style={{ marginLeft: 8, padding: '8px 12px', background: '#2563eb', color: 'white', border: 0, borderRadius: 6, cursor: 'pointer' }}>{running ? 'running…' : 'run comparison'}</button>
          {run && <><div style={{ display: 'grid', gridTemplateColumns: run.alternative ? '1fr 1fr' : '1fr', gap: 8, marginTop: 12 }}><RunResult title="Current" result={run.current} />{run.alternative && <RunResult title="Alternative" result={run.alternative} />}</div>{run.alternative && <button onClick={saveExperiment} style={{ marginTop: 8, padding: '7px 10px', background: 'transparent', color: '#93c5fd', border: '1px solid #475569', borderRadius: 6, cursor: 'pointer' }}>save A/B experiment</button>}</>}
        </div>
      </div>
    </section>
  </main>
}

function RecentTraces({
  traces,
  selectedId,
  detail,
  loading,
  listLoading,
  listBusy,
  error,
  range,
  decision,
  query,
  page,
  totals,
  onRange,
  onDecision,
  onQuery,
  onSearch,
  onLoadOlder,
  onOpen,
  onOverride,
  onSuppress,
}) {
  const oldestShown = traces?.length ? traces[traces.length - 1]?.created_at : null
  return (
    <section style={{ display: 'grid', gridTemplateColumns: 'minmax(280px,1fr) minmax(320px,1.1fr)', gap: 12, marginBottom: 18, alignItems: 'start' }}>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', marginBottom: 8 }}>
          <div style={{ ...mono, fontSize: 10, color: '#94a3b8' }}>TRACE HISTORY</div>
          <div style={{ ...mono, fontSize: 9, color: '#64748b' }}>
            {totals?.total != null ? `${traces?.length || 0} shown · ${totals.total} total` : `${traces?.length || 0} shown`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {['all', '7d', '30d', '24h', '6h'].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onRange(r)}
              style={{
                padding: '4px 8px',
                borderRadius: 999,
                border: range === r ? '1px solid #2563eb' : '1px solid #243047',
                background: range === r ? '#1e3a8a' : 'transparent',
                color: range === r ? '#dbeafe' : '#94a3b8',
                cursor: 'pointer',
                fontSize: 10,
                fontFamily: 'inherit',
              }}
            >
              {r === 'all' ? 'all time' : r}
            </button>
          ))}
          <select
            value={decision}
            onChange={(e) => onDecision(e.target.value)}
            style={{ background: '#0d0f1a', color: '#e2e8f0', border: '1px solid #243047', borderRadius: 6, padding: '4px 6px', fontSize: 10 }}
          >
            <option value="all">all decisions</option>
            <option value="rejected">rejected</option>
            <option value="suppressed">suppressed</option>
            <option value="surfaced">surfaced</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSearch() }}
            placeholder="Search title, source, decision…"
            style={{ flex: 1, background: '#0d0f1a', color: '#e2e8f0', border: '1px solid #243047', borderRadius: 6, padding: '6px 8px', fontSize: 11 }}
          />
          <button type="button" onClick={onSearch} style={{ padding: '6px 10px', border: 0, borderRadius: 6, background: '#2563eb', color: 'white', cursor: 'pointer', fontSize: 11 }}>search</button>
        </div>
        {totals?.oldest && (
          <div style={{ ...mono, fontSize: 9, color: '#475569', marginBottom: 8 }}>
            oldest available {new Date(totals.oldest).toLocaleString()}
            {oldestShown ? ` · oldest loaded ${new Date(oldestShown).toLocaleString()}` : ''}
          </div>
        )}
        <div style={{ maxHeight: 520, overflow: 'auto' }}>
          {listLoading ? (
            <p style={{ color: '#64748b', fontSize: 12 }}>Loading history…</p>
          ) : traces?.length ? traces.map(trace => (
            <button
              key={trace.id}
              type="button"
              onClick={() => onOpen(trace.id)}
              style={{
                width: '100%',
                textAlign: 'left',
                border: 'none',
                borderTop: '1px solid #1e2535',
                background: selectedId === trace.id ? '#191d2b' : 'transparent',
                color: 'inherit',
                padding: '10px 2px',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <div style={{ fontSize: 11 }}>
                <span style={{ color: trace.decision === 'surfaced' || trace.decision === 'surfaced_override' ? '#4ade80' : (String(trace.decision || '').includes('reject') ? '#f87171' : '#fbbf24') }}>{trace.decision}</span>
                {' · '}{trace.title || 'candidate signal'}
              </div>
              <div style={{ ...mono, color: '#64748b', fontSize: 9, marginTop: 3 }}>
                {trace.trace_key || trace.id} · {trace.source} · {new Date(trace.created_at).toLocaleString()}
              </div>
            </button>
          )) : <p style={{ color: '#64748b', fontSize: 12 }}>No recorded traces in this range.</p>}
        </div>
        {page?.has_more && (
          <button
            type="button"
            disabled={listBusy}
            onClick={onLoadOlder}
            style={{ marginTop: 10, width: '100%', padding: '8px 10px', border: '1px solid #243047', borderRadius: 6, background: '#191d2b', color: '#93c5fd', cursor: 'pointer', fontSize: 11 }}
          >
            {listBusy ? 'loading older…' : 'load older traces'}
          </button>
        )}
      </div>
      <div style={card}>
        {error && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 8 }}>{error}</div>}
        {loading && <div style={{ color: '#64748b', fontSize: 12 }}>Loading trace…</div>}
        {!loading && detail ? (
          <TraceDetail detail={detail} onOverride={onOverride} onSuppress={onSuppress} onRefresh={onOpen} />
        ) : !loading && (
          <div style={{ color: '#64748b', fontSize: 12, padding: 8 }}>
            Select a trace to inspect the original content, why Spill rejected/suppressed it, and optionally override it onto the dashboard.
          </div>
        )}
      </div>
    </section>
  )
}

function AgentConfigPanel({ configs, versions, saving, onSave }) {
  const [selected, setSelected] = useState(configs?.[0]?.agent_name || '')
  const config = configs?.find(item => item.agent_name === selected) || configs?.[0]
  const [draft, setDraft] = useState('')
  const [summary, setSummary] = useState('')
  useEffect(() => { if (config) setDraft(JSON.stringify({ enabled: config.enabled, model: config.model, priority_instructions: config.priority_instructions, ignore_instructions: config.ignore_instructions, escalation_rules: config.escalation_rules, evaluation_criteria: config.evaluation_criteria, examples: config.examples }, null, 2)) }, [selected, configs])
  if (!config) return null
  async function save() { try { await onSave(config.agent_name, JSON.parse(draft), summary) } catch { /* parent reports parse/API error */ } }
  return <section style={{ ...card, marginBottom: 18 }}>
    <div style={{ ...mono, fontSize: 10, color: '#94a3b8' }}>AGENT CONFIGURATION REGISTRY</div>
    <p style={{ fontSize: 12, color: '#94a3b8' }}>These policies are compiled into organisation-specific runtime instructions. Saving creates an immutable agent-config version.</p>
    <select value={selected} onChange={e => setSelected(e.target.value)} style={{ background: '#0d0f1a', color: '#e2e8f0', border: '1px solid #243047', borderRadius: 6, padding: 8 }}>{configs.map(item => <option key={item.agent_name} value={item.agent_name}>{item.name}</option>)}</select>
    <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={11} style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 8, background: '#0d0f1a', color: '#d1d5db', border: '1px solid #243047', borderRadius: 7, padding: 10, fontSize: 11, fontFamily: 'ui-monospace,monospace' }} />
    <input value={summary} onChange={e => setSummary(e.target.value)} placeholder="Why this agent policy changed" style={{ marginTop: 8, width: '100%', boxSizing: 'border-box', background: '#0d0f1a', color: '#e2e8f0', border: '1px solid #243047', borderRadius: 6, padding: 8, fontSize: 12 }} />
    <button disabled={saving} onClick={save} style={{ marginTop: 8, padding: '8px 12px', background: '#2563eb', color: 'white', border: 0, borderRadius: 6, cursor: 'pointer' }}>{saving ? 'saving…' : 'save agent configuration'}</button>
    <div style={{ marginTop: 12, fontSize: 11, color: '#64748b' }}>Version history: {(versions?.[config.agent_name] || []).map(v => `v${v.version}`).join(' · ') || 'no saved organisation override yet'}</div>
  </section>
}

function EvaluationPanel({ evaluations, running, onRun, onCreate }) {
  const latest = evaluations?.runs?.[0]
  const [text, setText] = useState('')
  const [expected, setExpected] = useState('{\n  "relevant": true,\n  "category": ""\n}')
  const [bucket, setBucket] = useState('good_signal')
  async function create() { try { await onCreate({ text }, JSON.parse(expected), bucket); setText('') } catch { /* invalid JSON is not persisted */ } }
  return <section style={{ ...card, marginBottom: 18 }}>
    <div style={{ ...mono, fontSize: 10, color: '#94a3b8' }}>QUALITY & EVALUATION</div>
    <p style={{ fontSize: 12, color: '#94a3b8' }}>Feedback automatically becomes labelled good-signal, bad-signal, or borderline evaluation cases. Run the selected prompt against that organisation-specific dataset.</p>
    <div style={{ fontSize: 12, color: '#cbd5e1' }}>{evaluations?.cases?.length || 0} labelled cases · {evaluations?.runs?.length || 0} saved runs</div>
    <button disabled={running || !(evaluations?.cases?.length)} onClick={onRun} style={{ marginTop: 8, padding: '8px 12px', background: '#2563eb', color: 'white', border: 0, borderRadius: 6, cursor: 'pointer' }}>{running ? 'evaluating…' : 'run evaluation dataset'}</button>
    <details style={{ marginTop: 10 }}><summary style={{ cursor: 'pointer', fontSize: 11, color: '#60a5fa' }}>add labelled evaluation case</summary><textarea value={text} onChange={e => setText(e.target.value)} rows={3} placeholder="Historical customer signal" style={{ marginTop: 8, width: '100%', boxSizing: 'border-box', background: '#0d0f1a', color: '#e2e8f0', border: '1px solid #243047', borderRadius: 6, padding: 8 }} /><textarea value={expected} onChange={e => setExpected(e.target.value)} rows={4} style={{ marginTop: 8, width: '100%', boxSizing: 'border-box', background: '#0d0f1a', color: '#e2e8f0', border: '1px solid #243047', borderRadius: 6, padding: 8, fontFamily: 'ui-monospace,monospace', fontSize: 11 }} /><select value={bucket} onChange={e => setBucket(e.target.value)} style={{ marginTop: 8, background: '#0d0f1a', color: '#e2e8f0', border: '1px solid #243047', borderRadius: 6, padding: 7 }}><option value="good_signal">good signal</option><option value="bad_signal">bad signal</option><option value="borderline">borderline</option></select><button disabled={!text.trim()} onClick={create} style={{ marginLeft: 8, padding: '7px 10px', background: '#2563eb', color: 'white', border: 0, borderRadius: 6, cursor: 'pointer' }}>save case</button></details>
    {latest && <pre style={{ marginTop: 10, whiteSpace: 'pre-wrap', fontSize: 10, color: '#94a3b8', background: '#0d0f1a', padding: 8, borderRadius: 6 }}>{JSON.stringify(latest.metrics, null, 2)}</pre>}
  </section>
}

function ContextPanel({ organization, context, agentConfigs, saving, onSaveProfile }) {
  const customerInput = { description: organization.description || null, website: organization.website || null, competitors: organization.competitors || [], industry_keywords: organization.industry_keywords || [], partner_brands: organization.partner_brands || [], organization_profile: organization.organization_profile || {} }
  return <section style={{ ...card, marginBottom: 18 }}>
    <div style={{ ...mono, fontSize: 10, color: '#94a3b8' }}>ORGANISATION CONTEXT APPLIED TO EVERY AGENT</div>
    <p style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>The prompt editor holds reusable instructions. Spill automatically adds this company context at runtime, so a global instruction is still personalised for {organization.name}.</p>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: 10 }}>
      <ContextValue title="customer-provided company data" value={customerInput} />
      <ContextValue title="Spill's inferred intelligence" value={context?.inferred_intelligence || {}} />
      <ContextValue title="configured monitoring categories" value={context?.categories || []} />
      <ContextValue title="monitoring configuration (credentials excluded)" value={context?.monitoring_sources || []} />
      <ContextValue title="organisation-specific agent configuration" value={agentConfigs || []} />
    </div>
    <ProfileEditor profile={organization.organization_profile || {}} saving={saving} onSave={onSaveProfile} />
  </section>
}

function ProfileEditor({ profile, saving, onSave }) {
  const [draft, setDraft] = useState(JSON.stringify(profile, null, 2))
  useEffect(() => setDraft(JSON.stringify(profile, null, 2)), [profile])
  async function save() { try { await onSave(JSON.parse(draft)) } catch { /* invalid JSON is intentionally not persisted */ } }
  return <details style={{ marginTop: 12 }}><summary style={{ cursor: 'pointer', fontSize: 11, color: '#60a5fa' }}>edit human-approved organisation profile</summary><p style={{ fontSize: 11, color: '#94a3b8' }}>Use fields such as <code>industry</code>, <code>products_services</code>, <code>customer_personas</code>, <code>business_functions</code>, <code>priority_issues</code>, <code>risk_categories</code>, <code>terminology</code>, and <code>escalation_rules</code>.</p><textarea value={draft} onChange={e => setDraft(e.target.value)} rows={10} style={{ width: '100%', boxSizing: 'border-box', background: '#0d0f1a', color: '#d1d5db', border: '1px solid #243047', borderRadius: 7, padding: 10, fontSize: 11, fontFamily: 'ui-monospace,monospace' }} /><button disabled={saving} onClick={save} style={{ marginTop: 8, padding: '7px 10px', background: '#2563eb', color: 'white', border: 0, borderRadius: 6, cursor: 'pointer' }}>{saving ? 'saving…' : 'save organisation profile'}</button></details>
}

function ContextValue({ title, value }) {
  return <details style={{ background: '#0d0f1a', border: '1px solid #243047', borderRadius: 7, padding: 9 }}><summary style={{ cursor: 'pointer', fontSize: 11, color: '#cbd5e1' }}>{title}</summary><pre style={{ margin: '9px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 10, color: '#94a3b8', maxHeight: 220, overflow: 'auto' }}>{JSON.stringify(value, null, 2)}</pre></details>
}

function RunResult({ title, result }) {
  return <div style={{ background: '#0d0f1a', padding: 10, borderRadius: 6 }}><div style={{ ...mono, color: '#60a5fa', fontSize: 10, marginBottom: 6 }}>{title.toUpperCase()} · {result.model} · {result.latency_ms}ms</div><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>relevance {result.metrics?.relevance ?? '—'} · escalation {result.metrics?.escalation_score ?? '—'} · accuracy {result.metrics?.classification_accuracy ?? 'needs label'} · hallucinations {result.metrics?.hallucinations ?? 'needs review'}</div><pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 10, color: '#cbd5e1' }}>{JSON.stringify(result.output, null, 2)}</pre></div>
}
