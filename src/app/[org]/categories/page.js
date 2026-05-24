'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'

const PALETTE = ['#3b82f6', '#9b8ff7', '#4ade80', '#f87171', '#60a5fa', '#38bdf8']

function SentimentSparkline({ trend, color }) {
  if (!trend?.length) return <span style={{ fontSize: 11, color: '#334155' }}>no data</span>

  const vals = trend.map(d => d.avg_sentiment)
  const max = Math.max(...vals, 1)
  const W = 80, H = 28

  const pts = vals.map((v, i) => {
    const x = vals.length === 1 ? W / 2 : (i / (vals.length - 1)) * W
    const y = H - (v / max) * H
    return `${x},${y}`
  }).join(' ')

  const latest = vals[vals.length - 1]
  const trendDir = vals.length > 1 ? latest - vals[vals.length - 2] : 0

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <svg width={W} height={H} style={{ overflow: 'visible' }}>
        <polyline
          points={pts}
          fill="none"
          stroke={color || '#3b82f6'}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.8"
        />
        {vals.length > 0 && (
          <circle
            cx={vals.length === 1 ? W / 2 : W}
            cy={H - (vals[vals.length - 1] / max) * H}
            r="2.5"
            fill={color || '#3b82f6'}
          />
        )}
      </svg>
      <span style={{
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        color: latest > 12 ? '#f87171' : latest > 6 ? '#818cf8' : '#4ade80',
      }}>
        {latest.toFixed(0)}
        {trendDir > 1 ? ' ↑' : trendDir < -1 ? ' ↓' : ''}
      </span>
    </div>
  )
}

function severityLabel(v) {
  const n = Number(v) || 0
  if (n <= 7) return 'low'
  if (n <= 15) return 'medium'
  if (n <= 24) return 'high'
  return 'critical'
}

function severityColor(v) {
  const n = Number(v) || 0
  if (n <= 7) return '#4ade80'
  if (n <= 15) return '#3b82f6'
  if (n <= 24) return '#818cf8'
  return '#f87171'
}

function Modal({ title, onClose, onSave, saving, initial }) {
  const [name, setName] = useState(initial?.name || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [severity, setSeverity] = useState(initial?.severity ?? 10)
  const [color, setColor] = useState(initial?.color || PALETTE[0])
  const [err, setErr] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setErr('')
    if (!name.trim()) { setErr('name is required'); return }
    try {
      await onSave({ name, description, severity: Number(severity), color })
    } catch (error) {
      setErr(error.message || 'error saving')
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 50, padding: '24px',
    }}>
      <div style={{
        background: '#13161f',
        border: '1px solid #1e2535',
        borderRadius: 10,
        width: '100%', maxWidth: 440,
        padding: '24px',
        animation: 'fadeUp 0.2s ease both',
      }}>
        {/* Modal header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#e2e8f0' }}>{title}</div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none',
              color: '#334155', fontSize: 18, lineHeight: 1,
              cursor: 'pointer', fontFamily: 'inherit',
              transition: 'color 0.12s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#e2e8f0'}
            onMouseLeave={e => e.currentTarget.style.color = '#334155'}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>name</div>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>description</div>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          {/* Severity slider */}
          <div>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
              severity —{' '}
              <span style={{ color: severityColor(severity), fontWeight: 500 }}>
                {severityLabel(severity)} ({severity})
              </span>
            </div>
            <input
              type="range" min={0} max={30} value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              style={{ width: '100%', accentColor: '#3b82f6', cursor: 'pointer', background: 'transparent', border: 'none', padding: 0 }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#334155', marginTop: 2 }}>
              <span>0</span><span>30</span>
            </div>
          </div>

          {/* Color picker */}
          <div>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>color</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {PALETTE.map((c) => (
                <button
                  key={c} type="button" onClick={() => setColor(c)}
                  style={{
                    width: 22, height: 22, borderRadius: '50%',
                    backgroundColor: c,
                    border: `2px solid ${color === c ? '#e2e8f0' : 'transparent'}`,
                    cursor: 'pointer',
                    transition: 'border-color 0.12s, transform 0.12s',
                    transform: color === c ? 'scale(1.2)' : 'scale(1)',
                  }}
                />
              ))}
            </div>
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
              {saving ? 'saving...' : 'save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function CategoriesPage({ params }) {
  const slug = params.org
  const router = useRouter()
  const [categories, setCategories] = useState([])
  const [trendData, setTrendData] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  async function load() {
    try {
      const [data, trend] = await Promise.all([
        api.getCategories(slug),
        api.getSentimentStats(slug).catch(() => []),
      ])
      setCategories(data || [])
      const byId = {}
      for (const t of (trend || [])) {
        byId[t.id] = t.trend
      }
      setTrendData(byId)
    } catch (err) {
      if (err.message === 'unauthorized') router.replace('/login')
      else setError(err.message || 'failed to load categories')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [slug])

  async function handleSave(data) {
    setSaving(true)
    try {
      if (editTarget) {
        await api.updateCategory(slug, editTarget.id, data)
      } else {
        await api.createCategory(slug, data)
      }
      setModalOpen(false)
      setEditTarget(null)
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(cat) {
    try {
      await api.deleteCategory(slug, cat.id)
      setDeleteConfirm(null)
      await load()
    } catch (err) {
      setError(err.message || 'failed to delete')
    }
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
        <div style={{ fontSize: 12, color: '#334155' }}>loading categories...</div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px' }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 40 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 500, color: '#e2e8f0', marginBottom: 4 }}>categories</div>
          <div style={{ fontSize: 12.5, color: '#64748b' }}>
            spill uses these to classify and score every signal it finds.
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
          + add category
        </button>
      </div>

      {error && (
        <div style={{ fontSize: 12.5, color: '#f87171', padding: '10px 14px', background: 'rgba(248,113,113,0.08)', borderRadius: 8, border: '1px solid rgba(248,113,113,0.2)', marginBottom: 20 }}>
          {error}
        </div>
      )}

      {/* Empty state */}
      {categories.length === 0 && !error && (
        <div style={{ padding: '80px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 15, color: '#64748b', marginBottom: 8 }}>no categories yet.</div>
          <div style={{ fontSize: 13, color: '#334155', marginBottom: 24 }}>spill won't know what to look for.</div>
          <button
            onClick={() => { setEditTarget(null); setModalOpen(true) }}
            style={{
              fontSize: 13, padding: '9px 20px',
              background: '#3b82f6', color: '#0d0f1a',
              border: 'none', borderRadius: 8,
              fontFamily: 'inherit', fontWeight: 500, cursor: 'pointer',
            }}
          >
            add your first category →
          </button>
        </div>
      )}

      {/* Categories table */}
      {categories.length > 0 && (
        <div style={{ border: '1px solid #1e2535', borderRadius: 10, overflow: 'hidden' }}>
          {/* Table header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '32px 1fr 2fr 140px 100px 80px',
            padding: '8px 16px',
            borderBottom: '1px solid #1e2535',
            background: '#13161f',
          }}>
            {['', 'name', 'description', 'severity', '14d sentiment', ''].map((h, i) => (
              <div key={i} style={{ fontSize: 11, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: i === 5 ? 'right' : 'left' }}>
                {h}
              </div>
            ))}
          </div>

          {/* Rows */}
          {categories.map((cat) => (
            <div
              key={cat.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '32px 1fr 2fr 140px 100px 80px',
                padding: '12px 16px',
                borderBottom: '1px solid #1e2535',
                alignItems: 'center',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#13161f'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {/* Color swatch */}
              <div>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: cat.color || '#9b8ff7' }} />
              </div>

              {/* Name */}
              <div style={{ fontSize: 13.5, color: '#e2e8f0', fontWeight: 500 }}>{cat.name}</div>

              {/* Description */}
              <div style={{ fontSize: 12.5, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 12 }}>
                {cat.description || '—'}
              </div>

              {/* Severity bar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="severity-bar" style={{ flex: 1 }}>
                  <div
                    className="severity-fill"
                    style={{
                      width: `${Math.min(100, ((cat.severity || 0) / 30) * 100)}%`,
                      background: severityColor(cat.severity),
                    }}
                  />
                </div>
                <span style={{ fontSize: 11, color: severityColor(cat.severity), fontFamily: 'var(--font-mono)', minWidth: 42 }}>
                  {severityLabel(cat.severity)}
                </span>
              </div>

              {/* Sentiment sparkline */}
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <SentimentSparkline trend={trendData[cat.id]} color={cat.color} />
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  onClick={() => { setEditTarget(cat); setModalOpen(true) }}
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
                  onClick={() => setDeleteConfirm(cat)}
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
          ))}
        </div>
      )}

      {/* Add/Edit modal */}
      {modalOpen && (
        <Modal
          title={editTarget ? 'edit category' : 'add category'}
          onClose={() => { setModalOpen(false); setEditTarget(null) }}
          onSave={handleSave}
          saving={saving}
          initial={editTarget}
        />
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 50, padding: '24px',
        }}>
          <div style={{
            background: '#13161f', border: '1px solid #1e2535',
            borderRadius: 10, width: '100%', maxWidth: 340, padding: '24px',
            animation: 'fadeUp 0.2s ease both',
          }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: '#e2e8f0', marginBottom: 8 }}>delete category?</div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
              &quot;{deleteConfirm.name}&quot; will be permanently removed.
            </div>
            <div style={{
              fontSize: 12, color: '#f87171',
              background: 'rgba(248,113,113,0.07)',
              border: '1px solid rgba(248,113,113,0.2)',
              borderRadius: 6,
              padding: '7px 10px',
              marginBottom: 20,
              lineHeight: 1.5,
            }}>
              all posts classified under this category will lose their category assignment. this cannot be undone.
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
