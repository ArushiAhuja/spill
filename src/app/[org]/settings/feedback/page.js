'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api'
import { timeAgo } from '@/lib/auth'

const LABEL_META = {
  not_relevant:        { label: 'not relevant',       color: '#f87171', group: 'excluded' },
  wrong_geography:     { label: 'wrong geography',    color: '#f87171', group: 'excluded' },
  unrelated_complaint: { label: 'unrelated',          color: '#f87171', group: 'excluded' },
  too_generic:         { label: 'too generic',        color: '#f87171', group: 'excluded' },
  duplicate:           { label: 'duplicate',          color: '#64748b', group: 'excluded' },
  false_positive:      { label: 'false positive',     color: '#f87171', group: 'excluded' },
  wrong_category:      { label: 'wrong category',     color: '#a78bfa', group: 'corrections' },
  missed_category:     { label: 'missed category',    color: '#a78bfa', group: 'corrections' },
  wrong_severity:      { label: 'wrong severity',     color: '#f59e0b', group: 'corrections' },
  missed_context:      { label: 'missed context',     color: '#a78bfa', group: 'boosted' },
  useful:              { label: 'useful',             color: '#4ade80', group: 'boosted' },
  high_signal:         { label: 'high signal',        color: '#3b82f6', group: 'boosted' },
}

const EXCLUDED_LABELS = new Set(['not_relevant', 'wrong_geography', 'unrelated_complaint', 'too_generic', 'duplicate', 'false_positive'])
const CORRECTION_LABELS = new Set(['wrong_category', 'missed_category', 'wrong_severity'])

const SOURCE_COLORS = {
  reddit: '#f87171', hackernews: '#3b82f6', google_news: '#4ade80',
  twitter: '#60a5fa', playstore: '#9b8ff7', appstore: '#34d399',
}

function LabelChip({ label, small }) {
  const meta = LABEL_META[label]
  if (!meta) return null
  const c = meta.color
  return (
    <span style={{
      fontSize: small ? 10 : 11, padding: small ? '1px 6px' : '2px 9px', borderRadius: 99,
      background: `${c}18`, border: `1px solid ${c}44`, color: c,
      whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)',
    }}>
      {meta.label}
    </span>
  )
}

function StatusBadge({ status }) {
  if (!status || status === 'unread') return null
  const colors = {
    acknowledged: '#60a5fa', resolved: '#4ade80',
    archived: '#475569', dismissed: '#334155',
  }
  const c = colors[status] || '#475569'
  return (
    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 99, background: `${c}18`, border: `1px solid ${c}44`, color: c, fontFamily: 'var(--font-mono)' }}>
      {status}
    </span>
  )
}

function AdjustmentBadge({ text }) {
  if (!text) return null
  return (
    <span style={{ fontSize: 10, color: '#3b82f6', fontStyle: 'italic', fontFamily: 'var(--font-mono)' }}>
      → {text}
    </span>
  )
}

function AiDecisionSnippet({ item }) {
  if (!item.escalation_score && !item.category_name && !item.ai_reasoning) return null
  return (
    <div style={{ marginTop: 6, padding: '6px 10px', background: 'rgba(59,130,246,0.04)', border: '1px solid rgba(59,130,246,0.1)', borderRadius: 6 }}>
      <div style={{ fontSize: 9, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>
        AI decision
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
        {item.category_name && (
          <span style={{ fontSize: 11, color: '#64748b' }}>
            category: <span style={{ color: '#94a3b8' }}>{item.category_name}</span>
          </span>
        )}
        {item.escalation_score !== null && item.escalation_score !== undefined && (
          <span style={{ fontSize: 11, color: '#64748b' }}>
            score: <span style={{ color: item.escalation_score >= 60 ? '#f59e0b' : '#94a3b8' }}>{item.escalation_score}</span>
            {item.severity_direction && (
              <span style={{ color: '#334155', fontSize: 10, marginLeft: 4 }}>
                ({item.severity_direction === 'lower' ? 'was too high' : 'was too low'})
              </span>
            )}
          </span>
        )}
      </div>
      {item.ai_reasoning && (
        <div style={{ fontSize: 11, color: '#334155', lineHeight: 1.4, marginTop: 4, fontStyle: 'italic' }}>
          {item.ai_reasoning.length > 160 ? item.ai_reasoning.slice(0, 160) + '…' : item.ai_reasoning}
        </div>
      )}
    </div>
  )
}

function EditRow({ item, onSave, onCancel }) {
  const [label, setLabel] = useState(item.label || '')
  const [explanation, setExplanation] = useState(item.explanation || '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      await onSave({ label, explanation })
    } finally { setSaving(false) }
  }

  return (
    <div style={{ padding: '14px 20px', background: '#0b0d16', borderTop: '1px solid #1e2535', animation: 'fadeIn 0.15s ease both' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {Object.entries(LABEL_META).map(([id, meta]) => {
          const active = label === id
          const c = meta.color
          return (
            <button
              key={id}
              onClick={() => setLabel(active ? '' : id)}
              style={{
                fontSize: 11, padding: '3px 10px', borderRadius: 99,
                border: `1px solid ${active ? c : '#1e2535'}`,
                background: active ? `${c}18` : 'transparent',
                color: active ? c : '#475569',
                cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.12s',
              }}
              onMouseEnter={e => { if (!active) { e.currentTarget.style.borderColor = c; e.currentTarget.style.color = c } }}
              onMouseLeave={e => { if (!active) { e.currentTarget.style.borderColor = '#1e2535'; e.currentTarget.style.color = '#475569' } }}
            >
              {meta.label}
            </button>
          )
        })}
      </div>
      <textarea
        value={explanation}
        onChange={e => setExplanation(e.target.value)}
        placeholder="explain why (helps spill learn faster)..."
        rows={2}
        style={{ width: '100%', fontSize: 12, background: '#191d2b', border: '1px solid #243047', borderRadius: 6, color: '#94a3b8', padding: '6px 8px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box' }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          onClick={handleSave}
          disabled={!label || saving}
          style={{ fontSize: 11, padding: '4px 14px', background: label ? '#3b82f6' : '#13161f', color: label ? '#fff' : '#334155', border: 'none', borderRadius: 6, cursor: label ? 'pointer' : 'default', fontFamily: 'inherit' }}
        >
          {saving ? '…' : 'save'}
        </button>
        <button
          onClick={onCancel}
          style={{ fontSize: 11, padding: '4px 12px', background: 'transparent', color: '#475569', border: '1px solid #1e2535', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          cancel
        </button>
      </div>
    </div>
  )
}

export default function FeedbackHistoryPage({ params }) {
  const slug = params.org
  const router = useRouter()

  const [feedback, setFeedback] = useState([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const [exclusionTerms, setExclusionTerms] = useState([])
  const [boostTerms, setBoostTerms] = useState([])
  const [typicalComplaints, setTypicalComplaints] = useState([])
  const [overEscalationPatterns, setOverEscalationPatterns] = useState([])
  const [underEscalationPatterns, setUnderEscalationPatterns] = useState([])

  const [editingId, setEditingId] = useState(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)
  const [deleting, setDeleting] = useState(null)

  async function load(pg = page, f = filter) {
    setLoading(true)
    setError('')
    try {
      const data = await api.getFeedback(slug, { label: f === 'all' ? undefined : f, page: pg, limit: 50 })
      setFeedback(data.feedback || [])
      setTotal(data.total || 0)
      setPages(data.pages || 1)
      setExclusionTerms(data.exclusionTerms || [])
      setBoostTerms(data.boostTerms || [])
      setTypicalComplaints(data.typicalComplaints || [])
      setOverEscalationPatterns(data.overEscalationPatterns || [])
      setUnderEscalationPatterns(data.underEscalationPatterns || [])
    } catch (err) {
      if (err.message === 'unauthorized') router.replace('/login')
      else setError(err.message || 'failed to load')
    } finally { setLoading(false) }
  }

  useEffect(() => { load(1, filter) }, [slug, filter])
  useEffect(() => { load(page, filter) }, [page])

  async function handleEdit(id, body) {
    await api.updateFeedback(slug, id, body)
    setFeedback(prev => prev.map(f => f.id === id ? { ...f, ...body } : f))
    setEditingId(null)
  }

  async function handleDelete(id) {
    setDeleting(id)
    try {
      await api.deleteFeedback(slug, id)
      setFeedback(prev => prev.filter(f => f.id !== id))
      setTotal(t => t - 1)
    } catch { /* ignore */ } finally {
      setDeleting(null)
      setDeleteConfirmId(null)
    }
  }

  const hasPatterns = exclusionTerms.length > 0 || boostTerms.length > 0 ||
    typicalComplaints.length > 0 || overEscalationPatterns.length > 0 || underEscalationPatterns.length > 0

  const filterTabs = [
    { key: 'all',         label: 'all' },
    { key: 'excluded',    label: 'excluded' },
    { key: 'boosted',     label: 'boosted' },
    { key: 'corrections', label: 'corrections' },
  ]

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '40px 24px 80px' }}>
      {/* Back link */}
      <Link
        href={`/${slug}/settings`}
        style={{ fontSize: 12, color: '#475569', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 28, transition: 'color 0.12s' }}
        onMouseEnter={e => e.currentTarget.style.color = '#94a3b8'}
        onMouseLeave={e => e.currentTarget.style.color = '#475569'}
      >
        ← settings
      </Link>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 18, fontWeight: 500, color: '#e2e8f0', marginBottom: 6 }}>feedback history</div>
        <div style={{ fontSize: 13, color: '#475569', fontStyle: 'italic' }}>spill remembers what matters to us.</div>
      </div>

      {/* Learned patterns banner */}
      {hasPatterns && (
        <div style={{ marginBottom: 24, padding: '14px 16px', background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.15)', borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 14 }}>

          {exclusionTerms.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 7, fontFamily: 'var(--font-mono)' }}>
                active exclusions — filtered every cycle
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {exclusionTerms.map((term, i) => (
                  <span key={i} style={{ fontSize: 11, padding: '2px 9px', borderRadius: 99, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)', color: '#f87171', fontFamily: 'var(--font-mono)' }}>
                    −{term}
                  </span>
                ))}
              </div>
            </div>
          )}

          {boostTerms.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 7, fontFamily: 'var(--font-mono)' }}>
                active boosts — prioritized every cycle
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {boostTerms.map((term, i) => (
                  <span key={i} style={{ fontSize: 11, padding: '2px 9px', borderRadius: 99, background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.25)', color: '#4ade80', fontFamily: 'var(--font-mono)' }}>
                    +{term}
                  </span>
                ))}
              </div>
            </div>
          )}

          {typicalComplaints.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 7, fontFamily: 'var(--font-mono)' }}>
                known complaint patterns — used in classification
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {typicalComplaints.map((p, i) => (
                  <span key={i} style={{ fontSize: 11, padding: '2px 9px', borderRadius: 99, background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.25)', color: '#a78bfa', fontFamily: 'var(--font-mono)' }}>
                    {p}
                  </span>
                ))}
              </div>
            </div>
          )}

          {overEscalationPatterns.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 7, fontFamily: 'var(--font-mono)' }}>
                over-escalation patterns — severity scored lower
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {overEscalationPatterns.map((p, i) => (
                  <span key={i} style={{ fontSize: 11, padding: '2px 9px', borderRadius: 99, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', color: '#f59e0b', fontFamily: 'var(--font-mono)' }}>
                    ↓{p}
                  </span>
                ))}
              </div>
            </div>
          )}

          {underEscalationPatterns.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 7, fontFamily: 'var(--font-mono)' }}>
                under-escalation patterns — severity scored higher
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {underEscalationPatterns.map((p, i) => (
                  <span key={i} style={{ fontSize: 11, padding: '2px 9px', borderRadius: 99, background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', color: '#3b82f6', fontFamily: 'var(--font-mono)' }}>
                    ↑{p}
                  </span>
                ))}
              </div>
            </div>
          )}

        </div>
      )}

      {/* Filters + count */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 2, padding: 3, background: '#0d0f1a', borderRadius: 8, border: '1px solid #1e2535' }}>
          {filterTabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => { setFilter(tab.key); setPage(1) }}
              style={{
                fontSize: 11, padding: '4px 12px', borderRadius: 5,
                background: filter === tab.key ? '#191d2b' : 'transparent',
                color: filter === tab.key ? '#e2e8f0' : '#64748b',
                border: filter === tab.key ? '1px solid #1e2535' : '1px solid transparent',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {!loading && (
          <span style={{ fontSize: 11.5, color: '#334155', fontFamily: 'var(--font-mono)' }}>
            {total} signal{total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 8, fontSize: 12, color: '#f87171', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Feedback list */}
      {loading ? (
        <div style={{ display: 'flex', gap: 4, padding: '60px 0', justifyContent: 'center' }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: '#3b82f6', animation: `pulseDot 1.2s ${i * 0.18}s ease-in-out infinite` }} />
          ))}
        </div>
      ) : feedback.length === 0 ? (
        <div style={{ padding: '80px 0', textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: '#475569', marginBottom: 6 }}>
            {filter === 'all' ? 'no feedback logged yet.' : `no ${filter} signals yet.`}
          </div>
          <div style={{ fontSize: 12.5, color: '#334155' }}>
            open any post and use the ⋯ menu to give feedback.
          </div>
        </div>
      ) : (
        <div style={{ border: '1px solid #1e2535', borderRadius: 12, overflow: 'hidden' }}>
          {feedback.map((item, idx) => {
            const isEditing = editingId === item.id
            const isDeleteConfirm = deleteConfirmId === item.id
            const meta = LABEL_META[item.label]
            const srcColor = SOURCE_COLORS[item.post_source] || '#64748b'
            const isExcluded = EXCLUDED_LABELS.has(item.label)
            const isCorrection = CORRECTION_LABELS.has(item.label)

            return (
              <div
                key={item.id}
                style={{
                  borderTop: idx > 0 ? '1px solid #1e2535' : 'none',
                  background: isEditing ? '#0b0d16' : 'transparent',
                  transition: 'background 0.1s',
                }}
              >
                {/* Main row */}
                <div
                  style={{ padding: '14px 20px', display: 'flex', alignItems: 'flex-start', gap: 14 }}
                  onMouseEnter={e => { if (!isEditing) e.currentTarget.style.background = '#13161f' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  {/* Source dot */}
                  <div style={{ paddingTop: 3, flexShrink: 0 }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: srcColor }} />
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', marginBottom: item.explanation ? 6 : 4 }}>
                      {/* Post title */}
                      {item.post_url ? (
                        <a
                          href={item.post_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: 13, color: '#e2e8f0', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 420, transition: 'color 0.1s', flexShrink: 1 }}
                          onMouseEnter={e => e.currentTarget.style.color = '#3b82f6'}
                          onMouseLeave={e => e.currentTarget.style.color = '#e2e8f0'}
                          title={item.post_title}
                        >
                          {item.post_title || '(no title)'}
                        </a>
                      ) : (
                        <span style={{ fontSize: 13, color: '#64748b', fontStyle: 'italic' }}>{item.post_title || '(deleted post)'}</span>
                      )}
                      {item.label && <LabelChip label={item.label} />}
                    </div>

                    {/* Explanation */}
                    {item.explanation && (
                      <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.5, marginBottom: 6, fontStyle: 'italic' }}>
                        "{item.explanation}"
                      </div>
                    )}

                    {/* AI decision snippet */}
                    <AiDecisionSnippet item={item} />

                    {/* Meta row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
                      <span style={{ fontSize: 11, color: '#334155', fontFamily: 'var(--font-mono)' }}>
                        {timeAgo(item.created_at)}
                      </span>
                      {item.post_status && item.post_status !== 'unread' && (
                        <StatusBadge status={item.post_status} />
                      )}
                      {item.resulting_adjustment && (
                        <AdjustmentBadge text={item.resulting_adjustment} />
                      )}
                      {!item.resulting_adjustment && isExcluded && exclusionTerms.length > 0 && (
                        <span style={{ fontSize: 10, color: '#f87171', fontFamily: 'var(--font-mono)' }}>exclusion active</span>
                      )}
                      {!item.resulting_adjustment && !isExcluded && !isCorrection && item.label === 'high_signal' && (
                        <span style={{ fontSize: 10, color: '#3b82f6', fontFamily: 'var(--font-mono)' }}>boost active</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {!isDeleteConfirm && (
                      <>
                        <button
                          onClick={() => { setEditingId(isEditing ? null : item.id); setDeleteConfirmId(null) }}
                          style={{ fontSize: 11, padding: '3px 10px', borderRadius: 5, background: 'transparent', color: isEditing ? '#3b82f6' : '#475569', border: `1px solid ${isEditing ? 'rgba(59,130,246,0.4)' : '#1e2535'}`, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.12s' }}
                          onMouseEnter={e => { if (!isEditing) { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.borderColor = '#243047' } }}
                          onMouseLeave={e => { if (!isEditing) { e.currentTarget.style.color = '#475569'; e.currentTarget.style.borderColor = '#1e2535' } }}
                        >
                          edit
                        </button>
                        <button
                          onClick={() => { setDeleteConfirmId(item.id); setEditingId(null) }}
                          style={{ fontSize: 11, padding: '3px 10px', borderRadius: 5, background: 'transparent', color: '#334155', border: '1px solid transparent', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.12s' }}
                          onMouseEnter={e => { e.currentTarget.style.color = '#f87171'; e.currentTarget.style.borderColor = 'rgba(248,113,113,0.3)' }}
                          onMouseLeave={e => { e.currentTarget.style.color = '#334155'; e.currentTarget.style.borderColor = 'transparent' }}
                        >
                          delete
                        </button>
                      </>
                    )}
                    {isDeleteConfirm && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, animation: 'fadeIn 0.12s ease both' }}>
                        <span style={{ fontSize: 11, color: '#94a3b8' }}>remove this signal?</span>
                        <button
                          onClick={() => handleDelete(item.id)}
                          disabled={deleting === item.id}
                          style={{ fontSize: 11, padding: '3px 10px', borderRadius: 5, background: 'rgba(248,113,113,0.1)', color: '#f87171', border: '1px solid rgba(248,113,113,0.3)', cursor: 'pointer', fontFamily: 'inherit' }}
                        >
                          {deleting === item.id ? '…' : 'yes'}
                        </button>
                        <button
                          onClick={() => setDeleteConfirmId(null)}
                          style={{ fontSize: 11, padding: '3px 10px', borderRadius: 5, background: 'transparent', color: '#475569', border: '1px solid #1e2535', cursor: 'pointer', fontFamily: 'inherit' }}
                        >
                          no
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Edit row */}
                {isEditing && (
                  <EditRow
                    item={item}
                    onSave={(body) => handleEdit(item.id, body)}
                    onCancel={() => setEditingId(null)}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {!loading && pages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 0' }}>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{ fontSize: 12, color: '#64748b', background: 'transparent', border: '1px solid #1e2535', borderRadius: 8, padding: '5px 14px', cursor: page === 1 ? 'not-allowed' : 'pointer', opacity: page === 1 ? 0.4 : 1, fontFamily: 'inherit' }}
          >
            prev
          </button>
          <span style={{ fontSize: 11.5, color: '#334155', fontFamily: 'var(--font-mono)' }}>{page} / {pages}</span>
          <button
            onClick={() => setPage(p => Math.min(pages, p + 1))}
            disabled={page === pages}
            style={{ fontSize: 12, color: '#64748b', background: 'transparent', border: '1px solid #1e2535', borderRadius: 8, padding: '5px 14px', cursor: page === pages ? 'not-allowed' : 'pointer', opacity: page === pages ? 0.4 : 1, fontFamily: 'inherit' }}
          >
            next
          </button>
        </div>
      )}
    </div>
  )
}
