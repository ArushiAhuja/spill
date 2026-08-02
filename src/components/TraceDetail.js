'use client'

import { useState } from 'react'

const mono = { fontFamily: 'var(--font-mono), ui-monospace, monospace' }

function Json({ title, value }) {
  return (
    <div>
      <div style={{ ...mono, color: '#475569', fontSize: 9, marginBottom: 4 }}>{title}</div>
      <pre style={{ margin: 0, padding: 8, overflow: 'auto', maxHeight: 180, whiteSpace: 'pre-wrap', fontSize: 10, background: '#0d0f1a', borderRadius: 5, color: '#94a3b8' }}>
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}

function decisionColor(decision) {
  if (decision === 'surfaced' || decision === 'surfaced_override') return '#4ade80'
  if (String(decision || '').includes('reject') || String(decision || '').includes('irrelevant')) return '#f87171'
  return '#fbbf24'
}

export function TraceDetail({ detail, onOverride, onRefresh }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  if (!detail?.trace) {
    return <div style={{ color: '#64748b', fontSize: 13, padding: 12 }}>Trace detail unavailable.</div>
  }

  const t = detail.trace
  const observations = Array.isArray(detail.observations) ? detail.observations : []
  const candidate = detail.candidate || {}
  const rejection = detail.rejection || {}
  const override = detail.override || {}
  const qa = detail.question_answers
  const why = qa?.why_surfaced

  const displayTitle = candidate.title || t.title || t.metadata?.title || 'Candidate signal'
  const displayBody = candidate.body || t.body || t.metadata?.body || t.metadata?.text || ''
  const displayUrl = candidate.url || t.url || t.metadata?.url || null
  const displayAuthor = candidate.author || t.author || t.metadata?.author || null
  const canOverride = override.available !== false && t.decision !== 'surfaced' && t.decision !== 'surfaced_override'

  async function handleOverride() {
    if (!onOverride) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await onOverride({ traceId: t.id, note })
      setMessage(`Surfaced on ${result.org_name || 'dashboard'}. Open /${result.org_slug || ''} to verify.`)
      setNote('')
      if (onRefresh) await onRefresh(t.id)
    } catch (e) {
      setError(e.message || 'Override failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ ...mono, color: '#60a5fa', fontSize: 10 }}>TRACE {String(t.id).slice(0, 8)}</div>
          <h2 style={{ fontSize: 16, margin: '6px 0' }}>{displayTitle}</h2>
          <div style={{ ...mono, fontSize: 10, color: '#64748b' }}>
            {t.org_name || 'org'} · {t.source || candidate.source || 'source'}
            {displayAuthor ? ` · @${displayAuthor}` : ''}
          </div>
        </div>
        <span style={{ color: decisionColor(t.decision), fontSize: 12, fontWeight: 600 }}>{t.decision}</span>
      </div>

      <div style={{ marginTop: 12, padding: 10, background: '#0d0f1a', borderRadius: 6, border: '1px solid #243047' }}>
        <div style={{ ...mono, color: '#94a3b8', fontSize: 9, marginBottom: 6 }}>ORIGINAL CONTENT</div>
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto', color: '#e2e8f0', fontSize: 12, lineHeight: 1.45 }}>
          {displayBody || 'No source body was stored on this trace. Expand Source Processing Agent below.'}
        </pre>
        {displayUrl && (
          <a href={displayUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 8, color: '#60a5fa', fontSize: 11 }}>
            open original source ↗
          </a>
        )}
      </div>

      <div style={{ marginTop: 12, padding: 10, background: String(t.decision).includes('reject') || String(t.decision).startsWith('suppressed') ? '#1a1010' : '#0d0f1a', borderRadius: 6, border: '1px solid #243047' }}>
        <div style={{ ...mono, color: '#94a3b8', fontSize: 9, marginBottom: 6 }}>WHY SPILL DECIDED THIS</div>
        <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.5 }}>
          {rejection.summary || why?.explanation || 'No rejection summary available.'}
        </div>
        {Array.isArray(rejection.lines) && rejection.lines.length > 1 && (
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: '#94a3b8', fontSize: 11, lineHeight: 1.45 }}>
            {rejection.lines.map((line) => <li key={line}>{line}</li>)}
          </ul>
        )}
        <div style={{ marginTop: 10, ...mono, color: '#64748b', fontSize: 10 }}>
          QUALITY · {t.quality?.score ?? rejection.quality_gate?.score ?? '—'}/100
          {' '}— relevance {t.quality?.relevance ?? '—'}, impact {t.quality?.impact ?? '—'}, confidence {t.quality?.confidence ?? '—'}
        </div>
      </div>

      {(canOverride || override.already_on_dashboard) && (
        <div style={{ marginTop: 12, padding: 10, background: '#12151e', borderRadius: 6, border: '1px solid #1d4ed8' }}>
          <div style={{ ...mono, color: '#93c5fd', fontSize: 9, marginBottom: 6 }}>OPERATOR OVERRIDE</div>
          {override.already_on_dashboard ? (
            <div style={{ fontSize: 12, color: '#86efac' }}>
              Already on the dashboard
              {override.dashboard_path && (
                <>
                  {' · '}
                  <a href={override.dashboard_path} style={{ color: '#60a5fa' }}>{override.dashboard_path}</a>
                </>
              )}
            </div>
          ) : (
            <>
              <p style={{ margin: '0 0 8px', fontSize: 12, color: '#94a3b8', lineHeight: 1.45 }}>
                Force this candidate onto the organisation Spill dashboard even though Spill rejected or suppressed it.
              </p>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note: why should this be shown?"
                rows={2}
                style={{ width: '100%', boxSizing: 'border-box', background: '#0d0f1a', color: '#e2e8f0', border: '1px solid #243047', borderRadius: 6, padding: 8, fontSize: 12, fontFamily: 'inherit' }}
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  disabled={busy || !onOverride}
                  onClick={handleOverride}
                  style={{ padding: '8px 12px', border: 0, borderRadius: 6, background: '#2563eb', color: 'white', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}
                >
                  {busy ? 'surfacing…' : 'override & show on dashboard'}
                </button>
                {override.dashboard_path && (
                  <span style={{ fontSize: 11, color: '#64748b' }}>Target: {override.dashboard_path}</span>
                )}
              </div>
            </>
          )}
          {message && <div style={{ marginTop: 8, color: '#4ade80', fontSize: 12 }}>{message}</div>}
          {error && <div style={{ marginTop: 8, color: '#f87171', fontSize: 12 }}>{error}</div>}
        </div>
      )}

      {observations.length === 0 && (
        <p style={{ color: '#64748b', fontSize: 12, marginTop: 12 }}>No agent observations recorded for this trace.</p>
      )}

      {observations.map((o) => (
        <details key={o.id} style={{ borderTop: '1px solid #1e2535', padding: '10px 0' }} open={/source processing|relevance|signal quality|operator override/i.test(o.name || '')}>
          <summary style={{ cursor: 'pointer', fontSize: 13 }}>
            {o.name}{' '}
            <span style={{ ...mono, color: '#64748b', fontSize: 10 }}>
              {o.model || o.kind} · {o.latency_ms || 0}ms · {o.input_tokens || 0}/{o.output_tokens || 0} tokens
            </span>
          </summary>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 9 }}>
            <Json title="input / prompt" value={o.input} />
            <Json title="output" value={o.output} />
          </div>
          {o.error && <div style={{ color: '#f87171', fontSize: 11 }}>{o.error}</div>}
        </details>
      ))}
    </>
  )
}
