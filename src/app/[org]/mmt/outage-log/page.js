'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import OrgNav from '@/components/OrgNav'
import { api } from '@/lib/api'

function timeAgo(ts) {
  if (!ts) return ''
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

function fmtDt(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

function StatusBadge({ status }) {
  const colors = { ongoing: '#f87171', resolved: '#4ade80', monitoring: '#fbbf24' }
  const color = colors[status] || '#64748b'
  return (
    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: color + '22', color, border: `1px solid ${color}44` }}>
      {status}
    </span>
  )
}

export default function OutageLogPage() {
  const { org: slug } = useParams()
  const [outages, setOutages] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [newOutage, setNewOutage] = useState({ title: '', description: '', impact: '' })
  const [editId, setEditId] = useState(null)
  const [editData, setEditData] = useState({})
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const data = await api.mmtGetOutageLog(slug)
      setOutages(data.outages || [])
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [slug])

  async function createOutage() {
    if (!newOutage.title.trim()) return
    setSaving(true)
    try {
      await api.mmtCreateOutage(slug, newOutage)
      setShowNew(false)
      setNewOutage({ title: '', description: '', impact: '' })
      load()
    } catch (e) { alert(e.message) } finally { setSaving(false) }
  }

  async function updateOutage(id) {
    setSaving(true)
    try {
      await api.mmtUpdateOutage(slug, id, editData)
      setEditId(null)
      setEditData({})
      load()
    } catch (e) { alert(e.message) } finally { setSaving(false) }
  }

  async function resolveOutage(id) {
    try {
      await api.mmtUpdateOutage(slug, id, { status: 'resolved' })
      load()
    } catch (e) { alert(e.message) }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0d0f1a' }}>
      <OrgNav slug={slug} />
      <main style={{ marginLeft: 208, flex: 1, padding: '28px 32px', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 500, color: '#e2e8f0', margin: '0 0 4px' }}>Outage Log</h1>
            <p style={{ fontSize: 12, color: '#475569', margin: 0 }}>Consolidated outage tracking with RCA</p>
          </div>
          <button onClick={() => setShowNew(s => !s)} style={btn('#3b82f6', '#fff')}>
            {showNew ? '− cancel' : '+ log outage'}
          </button>
        </div>

        {/* New outage form */}
        {showNew && (
          <div style={{ background: '#12151e', border: '1px solid #1e2535', borderRadius: 10, padding: '20px', marginBottom: 20 }}>
            <h3 style={{ fontSize: 13, fontWeight: 500, color: '#e2e8f0', margin: '0 0 16px' }}>New Outage</h3>
            <label style={lbl}>Title *</label>
            <input value={newOutage.title} onChange={e => setNewOutage(o => ({ ...o, title: e.target.value }))} style={inp({ width: '100%' })} placeholder="Brief outage description" />
            <label style={lbl}>Description</label>
            <textarea value={newOutage.description} onChange={e => setNewOutage(o => ({ ...o, description: e.target.value }))} rows={3} style={{ ...inp({ width: '100%' }), resize: 'vertical' }} placeholder="What happened?" />
            <label style={lbl}>Impact</label>
            <input value={newOutage.impact} onChange={e => setNewOutage(o => ({ ...o, impact: e.target.value }))} style={inp({ width: '100%' })} placeholder="Which services / users affected?" />
            <button onClick={createOutage} disabled={saving || !newOutage.title.trim()} style={{ ...btn('#3b82f6', '#fff'), marginTop: 16 }}>
              {saving ? 'logging...' : 'log outage'}
            </button>
          </div>
        )}

        {loading ? (
          <div style={{ color: '#475569', fontSize: 13 }}>loading...</div>
        ) : outages.length === 0 ? (
          <div style={{ color: '#475569', fontSize: 13 }}>No outages logged.</div>
        ) : (
          outages.map(o => (
            <div key={o.id} style={{ background: '#12151e', border: '1px solid #1e2535', borderRadius: 10, marginBottom: 12, overflow: 'hidden' }}>
              <div
                style={{ padding: '16px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}
                onClick={() => setExpanded(e => e === o.id ? null : o.id)}
              >
                <StatusBadge status={o.status} />
                <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: '#e2e8f0' }}>{o.title}</span>
                <span style={{ fontSize: 11, color: '#475569' }}>{timeAgo(o.started_at)}</span>
                <span style={{ fontSize: 11, color: '#334155' }}>{expanded === o.id ? '▲' : '▼'}</span>
              </div>

              {expanded === o.id && (
                <div style={{ borderTop: '1px solid #1e2535', padding: '16px 20px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                    <div>
                      <p style={{ fontSize: 11, color: '#475569', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Started</p>
                      <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>{fmtDt(o.started_at)}</p>
                    </div>
                    <div>
                      <p style={{ fontSize: 11, color: '#475569', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Resolved</p>
                      <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>{fmtDt(o.resolved_at)}</p>
                    </div>
                  </div>

                  {o.description && (
                    <div style={{ marginBottom: 12 }}>
                      <p style={{ fontSize: 11, color: '#475569', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Description</p>
                      <p style={{ fontSize: 13, color: '#94a3b8', margin: 0, lineHeight: 1.6 }}>{o.description}</p>
                    </div>
                  )}
                  {o.impact && (
                    <div style={{ marginBottom: 12 }}>
                      <p style={{ fontSize: 11, color: '#475569', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Impact</p>
                      <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>{o.impact}</p>
                    </div>
                  )}

                  {/* Edit / RCA section */}
                  {editId === o.id ? (
                    <div style={{ borderTop: '1px solid #1e2535', paddingTop: 14, marginTop: 4 }}>
                      <label style={lbl}>Status</label>
                      <select value={editData.status || o.status} onChange={e => setEditData(d => ({ ...d, status: e.target.value }))} style={{ ...inp({}), marginBottom: 8 }}>
                        {['ongoing', 'monitoring', 'resolved'].map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <label style={lbl}>Root Cause (RCA)</label>
                      <textarea value={editData.root_cause ?? o.root_cause ?? ''} onChange={e => setEditData(d => ({ ...d, root_cause: e.target.value }))} rows={3} style={{ ...inp({ width: '100%' }), resize: 'vertical', marginBottom: 8 }} placeholder="Root cause analysis..." />
                      <label style={lbl}>Resolution</label>
                      <textarea value={editData.resolution ?? o.resolution ?? ''} onChange={e => setEditData(d => ({ ...d, resolution: e.target.value }))} rows={2} style={{ ...inp({ width: '100%' }), resize: 'vertical', marginBottom: 8 }} placeholder="How was it resolved?" />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => updateOutage(o.id)} disabled={saving} style={btn('#3b82f6', '#fff')}>{saving ? 'saving...' : 'save'}</button>
                        <button onClick={() => { setEditId(null); setEditData({}) }} style={btn('#1e2535', '#94a3b8')}>cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ borderTop: '1px solid #1e2535', paddingTop: 12, marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {o.root_cause && (
                        <div style={{ width: '100%', marginBottom: 8 }}>
                          <p style={{ fontSize: 11, color: '#475569', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>RCA</p>
                          <p style={{ fontSize: 13, color: '#94a3b8', margin: 0, lineHeight: 1.6 }}>{o.root_cause}</p>
                        </div>
                      )}
                      {o.resolution && (
                        <div style={{ width: '100%', marginBottom: 8 }}>
                          <p style={{ fontSize: 11, color: '#475569', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Resolution</p>
                          <p style={{ fontSize: 13, color: '#94a3b8', margin: 0, lineHeight: 1.6 }}>{o.resolution}</p>
                        </div>
                      )}
                      <button onClick={() => { setEditId(o.id); setEditData({}) }} style={btn('#1e2535', '#94a3b8')}>edit / add RCA</button>
                      {o.status !== 'resolved' && (
                        <button onClick={() => resolveOutage(o.id)} style={btn('#4ade8022', '#4ade80')}>✓ mark resolved</button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </main>
    </div>
  )
}

function btn(bg, color) {
  return { padding: '7px 16px', background: bg, color, border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }
}
function inp(extra) {
  return { background: '#191d2b', border: '1px solid #1e2535', borderRadius: 6, color: '#e2e8f0', fontSize: 13, padding: '6px 10px', fontFamily: 'inherit', outline: 'none', display: 'block', marginBottom: 8, ...extra }
}
const lbl = { display: 'block', fontSize: 11, color: '#64748b', marginBottom: 4, marginTop: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }
