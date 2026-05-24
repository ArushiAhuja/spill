'use client'
import { useState, useEffect, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { timeAgo } from '@/lib/auth'

function SetupHelp({ steps }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{
      border: '1px solid #1e2535',
      borderRadius: 8,
      overflow: 'hidden',
      fontSize: 12.5,
    }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: '#0d0f1a',
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'inherit',
          color: '#64748b',
          fontSize: 11.5,
          textAlign: 'left',
          transition: 'color 0.12s',
        }}
        onMouseEnter={e => e.currentTarget.style.color = '#94a3b8'}
        onMouseLeave={e => e.currentTarget.style.color = '#64748b'}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, opacity: 0.7 }}>◈</span>
          how to set this up
        </span>
        <span style={{
          fontSize: 10,
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.15s',
          display: 'inline-block',
        }}>▾</span>
      </button>
      {open && (
        <div style={{
          padding: '12px 14px',
          background: '#0d0f1a',
          borderTop: '1px solid #1e2535',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}>
          {steps.map((step, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: '#3b82f6',
                background: 'rgba(59,130,246,0.1)',
                border: '1px solid rgba(59,130,246,0.2)',
                borderRadius: 4,
                padding: '1px 5px',
                flexShrink: 0,
                marginTop: 1,
              }}>{i + 1}</span>
              <span style={{ color: '#64748b', lineHeight: 1.5 }}>{step}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const EMAIL_SETUP_STEPS = [
  'Enable 2-Step Verification at myaccount.google.com/security',
  'Go to myaccount.google.com/apppasswords → create an App Password named "Spill" → copy the 16-character code',
  'Enter your Gmail address and the App Password in the fields below',
  'Enter the recipient email(s) separated by commas — alerts will be sent there',
]

const SHEETS_SETUP_STEPS = [
  'Create a new Google Sheet at sheets.google.com',
  'Go to console.cloud.google.com → IAM & Admin → Service Accounts → create a new service account',
  'On the service account → Keys tab → Add Key → JSON → download the file',
  'Open your Google Sheet → Share → paste the service account\'s client_email → give it Editor access',
  'Copy the Sheet ID from the URL: docs.google.com/spreadsheets/d/[THIS PART]/edit',
  'Paste the Sheet ID and the full contents of the downloaded JSON file in the fields below',
  'Columns written automatically: Timestamp | Source | Category | Score | Escalated | Title | URL | Author | Reasoning',
]

const ACTION_STYLES = {
  email: { color: '#60a5fa', bg: 'rgba(96,165,250,0.1)', border: 'rgba(96,165,250,0.25)' },
  webhook: { color: '#9b8ff7', bg: 'rgba(155,143,247,0.1)', border: 'rgba(155,143,247,0.25)' },
  sheets: { color: '#4ade80', bg: 'rgba(74,222,128,0.1)', border: 'rgba(74,222,128,0.25)' },
  slack: { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.25)' },
}

const SLACK_SETUP_STEPS = [
  'Go to api.slack.com/apps → Create New App → From scratch',
  'Choose your workspace, then go to Incoming Webhooks → toggle On',
  'Click "Add New Webhook to Workspace" → pick a channel → Allow',
  'Copy the Webhook URL (starts with https://hooks.slack.com/...) and paste it below',
]

const ACTION_DESCS = {
  email: 'sends an email alert with AI reasoning + suggested response',
  webhook: 'pings a url with the post data',
  sheets: 'appends a row to a google sheet',
  slack: 'posts an alert to a slack channel via webhook',
}

function ActionTypeBadge({ type }) {
  const s = ACTION_STYLES[type] || { color: '#64748b', bg: '#191d2b', border: '#1e2535' }
  return (
    <span style={{
      fontSize: 11, padding: '2px 8px', borderRadius: 99,
      color: s.color, background: s.bg,
      border: `1px solid ${s.border}`,
      whiteSpace: 'nowrap',
    }}>
      {type || '—'}
    </span>
  )
}

function EscalationModal({ title, onClose, onSave, saving, initial, categories }) {
  const [name, setName] = useState(initial?.name || '')
  const [selectedCats, setSelectedCats] = useState(new Set(initial?.category_ids || []))
  const [threshold, setThreshold] = useState(initial?.score_threshold ?? 70)
  const [actionType, setActionType] = useState(initial?.action_type || 'email')
  const [config, setConfig] = useState(initial?.config || {})
  const [enabled, setEnabled] = useState(initial?.enabled !== false)
  const [muteWindows, setMuteWindows] = useState(initial?.mute_windows || [])
  const [err, setErr] = useState('')

  function addMuteWindow() {
    setMuteWindows(prev => [...prev, { start: '22:00', end: '06:00' }])
  }
  function removeMuteWindow(idx) {
    setMuteWindows(prev => prev.filter((_, i) => i !== idx))
  }
  function updateMuteWindow(idx, key, val) {
    setMuteWindows(prev => prev.map((w, i) => i === idx ? { ...w, [key]: val } : w))
  }

  function toggleCat(id) {
    setSelectedCats((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function setConfigField(key, val) {
    setConfig((prev) => ({ ...prev, [key]: val }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setErr('')
    if (!name.trim()) { setErr('name is required'); return }
    try {
      await onSave({
        name,
        category_ids: Array.from(selectedCats),
        score_threshold: Number(threshold),
        action_type: actionType,
        config,
        enabled,
        mute_windows: muteWindows,
      })
    } catch (error) {
      setErr(error.message || 'error saving')
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 50, padding: '24px',
      overflowY: 'auto',
    }}>
      <div style={{
        background: '#13161f',
        border: '1px solid #1e2535',
        borderRadius: 10,
        width: '100%', maxWidth: 480,
        padding: '24px',
        animation: 'fadeUp 0.2s ease both',
        margin: 'auto',
      }}>
        {/* Modal header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#e2e8f0' }}>{title}</div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#334155', fontSize: 18, lineHeight: 1, cursor: 'pointer', fontFamily: 'inherit', transition: 'color 0.12s' }}
            onMouseEnter={e => e.currentTarget.style.color = '#e2e8f0'}
            onMouseLeave={e => e.currentTarget.style.color = '#334155'}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Rule name */}
          <div>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>rule name</div>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>

          {/* Score threshold */}
          <div>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
              score threshold —{' '}
              <span style={{ color: '#e2e8f0', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{threshold}</span>
            </div>
            <input
              type="range" min={0} max={100} value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              style={{ width: '100%', accentColor: '#3b82f6', cursor: 'pointer', background: 'transparent', border: 'none', padding: 0 }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#334155', marginTop: 2 }}>
              <span>0</span><span>100</span>
            </div>
          </div>

          {/* Categories */}
          <div>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
              categories{' '}
              <span style={{ color: '#334155', textTransform: 'none', letterSpacing: 0 }}>(empty = all)</span>
            </div>
            {categories.length === 0 ? (
              <div style={{ fontSize: 12, color: '#334155' }}>no categories yet — add some first</div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {categories.map((cat) => (
                  <button
                    key={cat.id} type="button" onClick={() => toggleCat(cat.id)}
                    style={{
                      fontSize: 12, padding: '4px 10px', borderRadius: 99,
                      border: `1px solid ${selectedCats.has(cat.id) ? (cat.color || '#3b82f6') + '80' : '#1e2535'}`,
                      background: selectedCats.has(cat.id) ? (cat.color || '#3b82f6') + '18' : 'transparent',
                      color: selectedCats.has(cat.id) ? (cat.color || '#3b82f6') : '#64748b',
                      cursor: 'pointer', fontFamily: 'inherit',
                      transition: 'all 0.12s',
                    }}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Action type */}
          <div>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>action type</div>
            <div style={{
              display: 'flex', gap: 2, padding: 4,
              background: '#0d0f1a', borderRadius: 8,
              border: '1px solid #1e2535',
            }}>
              {['email', 'slack', 'sheets', 'webhook'].map((t) => (
                <button
                  key={t} type="button" onClick={() => setActionType(t)}
                  style={{
                    flex: 1, fontSize: 12.5, padding: '6px 0',
                    borderRadius: 6,
                    background: actionType === t ? '#191d2b' : 'transparent',
                    color: actionType === t ? '#e2e8f0' : '#64748b',
                    border: actionType === t ? '1px solid #1e2535' : '1px solid transparent',
                    cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'all 0.12s',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
            {actionType && (
              <div style={{ fontSize: 11.5, color: '#334155', marginTop: 6 }}>
                {ACTION_DESCS[actionType]}
              </div>
            )}
          </div>

          {/* Action config */}
          {actionType === 'email' && (
            <>
              <SetupHelp steps={EMAIL_SETUP_STEPS} />

              <div>
                <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
                  gmail address <span style={{ color: '#334155', textTransform: 'none', letterSpacing: 0 }}>(sends from this account)</span>
                </div>
                <input
                  type="email"
                  value={config.gmail_user || ''}
                  onChange={(e) => setConfigField('gmail_user', e.target.value)}
                  placeholder="you@gmail.com"
                  autoComplete="off"
                />
              </div>

              <div>
                <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
                  app password <span style={{ color: '#334155', textTransform: 'none', letterSpacing: 0 }}>(16-char code from Google)</span>
                </div>
                <input
                  type="password"
                  value={config.gmail_app_password || ''}
                  onChange={(e) => setConfigField('gmail_app_password', e.target.value)}
                  placeholder="abcd efgh ijkl mnop"
                  autoComplete="off"
                />
              </div>

              <div>
                <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
                  send alerts to <span style={{ color: '#334155', textTransform: 'none', letterSpacing: 0 }}>(comma-separated)</span>
                </div>
                <textarea
                  rows={2}
                  value={config.to || ''}
                  onChange={(e) => setConfigField('to', e.target.value)}
                  placeholder="alerts@company.com, team@company.com"
                />
              </div>
            </>
          )}
          {actionType === 'webhook' && (
            <div>
              <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>webhook url</div>
              <input
                type="text"
                value={config.url || ''}
                onChange={(e) => setConfigField('url', e.target.value)}
                placeholder="https://hooks.example.com/..."
              />
            </div>
          )}
          {actionType === 'slack' && (
            <>
              <SetupHelp steps={SLACK_SETUP_STEPS} />
              <div>
                <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
                  slack webhook url
                </div>
                <input
                  type="text"
                  value={config.webhook_url || ''}
                  onChange={(e) => setConfigField('webhook_url', e.target.value)}
                  placeholder="https://hooks.slack.com/services/T.../B.../..."
                  autoComplete="off"
                />
              </div>
            </>
          )}
          {actionType === 'sheets' && (
            <>
              <div style={{
                fontSize: 11,
                color: '#94a3b8',
                background: 'rgba(148,163,184,0.07)',
                border: '1px solid rgba(148,163,184,0.2)',
                borderRadius: 8,
                padding: '8px 12px',
              }}>
                heads up: the service account JSON (including private key) is stored unencrypted.
              </div>
              <SetupHelp steps={SHEETS_SETUP_STEPS} />

              <div>
                <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>sheet id</div>
                <input
                  type="text"
                  value={config.sheet_id || ''}
                  onChange={(e) => setConfigField('sheet_id', e.target.value)}
                  placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
                />
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
                  service account json <span style={{ color: '#334155', textTransform: 'none', letterSpacing: 0 }}>(contents of downloaded .json file)</span>
                </div>
                <textarea
                  rows={4}
                  value={config.service_account || ''}
                  onChange={(e) => setConfigField('service_account', e.target.value)}
                  placeholder='{"type": "service_account", "project_id": "...", "client_email": "...", ...}'
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}
                />
              </div>
            </>
          )}

          {/* Mute windows */}
          <div>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
              quiet hours{' '}
              <span style={{ color: '#334155', textTransform: 'none', letterSpacing: 0 }}>(UTC — no alerts during these windows)</span>
            </div>
            {muteWindows.map((w, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <input type="time" value={w.start} onChange={e => updateMuteWindow(i, 'start', e.target.value)} style={{ flex: 1, fontSize: 12.5 }} />
                <span style={{ color: '#334155', fontSize: 12, flexShrink: 0 }}>–</span>
                <input type="time" value={w.end} onChange={e => updateMuteWindow(i, 'end', e.target.value)} style={{ flex: 1, fontSize: 12.5 }} />
                <button
                  type="button"
                  onClick={() => removeMuteWindow(i)}
                  style={{ background: 'none', border: 'none', color: '#334155', cursor: 'pointer', padding: '0 4px', fontSize: 14, lineHeight: 1, transition: 'color 0.1s' }}
                  onMouseEnter={e => e.currentTarget.style.color = '#f87171'}
                  onMouseLeave={e => e.currentTarget.style.color = '#334155'}
                >×</button>
              </div>
            ))}
            <button
              type="button"
              onClick={addMuteWindow}
              style={{ fontSize: 11.5, color: '#334155', background: 'none', border: '1px dashed #1e2535', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.12s', marginTop: muteWindows.length > 0 ? 4 : 0 }}
              onMouseEnter={e => { e.currentTarget.style.color = '#64748b'; e.currentTarget.style.borderColor = '#334155' }}
              onMouseLeave={e => { e.currentTarget.style.color = '#334155'; e.currentTarget.style.borderColor = '#1e2535' }}
            >
              + add quiet window
            </button>
          </div>

          {/* Enabled toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={() => setEnabled(e => !e)}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              <div className={`toggle-track ${enabled ? 'on' : ''}`}>
                <div className="toggle-thumb" />
              </div>
            </button>
            <span style={{ fontSize: 12.5, color: '#64748b' }}>{enabled ? 'enabled' : 'disabled'}</span>
          </div>

          {err && (
            <div style={{ fontSize: 12.5, color: '#f87171', padding: '8px 12px', background: 'rgba(248,113,113,0.08)', borderRadius: 8, border: '1px solid rgba(248,113,113,0.2)' }}>
              {err}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, paddingTop: 4 }}>
            <button
              type="button" onClick={onClose}
              style={{ fontSize: 12.5, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', transition: 'color 0.12s' }}
              onMouseEnter={e => e.currentTarget.style.color = '#e2e8f0'}
              onMouseLeave={e => e.currentTarget.style.color = '#64748b'}
            >
              cancel
            </button>
            <button
              type="submit" disabled={saving}
              style={{
                fontSize: 12.5, padding: '8px 20px',
                background: saving ? '#1e2535' : '#3b82f6',
                color: saving ? '#334155' : '#0d0f1a',
                border: 'none', borderRadius: 8,
                fontFamily: 'inherit', fontWeight: 500,
                cursor: saving ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {saving ? 'saving...' : 'save rule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function EscalationsPage({ params }) {
  const slug = params.org
  const router = useRouter()
  const [escalations, setEscalations] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [testingId, setTestingId] = useState(null)
  const [testResult, setTestResult] = useState(null)

  async function load() {
    try {
      const [esc, cats] = await Promise.all([
        api.getEscalations(slug),
        api.getCategories(slug),
      ])
      setEscalations(esc || [])
      setCategories(cats || [])
    } catch (err) {
      if (err.message === 'unauthorized') router.replace('/login')
      else setError(err.message || 'failed to load escalations')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [slug])

  async function handleSave(data) {
    setSaving(true)
    try {
      if (editTarget) {
        await api.updateEscalation(slug, editTarget.id, data)
      } else {
        await api.createEscalation(slug, data)
      }
      setModalOpen(false)
      setEditTarget(null)
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(rule) {
    try {
      await api.deleteEscalation(slug, rule.id)
      setDeleteConfirm(null)
      await load()
    } catch (err) {
      setError(err.message || 'failed to delete')
    }
  }

  async function handleToggle(rule) {
    try {
      await api.updateEscalation(slug, rule.id, { enabled: !rule.enabled })
      setEscalations((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r))
      )
    } catch {
      // silently fail
    }
  }

  async function handleTest(rule) {
    setTestingId(rule.id)
    setTestResult(null)
    try {
      await api.testEscalation(slug, rule.id)
      setTestResult({ id: rule.id, ok: true, msg: `test ${rule.action_type} sent` })
    } catch (err) {
      setTestResult({ id: rule.id, ok: false, msg: err.message })
    } finally {
      setTestingId(null)
      setTimeout(() => setTestResult(null), 4000)
    }
  }

  function getCategoryNames(ids) {
    if (!ids || ids.length === 0) return null
    return ids
      .map((id) => categories.find((c) => c.id === id)?.name)
      .filter(Boolean)
  }

  function getActionSummary(rule) {
    const c = rule.config || {}
    if (rule.action_type === 'email') return c.to || ''
    if (rule.action_type === 'webhook') return c.url || ''
    if (rule.action_type === 'sheets') return c.sheet_id || ''
    return ''
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 5, height: 5, borderRadius: '50%', background: '#3b82f6',
              animation: `pulseDot 1.2s ${i * 0.18}s ease-in-out infinite`,
            }} />
          ))}
        </div>
        <div style={{ fontSize: 12, color: '#334155' }}>loading escalations...</div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px' }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 40 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 500, color: '#e2e8f0', marginBottom: 4 }}>escalation rules</div>
          <div style={{ fontSize: 12.5, color: '#64748b' }}>
            rules that trigger actions when signals cross a score threshold.
          </div>
        </div>
        <button
          onClick={() => { setEditTarget(null); setModalOpen(true) }}
          style={{
            fontSize: 12.5, padding: '8px 16px',
            background: 'transparent',
            color: '#3b82f6',
            border: '1px solid rgba(59,130,246,0.4)',
            borderRadius: 8,
            fontFamily: 'inherit', fontWeight: 500,
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.08)'; e.currentTarget.style.borderColor = '#3b82f6' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'rgba(59,130,246,0.4)' }}
        >
          + add rule
        </button>
      </div>

      {error && (
        <div style={{ fontSize: 12.5, color: '#f87171', padding: '10px 14px', background: 'rgba(248,113,113,0.08)', borderRadius: 8, border: '1px solid rgba(248,113,113,0.2)', marginBottom: 20 }}>
          {error}
        </div>
      )}

      {testResult && (
        <div style={{
          fontSize: 12.5,
          color: testResult.ok ? '#4ade80' : '#f87171',
          padding: '10px 14px',
          background: testResult.ok ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)',
          borderRadius: 8,
          border: `1px solid ${testResult.ok ? 'rgba(74,222,128,0.25)' : 'rgba(248,113,113,0.2)'}`,
          marginBottom: 20,
        }}>
          {testResult.msg}
        </div>
      )}

      {/* Empty state */}
      {escalations.length === 0 && !error && (
        <div style={{ padding: '80px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 15, color: '#64748b', marginBottom: 8 }}>no escalation rules.</div>
          <div style={{ fontSize: 13, color: '#334155', marginBottom: 24 }}>
            you won't be notified when things get bad.
          </div>
          <button
            onClick={() => { setEditTarget(null); setModalOpen(true) }}
            style={{
              fontSize: 13, padding: '9px 20px',
              background: '#3b82f6', color: '#0d0f1a',
              border: 'none', borderRadius: 8,
              fontFamily: 'inherit', fontWeight: 500, cursor: 'pointer',
            }}
          >
            add your first rule →
          </button>
        </div>
      )}

      {/* Escalations table */}
      {escalations.length > 0 && (
        <div style={{ border: '1px solid #1e2535', borderRadius: 10, overflow: 'hidden' }}>
          {/* Table header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 140px 180px 60px 80px',
            padding: '8px 16px',
            borderBottom: '1px solid #1e2535',
            background: '#13161f',
          }}>
            {['name', 'trigger', 'action', 'status', ''].map((h, i) => (
              <div key={i} style={{ fontSize: 11, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: i === 4 ? 'right' : 'left' }}>
                {h}
              </div>
            ))}
          </div>

          {/* Rows */}
          {escalations.map((rule) => {
            const catNames = getCategoryNames(rule.category_ids)
            const summary = getActionSummary(rule)
            return (
              <div
                key={rule.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 140px 180px 60px 80px',
                  padding: '12px 16px',
                  borderBottom: '1px solid #1e2535',
                  alignItems: 'center',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#13161f'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                {/* Name */}
                <div style={{ fontSize: 13.5, color: '#e2e8f0', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 12 }}>
                  {rule.name}
                </div>

                {/* Trigger */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 12, color: '#64748b', fontFamily: 'var(--font-mono)' }}>
                    score ≥ {rule.score_threshold}
                  </span>
                  {catNames && catNames.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                      {catNames.map((n) => (
                        <span key={n} style={{
                          fontSize: 10.5, padding: '1px 6px',
                          background: '#191d2b', color: '#334155',
                          borderRadius: 99, border: '1px solid #1e2535',
                        }}>
                          {n}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span style={{ fontSize: 11, color: '#334155' }}>all categories</span>
                  )}
                  {Number(rule.total_fires) > 0 && (
                    <span style={{ fontSize: 10, color: '#475569', fontFamily: 'var(--font-mono)' }}>
                      fired {rule.total_fires}×{rule.last_fired_at ? ` · ${timeAgo(rule.last_fired_at)}` : ''}
                    </span>
                  )}
                  {(rule.mute_windows || []).length > 0 && (
                    <span style={{ fontSize: 10, color: '#f59e0b', fontFamily: 'var(--font-mono)' }}>
                      ⏸ {rule.mute_windows.length} quiet window{rule.mute_windows.length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                {/* Action */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <ActionTypeBadge type={rule.action_type} />
                  {summary && (
                    <span style={{ fontSize: 11, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                      {summary}
                    </span>
                  )}
                </div>

                {/* Toggle */}
                <button
                  onClick={() => handleToggle(rule)}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                >
                  <div className={`toggle-track ${rule.enabled ? 'on' : ''}`}>
                    <div className="toggle-thumb" />
                  </div>
                </button>

                {/* Actions */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                  <button
                    onClick={() => handleTest(rule)}
                    title="send test alert"
                    disabled={testingId === rule.id}
                    style={{ background: 'none', border: 'none', color: testResult?.id === rule.id && testResult.ok ? '#4ade80' : testResult?.id === rule.id && !testResult.ok ? '#f87171' : '#334155', cursor: 'pointer', padding: 4, transition: 'color 0.12s', fontSize: 11 }}
                    onMouseEnter={e => { if (testingId !== rule.id) e.currentTarget.style.color = '#64748b' }}
                    onMouseLeave={e => { if (testingId !== rule.id && !(testResult?.id === rule.id)) e.currentTarget.style.color = '#334155' }}
                  >
                    {testingId === rule.id ? '…' : '▶'}
                  </button>
                  <button
                    onClick={() => { setEditTarget(rule); setModalOpen(true) }}
                    title="edit"
                    style={{ background: 'none', border: 'none', color: '#334155', cursor: 'pointer', padding: 4, transition: 'color 0.12s' }}
                    onMouseEnter={e => e.currentTarget.style.color = '#64748b'}
                    onMouseLeave={e => e.currentTarget.style.color = '#334155'}
                  >
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                      <path d="M9.5 2.5L11.5 4.5M2 12L2.5 9.5L8.5 3.5L10.5 5.5L4.5 11.5L2 12Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(rule)}
                    title="delete"
                    style={{ background: 'none', border: 'none', color: '#334155', cursor: 'pointer', padding: 4, transition: 'color 0.12s' }}
                    onMouseEnter={e => e.currentTarget.style.color = '#f87171'}
                    onMouseLeave={e => e.currentTarget.style.color = '#334155'}
                  >
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                      <path d="M2 3.5H12M5 3.5V2H9V3.5M5.5 6V10.5M8.5 6V10.5M3 3.5L3.5 11.5H10.5L11 3.5H3Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <EscalationModal
          title={editTarget ? 'edit rule' : 'add rule'}
          onClose={() => { setModalOpen(false); setEditTarget(null) }}
          onSave={handleSave}
          saving={saving}
          initial={editTarget}
          categories={categories}
        />
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 50, padding: '24px',
        }}>
          <div style={{
            background: '#13161f', border: '1px solid #1e2535',
            borderRadius: 10, width: '100%', maxWidth: 340, padding: '24px',
            animation: 'fadeUp 0.2s ease both',
          }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: '#e2e8f0', marginBottom: 8 }}>delete rule?</div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 24 }}>
              &quot;{deleteConfirm.name}&quot; will be permanently removed.
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
              <button
                onClick={() => setDeleteConfirm(null)}
                style={{ fontSize: 12.5, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', transition: 'color 0.12s' }}
                onMouseEnter={e => e.currentTarget.style.color = '#e2e8f0'}
                onMouseLeave={e => e.currentTarget.style.color = '#64748b'}
              >
                cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                style={{
                  fontSize: 12.5, padding: '7px 18px',
                  background: '#f87171', color: '#0d0f1a',
                  border: 'none', borderRadius: 8,
                  fontFamily: 'inherit', fontWeight: 500, cursor: 'pointer',
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                onMouseLeave={e => e.currentTarget.style.opacity = '1'}
              >
                delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
