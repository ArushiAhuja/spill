'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api'
import { timeAgo } from '@/lib/auth'

const PROMPT_LABELS = {
  relevance_filter:   { icon: '⬡', color: '#3b82f6' },
  classifier_system:  { icon: '◈', color: '#a78bfa' },
  classifier_scoring: { icon: '◉', color: '#f59e0b' },
  response_writer:    { icon: '◎', color: '#4ade80' },
  intel_extraction:   { icon: '◍', color: '#60a5fa' },
}

function VersionRow({ v, isCurrent, onRollback, rolling }) {
  const [expanded, setExpanded] = useState(false)
  const c = isCurrent ? '#4ade80' : '#334155'
  return (
    <div style={{ borderTop: '1px solid #1e2535', padding: '10px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 99, background: `${c}18`, border: `1px solid ${c}44`, color: c, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
          v{v.version}
        </span>
        <span style={{ fontSize: 11, color: '#475569', flex: 1, minWidth: 0 }}>
          {v.change_summary || 'no summary'}
        </span>
        <span style={{ fontSize: 10, color: '#334155', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
          {v.author_email ? `${v.author_email.split('@')[0]} · ` : ''}{timeAgo(v.created_at)}
        </span>
        {!isCurrent && (
          <button
            onClick={() => onRollback(v.version)}
            disabled={rolling}
            style={{ fontSize: 10, padding: '2px 9px', borderRadius: 5, background: 'transparent', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.3)', cursor: rolling ? 'not-allowed' : 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
          >
            {rolling ? '…' : 'rollback'}
          </button>
        )}
        <button
          onClick={() => setExpanded(e => !e)}
          style={{ fontSize: 10, color: '#334155', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
        >
          {expanded ? '▲ hide' : '▼ diff'}
        </button>
      </div>
      {expanded && (
        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {v.old_content !== null && (
            <div>
              <div style={{ fontSize: 9, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>before</div>
              <pre style={{ fontSize: 10.5, color: '#475569', background: 'rgba(248,113,113,0.04)', border: '1px solid rgba(248,113,113,0.12)', borderRadius: 6, padding: '8px 10px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
                {v.old_content}
              </pre>
            </div>
          )}
          <div>
            <div style={{ fontSize: 9, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>after</div>
            <pre style={{ fontSize: 10.5, color: '#94a3b8', background: 'rgba(74,222,128,0.03)', border: '1px solid rgba(74,222,128,0.1)', borderRadius: 6, padding: '8px 10px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
              {v.new_content}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

export default function AiConfigPage({ params }) {
  const slug = params.org
  const router = useRouter()

  const [prompts, setPrompts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedKey, setSelectedKey] = useState(null)

  const [editorContent, setEditorContent] = useState('')
  const [changeSummary, setChangeSummary] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [saveErr, setSaveErr] = useState('')
  const [resetting, setResetting] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  const [versions, setVersions] = useState([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [rolling, setRolling] = useState(false)

  useEffect(() => {
    api.listPrompts(slug)
      .then(d => {
        setPrompts(d.prompts || [])
        if (d.prompts?.length && !selectedKey) setSelectedKey(d.prompts[0].prompt_key)
      })
      .catch(err => {
        if (err.message === 'unauthorized') router.replace('/login')
        else setError(err.message || 'failed to load')
      })
      .finally(() => setLoading(false))
  }, [slug])

  const selected = prompts.find(p => p.prompt_key === selectedKey)

  useEffect(() => {
    if (selected) {
      setEditorContent(selected.content)
      setChangeSummary('')
      setSaveMsg('')
      setSaveErr('')
      setIsDirty(false)
      setVersions([])
      setShowVersions(false)
    }
  }, [selectedKey])

  function handleEditorChange(val) {
    setEditorContent(val)
    setIsDirty(val !== selected?.content)
    setSaveMsg('')
    setSaveErr('')
  }

  async function handleSave() {
    if (!selectedKey || !isDirty) return
    setSaving(true)
    setSaveErr('')
    setSaveMsg('')
    try {
      const { prompt } = await api.savePrompt(slug, selectedKey, {
        content: editorContent,
        change_summary: changeSummary.trim() || null,
      })
      setPrompts(prev => prev.map(p => p.prompt_key === selectedKey
        ? { ...p, content: prompt.content, version: prompt.version, updated_by: prompt.updated_by, updated_at: prompt.updated_at, is_default: false }
        : p
      ))
      setIsDirty(false)
      setChangeSummary('')
      setSaveMsg(`saved as v${prompt.version}`)
      setTimeout(() => setSaveMsg(''), 4000)
      if (showVersions) loadVersions()
    } catch (err) {
      setSaveErr(err.message || 'save failed')
    } finally { setSaving(false) }
  }

  async function handleReset() {
    setResetting(true)
    setSaveErr('')
    try {
      const { prompt } = await api.resetPrompt(slug, selectedKey)
      setPrompts(prev => prev.map(p => p.prompt_key === selectedKey
        ? { ...p, content: prompt.content, version: prompt.version, updated_by: prompt.updated_by, updated_at: prompt.updated_at, is_default: false }
        : p
      ))
      setEditorContent(prompt.content)
      setIsDirty(false)
      setChangeSummary('')
      setSaveMsg('reset to default')
      setTimeout(() => setSaveMsg(''), 4000)
      if (showVersions) loadVersions()
    } catch (err) {
      setSaveErr(err.message || 'reset failed')
    } finally { setResetting(false) }
  }

  const loadVersions = useCallback(async () => {
    if (!selectedKey) return
    setVersionsLoading(true)
    try {
      const { versions: v } = await api.getPromptVersions(slug, selectedKey)
      setVersions(v || [])
    } catch { /* ignore */ }
    finally { setVersionsLoading(false) }
  }, [slug, selectedKey])

  useEffect(() => {
    if (showVersions) loadVersions()
  }, [showVersions, loadVersions])

  async function handleRollback(version) {
    if (rolling) return
    setRolling(true)
    setSaveErr('')
    try {
      const { prompt } = await api.rollbackPrompt(slug, selectedKey, version)
      setPrompts(prev => prev.map(p => p.prompt_key === selectedKey
        ? { ...p, content: prompt.content, version: prompt.version, updated_by: prompt.updated_by, updated_at: prompt.updated_at, is_default: false }
        : p
      ))
      setEditorContent(prompt.content)
      setIsDirty(false)
      setSaveMsg(`rolled back to v${version} — now v${prompt.version}`)
      setTimeout(() => setSaveMsg(''), 5000)
      loadVersions()
    } catch (err) {
      setSaveErr(err.message || 'rollback failed')
    } finally { setRolling(false) }
  }

  return (
    <div style={{ maxWidth: 1060, margin: '0 auto', padding: '40px 24px 80px' }}>
      {/* Back */}
      <Link
        href={`/${slug}/settings`}
        style={{ fontSize: 12, color: '#475569', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 28, transition: 'color 0.12s' }}
        onMouseEnter={e => e.currentTarget.style.color = '#94a3b8'}
        onMouseLeave={e => e.currentTarget.style.color = '#475569'}
      >
        ← settings
      </Link>

      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 18, fontWeight: 500, color: '#e2e8f0', marginBottom: 5 }}>AI configuration</div>
        <div style={{ fontSize: 13, color: '#475569', fontStyle: 'italic' }}>Edit the prompts that drive classification, relevance, escalation, and response generation. Changes take effect on the next refresh cycle.</div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 8, fontSize: 12, color: '#f87171', marginBottom: 20 }}>{error}</div>
      )}

      {loading ? (
        <div style={{ display: 'flex', gap: 4, padding: '60px 0', justifyContent: 'center' }}>
          {[0, 1, 2].map(i => <div key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: '#3b82f6', animation: `pulseDot 1.2s ${i * 0.18}s ease-in-out infinite` }} />)}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20, alignItems: 'start' }}>

          {/* Sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {prompts.map(p => {
              const lbl = PROMPT_LABELS[p.prompt_key] || { icon: '○', color: '#64748b' }
              const isActive = selectedKey === p.prompt_key
              return (
                <button
                  key={p.prompt_key}
                  onClick={() => setSelectedKey(p.prompt_key)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                    padding: '10px 12px', borderRadius: 8, textAlign: 'left',
                    background: isActive ? '#191d2b' : 'transparent',
                    border: `1px solid ${isActive ? lbl.color + '44' : '#1e2535'}`,
                    cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.12s', width: '100%',
                  }}
                  onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = '#13161f'; e.currentTarget.style.borderColor = '#243047' } }}
                  onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = '#1e2535' } }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%' }}>
                    <span style={{ fontSize: 13, color: lbl.color, flexShrink: 0 }}>{lbl.icon}</span>
                    <span style={{ fontSize: 12, color: isActive ? '#e2e8f0' : '#94a3b8', fontWeight: isActive ? 500 : 400, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.name}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, paddingLeft: 20 }}>
                    {p.version > 0 ? (
                      <span style={{ fontSize: 9, color: lbl.color, fontFamily: 'var(--font-mono)' }}>v{p.version}</span>
                    ) : (
                      <span style={{ fontSize: 9, color: '#334155', fontFamily: 'var(--font-mono)' }}>default</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Editor panel */}
          {selected && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12, gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: '#e2e8f0', marginBottom: 3 }}>{selected.name}</div>
                  <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.5 }}>{selected.description}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                  {selected.version > 0 && (
                    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)', color: '#3b82f6', fontFamily: 'var(--font-mono)' }}>
                      v{selected.version}
                    </span>
                  )}
                  {selected.is_default && (
                    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.2)', color: '#64748b', fontFamily: 'var(--font-mono)' }}>
                      default
                    </span>
                  )}
                </div>
              </div>

              {/* Meta: last edited */}
              {selected.updated_at && (
                <div style={{ fontSize: 11, color: '#334155', marginBottom: 10, fontFamily: 'var(--font-mono)' }}>
                  last edited {timeAgo(selected.updated_at)}{selected.updated_by ? ` by ${selected.updated_by.split('@')[0]}` : ''}
                </div>
              )}

              {/* Prompt editor */}
              <textarea
                value={editorContent}
                onChange={e => handleEditorChange(e.target.value)}
                rows={18}
                spellCheck={false}
                style={{
                  width: '100%', fontSize: 12.5, fontFamily: 'var(--font-mono)',
                  background: '#0b0d16', border: `1px solid ${isDirty ? '#3b82f6' : '#1e2535'}`,
                  borderRadius: 8, color: '#94a3b8', padding: '12px 14px',
                  resize: 'vertical', lineHeight: 1.65, boxSizing: 'border-box',
                  transition: 'border-color 0.12s', outline: 'none',
                }}
                onFocus={e => { if (!isDirty) e.currentTarget.style.borderColor = '#243047' }}
                onBlur={e => { if (!isDirty) e.currentTarget.style.borderColor = '#1e2535' }}
              />

              {/* Change summary */}
              {isDirty && (
                <div style={{ marginTop: 8, animation: 'fadeIn 0.15s ease both' }}>
                  <input
                    type="text"
                    value={changeSummary}
                    onChange={e => setChangeSummary(e.target.value)}
                    placeholder="describe what you changed (optional)"
                    style={{
                      width: '100%', fontSize: 12, fontFamily: 'inherit',
                      background: '#13161f', border: '1px solid #243047', borderRadius: 6,
                      color: '#94a3b8', padding: '6px 10px', boxSizing: 'border-box', outline: 'none',
                    }}
                  />
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                <button
                  onClick={handleSave}
                  disabled={!isDirty || saving}
                  style={{
                    fontSize: 12, padding: '5px 16px', borderRadius: 6,
                    background: isDirty ? '#3b82f6' : '#13161f',
                    color: isDirty ? '#fff' : '#334155',
                    border: `1px solid ${isDirty ? '#3b82f6' : '#1e2535'}`,
                    cursor: isDirty && !saving ? 'pointer' : 'not-allowed',
                    fontFamily: 'inherit', transition: 'all 0.15s',
                  }}
                >
                  {saving ? 'saving…' : 'save'}
                </button>
                <button
                  onClick={handleReset}
                  disabled={resetting}
                  style={{ fontSize: 12, padding: '5px 14px', borderRadius: 6, background: 'transparent', color: '#475569', border: '1px solid #1e2535', cursor: resetting ? 'not-allowed' : 'pointer', fontFamily: 'inherit', transition: 'all 0.12s' }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#f59e0b'; e.currentTarget.style.borderColor = 'rgba(245,158,11,0.3)' }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#475569'; e.currentTarget.style.borderColor = '#1e2535' }}
                >
                  {resetting ? '…' : 'reset to default'}
                </button>
                <div style={{ flex: 1 }} />
                {saveMsg && <span style={{ fontSize: 11, color: '#4ade80', fontStyle: 'italic', animation: 'fadeIn 0.15s ease both' }}>{saveMsg}</span>}
                {saveErr && <span style={{ fontSize: 11, color: '#f87171' }}>{saveErr}</span>}
                <button
                  onClick={() => setShowVersions(v => !v)}
                  style={{ fontSize: 11, color: '#475569', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textDecoration: showVersions ? 'underline' : 'none', transition: 'color 0.1s' }}
                  onMouseEnter={e => e.currentTarget.style.color = '#94a3b8'}
                  onMouseLeave={e => e.currentTarget.style.color = '#475569'}
                >
                  {showVersions ? 'hide history' : 'version history'}
                </button>
              </div>

              {/* Version history */}
              {showVersions && (
                <div style={{ marginTop: 16, padding: '14px 16px', background: '#0b0d16', border: '1px solid #1e2535', borderRadius: 10, animation: 'fadeIn 0.15s ease both' }}>
                  <div style={{ fontSize: 10, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, fontFamily: 'var(--font-mono)' }}>
                    version history
                  </div>
                  {versionsLoading ? (
                    <div style={{ fontSize: 11, color: '#334155', fontStyle: 'italic' }}>loading…</div>
                  ) : versions.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#334155', fontStyle: 'italic', padding: '8px 0' }}>
                      no versions yet — this prompt is running on defaults.
                    </div>
                  ) : (
                    versions.map(v => (
                      <VersionRow
                        key={v.id}
                        v={v}
                        isCurrent={v.version === selected.version}
                        onRollback={handleRollback}
                        rolling={rolling}
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
