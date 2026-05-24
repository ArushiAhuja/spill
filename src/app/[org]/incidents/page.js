'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { timeAgo } from '@/lib/auth'

function StatusBadge({ status }) {
  const open = status === 'open'
  return (
    <span style={{
      fontSize: 10,
      padding: '2px 8px',
      borderRadius: 99,
      fontWeight: 500,
      color: open ? '#f87171' : '#4ade80',
      background: open ? 'rgba(248,113,113,0.1)' : 'rgba(74,222,128,0.1)',
      border: `1px solid ${open ? 'rgba(248,113,113,0.25)' : 'rgba(74,222,128,0.25)'}`,
    }}>
      {status}
    </span>
  )
}

export default function IncidentsPage({ params }) {
  const slug = params.org
  const router = useRouter()
  const [incidents, setIncidents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('open')
  const [expanded, setExpanded] = useState(null)
  const [resolveConfirm, setResolveConfirm] = useState(null)

  async function load() {
    try {
      const data = await api.getIncidents(slug, filter)
      setIncidents(data || [])
    } catch (err) {
      if (err.message === 'unauthorized') router.replace('/login')
      else setError(err.message || 'failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { setLoading(true); load() }, [slug, filter])

  async function handleResolve(id) {
    try {
      setResolveConfirm(null)
      await api.resolveIncident(slug, id)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleReopen(id) {
    try {
      await api.patchIncident(slug, id, { status: 'open' })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 5, height: 5, borderRadius: '50%', background: '#f87171',
              animation: `pulseDot 1.2s ${i * 0.18}s ease-in-out infinite`,
            }} />
          ))}
        </div>
        <div style={{ fontSize: 12, color: '#334155' }}>loading incidents...</div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '40px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 500, color: '#e2e8f0', marginBottom: 4 }}>incidents</div>
          <div style={{ fontSize: 12.5, color: '#64748b' }}>
            auto-grouped when 5+ escalated posts share a category within 2 hours.
          </div>
        </div>
        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 2, padding: 3, background: '#0d0f1a', borderRadius: 8, border: '1px solid #1e2535' }}>
          {['open', 'resolved', 'all'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                fontSize: 12, padding: '5px 12px', borderRadius: 6,
                background: filter === f ? '#191d2b' : 'transparent',
                color: filter === f ? '#e2e8f0' : '#64748b',
                border: filter === f ? '1px solid #1e2535' : '1px solid transparent',
                cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.12s',
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ fontSize: 12.5, color: '#f87171', padding: '10px 14px', background: 'rgba(248,113,113,0.08)', borderRadius: 8, border: '1px solid rgba(248,113,113,0.2)', marginBottom: 20 }}>
          {error}
        </div>
      )}

      {incidents.length === 0 && (
        <div style={{ padding: '80px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
          <div style={{ fontSize: 14, color: '#64748b', marginBottom: 6 }}>no {filter !== 'all' ? filter : ''} incidents.</div>
          <div style={{ fontSize: 12.5, color: '#334155' }}>
            incidents appear when 5+ escalated posts cluster in one category within 2 hours.
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {incidents.map(inc => (
          <div
            key={inc.id}
            style={{
              background: '#13161f',
              border: `1px solid ${inc.status === 'open' ? 'rgba(248,113,113,0.2)' : '#1e2535'}`,
              borderRadius: 10,
              overflow: 'hidden',
            }}
          >
            {/* Incident header */}
            <div
              style={{ padding: '14px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}
              onClick={() => setExpanded(expanded === inc.id ? null : inc.id)}
            >
              {/* Category dot */}
              <div style={{
                width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                background: inc.category_color || '#f87171',
              }} />

              {/* Title + meta */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: '#e2e8f0', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {inc.title}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>{inc.post_count} signals</span>
                  <span style={{ fontSize: 11, color: '#334155' }}>·</span>
                  <span style={{ fontSize: 11, color: '#64748b' }}>{timeAgo(inc.started_at || inc.created_at)}</span>
                  {inc.resolved_at && (
                    <>
                      <span style={{ fontSize: 11, color: '#334155' }}>·</span>
                      <span style={{ fontSize: 11, color: '#64748b' }}>resolved {timeAgo(inc.resolved_at)}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Status + actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <StatusBadge status={inc.status} />
                {inc.status === 'open' && resolveConfirm !== inc.id && (
                  <button
                    onClick={e => { e.stopPropagation(); setResolveConfirm(inc.id) }}
                    style={{
                      fontSize: 11.5, padding: '4px 12px',
                      background: 'rgba(74,222,128,0.08)',
                      color: '#4ade80',
                      border: '1px solid rgba(74,222,128,0.25)',
                      borderRadius: 6,
                      cursor: 'pointer', fontFamily: 'inherit',
                      transition: 'all 0.12s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(74,222,128,0.15)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(74,222,128,0.08)'}
                  >
                    resolve
                  </button>
                )}
                {inc.status === 'open' && resolveConfirm === inc.id && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={e => e.stopPropagation()}>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>confirm?</span>
                    <button
                      onClick={e => { e.stopPropagation(); handleResolve(inc.id) }}
                      style={{
                        fontSize: 11.5, padding: '4px 10px',
                        background: 'rgba(74,222,128,0.12)',
                        color: '#4ade80',
                        border: '1px solid rgba(74,222,128,0.3)',
                        borderRadius: 6,
                        cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >yes</button>
                    <button
                      onClick={e => { e.stopPropagation(); setResolveConfirm(null) }}
                      style={{
                        fontSize: 11.5, padding: '4px 10px',
                        background: 'transparent',
                        color: '#64748b',
                        border: '1px solid #1e2535',
                        borderRadius: 6,
                        cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >cancel</button>
                  </div>
                )}
                {inc.status === 'resolved' && (
                  <button
                    onClick={e => { e.stopPropagation(); handleReopen(inc.id) }}
                    style={{
                      fontSize: 11.5, padding: '4px 12px',
                      background: 'transparent',
                      color: '#64748b',
                      border: '1px solid #1e2535',
                      borderRadius: 6,
                      cursor: 'pointer', fontFamily: 'inherit',
                      transition: 'color 0.12s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = '#e2e8f0'}
                    onMouseLeave={e => e.currentTarget.style.color = '#64748b'}
                  >
                    reopen
                  </button>
                )}
                <span style={{
                  fontSize: 10, color: '#334155',
                  transform: expanded === inc.id ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.15s', display: 'inline-block',
                }}>▾</span>
              </div>
            </div>

            {/* Expanded posts */}
            {expanded === inc.id && inc.posts?.length > 0 && (
              <div style={{ borderTop: '1px solid #1e2535' }}>
                {inc.posts.map(p => (
                  <div key={p.id} style={{
                    padding: '10px 16px',
                    borderBottom: '1px solid #1e2535',
                    display: 'flex', alignItems: 'center', gap: 12,
                  }}>
                    <span style={{
                      fontSize: 10, fontFamily: 'var(--font-mono)',
                      color: '#818cf8', fontWeight: 500,
                      background: 'rgba(129,140,248,0.12)',
                      border: '1px solid rgba(129,140,248,0.2)',
                      padding: '1px 6px', borderRadius: 99,
                      flexShrink: 0,
                    }}>{p.escalation_score}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {p.url ? (
                        <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, color: '#94a3b8', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}
                          onMouseEnter={e => e.currentTarget.style.color = '#e2e8f0'}
                          onMouseLeave={e => e.currentTarget.style.color = '#94a3b8'}
                        >
                          {(p.title || '').slice(0, 90)}
                        </a>
                      ) : (
                        <span style={{ fontSize: 12.5, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                          {(p.title || '').slice(0, 90)}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: 11, color: '#475569', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{p.source}</span>
                  </div>
                ))}
                {inc.post_count > inc.posts.length && (
                  <div style={{ padding: '8px 16px', fontSize: 11.5, color: '#334155' }}>
                    + {inc.post_count - inc.posts.length} more signals
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
