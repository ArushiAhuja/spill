'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

const card = { background: '#12151e', border: '1px solid #1e2535', borderRadius: 10, padding: 16 }
const mono = { fontFamily: 'var(--font-mono),ui-monospace,monospace' }

export default function OrgIntelligencePage({ params }) {
  const id = params.orgId
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [content, setContent] = useState('')
  const [summary, setSummary] = useState('')
  const [saving, setSaving] = useState(false)
  const [complaint, setComplaint] = useState('')
  const [override, setOverride] = useState('')
  const [model, setModel] = useState('gpt-4o-mini')
  const [run, setRun] = useState(null)
  const [running, setRunning] = useState(false)

  function choose(prompt) {
    setSelected(prompt.prompt_key)
    setContent(prompt.content)
    setSummary('')
  }

  async function load() {
    const next = await api.getObservabilityOrg(id)
    setData(next)
    if (!selected && next.prompts?.[0]) choose(next.prompts[0])
  }

  useEffect(() => { load().catch(e => setError(e.message)) }, [id])

  async function save() {
    setSaving(true)
    try {
      await api.saveObservabilityPrompt(id, { prompt_key: selected, content, change_summary: summary })
      await load()
      setSummary('')
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  async function rollback(version) {
    setSaving(true)
    try {
      await api.rollbackObservabilityPrompt(id, selected, version)
      await load()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  async function execute() {
    setRunning(true)
    setRun(null)
    try {
      const baseline = { org_id: id, complaint, prompt_key: selected || 'classifier_system', model }
      const current = await api.runObservabilityPlayground(baseline)
      const alternative = override.trim()
        ? await api.runObservabilityPlayground({ ...baseline, prompt_override: override })
        : null
      setRun({ current, alternative })
    } catch (e) { setError(e.message) } finally { setRunning(false) }
  }

  if (error) return <main style={{ padding: 40, color: '#f87171', background: '#0d0f1a', minHeight: '100vh' }}>Internal dashboard: {error}</main>
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

    <ContextPanel organization={data.organization} context={data.prompt_context} agentConfigs={data.agent_configs} />

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
          {run && <div style={{ display: 'grid', gridTemplateColumns: run.alternative ? '1fr 1fr' : '1fr', gap: 8, marginTop: 12 }}><RunResult title="Current" result={run.current} />{run.alternative && <RunResult title="Alternative" result={run.alternative} />}</div>}
        </div>
      </div>
    </section>
  </main>
}

function ContextPanel({ organization, context, agentConfigs }) {
  const customerInput = { description: organization.description || null, website: organization.website || null, competitors: organization.competitors || [], industry_keywords: organization.industry_keywords || [], partner_brands: organization.partner_brands || [] }
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
  </section>
}

function ContextValue({ title, value }) {
  return <details style={{ background: '#0d0f1a', border: '1px solid #243047', borderRadius: 7, padding: 9 }}><summary style={{ cursor: 'pointer', fontSize: 11, color: '#cbd5e1' }}>{title}</summary><pre style={{ margin: '9px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 10, color: '#94a3b8', maxHeight: 220, overflow: 'auto' }}>{JSON.stringify(value, null, 2)}</pre></details>
}

function RunResult({ title, result }) {
  return <div style={{ background: '#0d0f1a', padding: 10, borderRadius: 6 }}><div style={{ ...mono, color: '#60a5fa', fontSize: 10, marginBottom: 6 }}>{title.toUpperCase()} · {result.model} · {result.latency_ms}ms</div><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>relevance {result.metrics?.relevance ?? '—'} · escalation {result.metrics?.escalation_score ?? '—'} · accuracy {result.metrics?.classification_accuracy ?? 'needs label'} · hallucinations {result.metrics?.hallucinations ?? 'needs review'}</div><pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 10, color: '#cbd5e1' }}>{JSON.stringify(result.output, null, 2)}</pre></div>
}
