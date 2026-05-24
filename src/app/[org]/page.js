'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { timeAgo } from '@/lib/auth'

const SOURCES = ['reddit', 'hackernews', 'google_news', 'twitter', 'playstore']

const SOURCE_COLORS = {
  reddit: '#f87171',
  hackernews: '#3b82f6',
  google_news: '#4ade80',
  twitter: '#60a5fa',
  playstore: '#9b8ff7',
}

const SOURCE_LABELS = {
  reddit: 'reddit',
  hackernews: 'hn',
  google_news: 'news',
  twitter: 'twitter',
  playstore: 'play',
}

function ScorePill({ score }) {
  const s = Number(score) || 0
  const style =
    s >= 80
      ? { color: '#f87171', background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.25)' }
      : s >= 60
      ? { color: '#818cf8', background: 'rgba(129,140,248,0.12)', border: '1px solid rgba(129,140,248,0.25)' }
      : { color: '#334155', background: '#191d2b', border: '1px solid #1e2535' }

  return (
    <span style={{
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      fontWeight: 500,
      padding: '2px 7px',
      borderRadius: 99,
      flexShrink: 0,
      minWidth: 36,
      textAlign: 'center',
      ...style,
    }}>
      {s}
    </span>
  )
}

function SourceDot({ source }) {
  const color = SOURCE_COLORS[source] || '#64748b'
  const label = SOURCE_LABELS[source] || source
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'var(--font-mono)' }}>{label}</span>
    </div>
  )
}

function CategoryPill({ name, color }) {
  if (!name) return <span style={{ fontSize: 11, color: '#334155' }}>—</span>
  return (
    <span style={{
      fontSize: 11,
      padding: '2px 8px',
      borderRadius: 99,
      whiteSpace: 'nowrap',
      flexShrink: 0,
      background: (color || '#9b8ff7') + '22',
      color: color || '#9b8ff7',
      border: `1px solid ${(color || '#9b8ff7')}44`,
    }}>
      {name}
    </span>
  )
}

function SkeletonRow() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '12px 24px',
      borderBottom: '1px solid #1e2535',
      borderLeft: '2px solid transparent',
    }}>
      <div className="skeleton" style={{ width: 36, height: 20, borderRadius: 99 }} />
      <div className="skeleton" style={{ width: 50, height: 12, borderRadius: 4 }} />
      <div className="skeleton" style={{ flex: 1, height: 13, borderRadius: 4 }} />
      <div className="skeleton" style={{ width: 60, height: 20, borderRadius: 99 }} />
      <div className="skeleton" style={{ width: 40, height: 12, borderRadius: 4 }} />
      <div className="skeleton" style={{ width: 18, height: 18, borderRadius: 4 }} />
    </div>
  )
}

function HeaderSourceDot({ source, count }) {
  const color = SOURCE_COLORS[source] || '#64748b'
  const label = SOURCE_LABELS[source] || source
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'var(--font-mono)' }}>
        {label} {count}
      </span>
    </div>
  )
}

function NoteEditor({ slug, post, onSave }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(post.notes || '')
  const [saving, setSaving] = useState(false)
  async function handleSave() {
    setSaving(true)
    try {
      await api.updatePost(slug, post.id, { notes: value })
      onSave(value)
      setEditing(false)
    } catch { /* silently fail */ } finally { setSaving(false) }
  }
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 10, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>
        internal note
      </div>
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea
            value={value}
            onChange={e => setValue(e.target.value)}
            rows={2}
            autoFocus
            style={{ fontSize: 12.5, background: '#191d2b', border: '1px solid #243047', borderRadius: 6, color: '#94a3b8', padding: '6px 8px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={handleSave} disabled={saving} style={{ fontSize: 11, padding: '3px 10px', background: '#3b82f6', color: '#0d0f1a', border: 'none', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' }}>{saving ? '…' : 'save'}</button>
            <button onClick={() => { setValue(post.notes || ''); setEditing(false) }} style={{ fontSize: 11, padding: '3px 10px', background: 'transparent', color: '#475569', border: '1px solid #1e2535', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' }}>cancel</button>
          </div>
        </div>
      ) : (
        <div
          onClick={() => setEditing(true)}
          style={{ fontSize: 12.5, color: value ? '#64748b' : '#334155', cursor: 'pointer', lineHeight: 1.5, padding: '4px 0', minHeight: 20, fontStyle: value ? 'normal' : 'italic' }}
        >
          {value || 'add a note…'}
        </div>
      )}
    </div>
  )
}

const FEEDBACK_LABELS = [
  { id: 'not_relevant',        label: 'not relevant to us',   neg: true },
  { id: 'wrong_geography',     label: 'wrong geography',       neg: true },
  { id: 'unrelated_complaint', label: 'unrelated complaint',   neg: true },
  { id: 'too_generic',         label: 'too generic',           neg: true },
  { id: 'duplicate',           label: 'duplicate',             neg: true },
  { id: 'useful',              label: 'useful',                neg: false },
  { id: 'high_signal',         label: 'high signal',           neg: false },
  { id: 'missed_category',     label: 'missed category',       neg: false },
]

function labelColor(id, neg) {
  if (id === 'high_signal') return '#3b82f6'
  if (id === 'missed_category') return '#a78bfa'
  if (id === 'useful') return '#4ade80'
  if (neg) return '#f87171'
  return '#64748b'
}

function FeedbackPanel({ post, slug, categories, onClose, onCategoryChange, onFeedbackSubmit }) {
  const [selectedLabel, setSelectedLabel] = useState(null)
  const [selectedCat, setSelectedCat] = useState(post.category_id || '')
  const [explanation, setExplanation] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)

  useEffect(() => {
    api.getPostFeedback(slug, post.id)
      .then(d => setHistory(d.feedback || []))
      .catch(() => {})
      .finally(() => setHistoryLoading(false))
  }, [slug, post.id])

  async function handleSubmit() {
    if (!selectedLabel) return
    setSubmitting(true)
    try {
      const body = { label: selectedLabel, explanation: explanation.trim() || undefined }
      if (selectedLabel === 'missed_category') {
        body.field = 'category_id'
        body.old_value = post.category_id || null
        body.new_value = selectedCat || null
      }
      await api.submitFeedback(slug, post.id, body)
      if (selectedLabel === 'missed_category' && selectedCat !== post.category_id) {
        onCategoryChange?.(selectedCat)
      }
      setHistory(prev => [{ label: selectedLabel, explanation: explanation.trim() || null, created_at: new Date().toISOString() }, ...prev])
      const submittedLabel = selectedLabel
      setSelectedLabel(null)
      setExplanation('')
      onFeedbackSubmit?.(submittedLabel)
      setSubmitted(true)
      setTimeout(() => setSubmitted(false), 4000)
    } catch { /* ignore */ } finally { setSubmitting(false) }
  }

  return (
    <div style={{ marginTop: 12, padding: '12px 14px', background: '#0b0d16', border: '1px solid #1e2535', borderRadius: 8, animation: 'fadeIn 0.15s ease both' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)' }}>give feedback</span>
          {submitted && <span style={{ fontSize: 11, color: '#4ade80', animation: 'fadeIn 0.2s ease both' }}>logged — spill is learning ↑</span>}
        </div>
        <button onClick={onClose} style={{ fontSize: 12, color: '#334155', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, transition: 'color 0.1s' }} onMouseEnter={e => e.currentTarget.style.color = '#64748b'} onMouseLeave={e => e.currentTarget.style.color = '#334155'}>✕</button>
      </div>

      {/* Label chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {FEEDBACK_LABELS.map(lbl => {
          const c = labelColor(lbl.id, lbl.neg)
          const isActive = selectedLabel === lbl.id
          return (
            <button
              key={lbl.id}
              onClick={() => setSelectedLabel(isActive ? null : lbl.id)}
              style={{
                fontSize: 11, padding: '3px 10px', borderRadius: 99,
                border: `1px solid ${isActive ? c : '#1e2535'}`,
                background: isActive ? `${c}18` : 'transparent',
                color: isActive ? c : '#475569',
                cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.12s',
              }}
              onMouseEnter={e => { if (!isActive) { e.currentTarget.style.borderColor = c; e.currentTarget.style.color = c } }}
              onMouseLeave={e => { if (!isActive) { e.currentTarget.style.borderColor = '#1e2535'; e.currentTarget.style.color = '#475569' } }}
            >
              {lbl.label}
            </button>
          )
        })}
      </div>

      {/* Category dropdown — only for missed_category */}
      {selectedLabel === 'missed_category' && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: '#475569', marginBottom: 5, fontFamily: 'var(--font-mono)' }}>correct category</div>
          <select
            value={selectedCat}
            onChange={e => setSelectedCat(e.target.value)}
            style={{ fontSize: 12, padding: '4px 8px', background: '#191d2b', border: '1px solid #243047', borderRadius: 6, color: '#e2e8f0', fontFamily: 'inherit', width: '100%' }}
          >
            <option value="">unclassified / irrelevant</option>
            {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
          </select>
        </div>
      )}

      {/* Explanation */}
      <textarea
        value={explanation}
        onChange={e => setExplanation(e.target.value)}
        placeholder={selectedLabel
          ? `explain why (helps spill learn faster)... e.g. "aviation academy complaints are not relevant because we only train commercial pilots"`
          : 'select a label above, then explain why...'}
        rows={2}
        style={{ width: '100%', fontSize: 12, background: '#191d2b', border: '1px solid #243047', borderRadius: 6, color: '#94a3b8', padding: '6px 8px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box', transition: 'border-color 0.12s' }}
        onFocus={e => e.currentTarget.style.borderColor = '#334155'}
        onBlur={e => e.currentTarget.style.borderColor = '#243047'}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <button
          onClick={handleSubmit}
          disabled={!selectedLabel || submitting}
          style={{
            fontSize: 11, padding: '4px 14px',
            background: selectedLabel ? '#3b82f6' : '#13161f',
            color: selectedLabel ? '#fff' : '#334155',
            border: `1px solid ${selectedLabel ? '#3b82f6' : '#1e2535'}`,
            borderRadius: 6, cursor: selectedLabel ? 'pointer' : 'default',
            fontFamily: 'inherit', transition: 'all 0.15s',
          }}
        >
          {submitting ? '…' : 'submit feedback'}
        </button>
        {selectedLabel && (
          <span style={{ fontSize: 11, color: '#475569', fontStyle: 'italic' }}>
            {['not_relevant', 'wrong_geography', 'unrelated_complaint', 'too_generic', 'duplicate'].includes(selectedLabel)
              ? 'spill will exclude similar posts from future cycles'
              : selectedLabel === 'high_signal' || selectedLabel === 'useful'
              ? 'spill will prioritize similar signals going forward'
              : selectedLabel === 'missed_category'
              ? 'classification will be corrected on this post'
              : 'feedback helps tune classification'}
          </span>
        )}
      </div>

      {/* Feedback history */}
      {!historyLoading && history.length > 0 && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #1e2535' }}>
          <div style={{ fontSize: 10, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, fontFamily: 'var(--font-mono)' }}>
            {history.length} signal{history.length > 1 ? 's' : ''} logged — influencing retrieval
          </div>
          {history.slice(0, 5).map((h, i) => {
            const c = labelColor(h.label, FEEDBACK_LABELS.find(l => l.id === h.label)?.neg)
            return (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 5 }}>
                <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 99, background: `${c}18`, border: `1px solid ${c}44`, color: c, whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                  {h.label?.replace(/_/g, ' ')}
                </span>
                {h.explanation && <span style={{ fontSize: 11, color: '#334155', lineHeight: 1.4 }}>{h.explanation}</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ActionTray({ post, isExpanded, onRead, onToggleReasoning, onArchive, onDismiss, moreItems, onToggleSelect, isSelected }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const btnBase = {
    fontSize: 11, padding: '2px 6px', borderRadius: 5,
    background: 'transparent', color: '#334155',
    border: '1px solid transparent',
    cursor: 'pointer', fontFamily: 'inherit',
    transition: 'all 0.1s', flexShrink: 0, lineHeight: 1.5,
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
      {/* Read toggle */}
      <button
        onClick={onRead}
        title={post.reviewed ? 'mark unread' : 'mark read'}
        style={{ ...btnBase, color: post.reviewed ? '#3b82f6' : '#334155' }}
        onMouseEnter={e => { e.currentTarget.style.color = '#3b82f6'; e.currentTarget.style.borderColor = 'rgba(59,130,246,0.3)' }}
        onMouseLeave={e => { e.currentTarget.style.color = post.reviewed ? '#3b82f6' : '#334155'; e.currentTarget.style.borderColor = 'transparent' }}
      >✓</button>

      {/* Open source */}
      <a
        href={post.url}
        target="_blank"
        rel="noopener noreferrer"
        title="open source post"
        style={{ ...btnBase, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}
        onMouseEnter={e => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.borderColor = '#243047' }}
        onMouseLeave={e => { e.currentTarget.style.color = '#334155'; e.currentTarget.style.borderColor = 'transparent' }}
      >↗</a>

      {/* View AI reasoning */}
      {(post.reasoning || post.response_template) && (
        <button
          onClick={onToggleReasoning}
          title={isExpanded ? 'hide reasoning' : 'AI reasoning'}
          style={{ ...btnBase, color: isExpanded ? '#3b82f6' : '#334155' }}
          onMouseEnter={e => { e.currentTarget.style.color = '#3b82f6'; e.currentTarget.style.borderColor = 'rgba(59,130,246,0.3)' }}
          onMouseLeave={e => { e.currentTarget.style.color = isExpanded ? '#3b82f6' : '#334155'; e.currentTarget.style.borderColor = 'transparent' }}
        >▾</button>
      )}

      {/* Archive */}
      <button
        onClick={onArchive}
        title="archive — remove from main feed"
        style={btnBase}
        onMouseEnter={e => { e.currentTarget.style.color = '#f59e0b'; e.currentTarget.style.borderColor = 'rgba(245,158,11,0.3)' }}
        onMouseLeave={e => { e.currentTarget.style.color = '#334155'; e.currentTarget.style.borderColor = 'transparent' }}
      >⊘</button>

      {/* Dismiss */}
      <button
        onClick={onDismiss}
        title="dismiss — hide from feed"
        style={btnBase}
        onMouseEnter={e => { e.currentTarget.style.color = '#f87171'; e.currentTarget.style.borderColor = 'rgba(248,113,113,0.3)' }}
        onMouseLeave={e => { e.currentTarget.style.color = '#334155'; e.currentTarget.style.borderColor = 'transparent' }}
      >×</button>

      {/* More dropdown */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setMoreOpen(v => !v)}
          title="more actions"
          style={{ ...btnBase, letterSpacing: 1 }}
          onMouseEnter={e => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.borderColor = '#243047' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#334155'; e.currentTarget.style.borderColor = 'transparent' }}
        >⋯</button>
        {moreOpen && (
          <div
            style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', background: '#13161f', border: '1px solid #1e2535', borderRadius: 8, padding: '4px 0', zIndex: 50, minWidth: 190, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}
            onMouseLeave={() => setMoreOpen(false)}
          >
            {moreItems.map(item => (
              <button
                key={item.label}
                onClick={() => { if (!item.disabled) { item.fn(); setMoreOpen(false) } }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '7px 14px', background: 'none', border: 'none',
                  cursor: item.disabled ? 'default' : 'pointer', fontFamily: 'inherit',
                  opacity: item.disabled ? 0.4 : 1,
                }}
                onMouseEnter={e => { if (!item.disabled) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
              >
                <div style={{ fontSize: 12, color: '#e2e8f0' }}>{item.label}</div>
                {item.sub && <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>{item.sub}</div>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Select checkbox */}
      <button
        onClick={onToggleSelect}
        title={isSelected ? 'deselect' : 'select'}
        style={{
          width: 16, height: 16, borderRadius: 4, marginLeft: 4,
          border: `1px solid ${isSelected ? '#3b82f6' : post.reviewed ? '#3b82f6' : '#243047'}`,
          background: isSelected ? '#3b82f6' : post.reviewed ? 'rgba(59,130,246,0.15)' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', transition: 'all 0.12s', flexShrink: 0,
        }}
        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.borderColor = '#3b82f6' }}
        onMouseLeave={e => { if (!isSelected) e.currentTarget.style.borderColor = post.reviewed ? '#3b82f6' : '#243047' }}
      >
        {isSelected && <svg width="8" height="8" viewBox="0 0 10 10" fill="none"><path d="M1.5 5L4 7.5L8.5 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        {!isSelected && post.reviewed && <svg width="8" height="8" viewBox="0 0 10 10" fill="none"><path d="M1.5 5L4 7.5L8.5 3" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      </button>
    </div>
  )
}

export default function FeedPage({ params }) {
  const slug = params.org
  const router = useRouter()

  const [posts, setPosts] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [actionError, setActionError] = useState('')
  const [categories, setCategories] = useState([])
  const [isFirstLoad, setIsFirstLoad] = useState(true)

  const [filterSource, setFilterSource] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [viewTab, setViewTab] = useState('feed') // 'feed' | 'escalated' | 'saved' | 'archived' | 'dismissed'
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [expandedPostId, setExpandedPostId] = useState(null)
  const [feedbackPostId, setFeedbackPostId] = useState(null)
  const [toasts, setToasts] = useState([])
  const toastTimersRef = useRef({})
  const [feedbackLoggedIds, setFeedbackLoggedIds] = useState(new Set())

  const fetchPosts = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const fetchParams = {
        source: filterSource || undefined,
        category_id: filterCategory || undefined,
        search: search || undefined,
        from_date: fromDate || undefined,
        to_date: toDate || undefined,
        page,
        limit: 50,
      }
      if (viewTab === 'escalated') fetchParams.escalated = true
      else if (viewTab === 'saved') fetchParams.status_filter = 'saved'
      else if (viewTab === 'archived') fetchParams.status_filter = 'archived'
      else if (viewTab === 'dismissed') fetchParams.status_filter = 'dismissed'
      const data = await api.getPosts(slug, fetchParams)
      setPosts(data.posts || [])
      setTotal(data.total || 0)
      setPages(data.pages || 1)
    } catch (err) {
      if (err.message === 'unauthorized') router.replace('/login')
      else setError(err.message || 'failed to load posts')
    } finally {
      setLoading(false)
    }
  }, [slug, filterSource, filterCategory, viewTab, search, fromDate, toDate, page, router])

  const fetchStatus = useCallback(async () => {
    try {
      const s = await api.getStatus(slug)
      setStatus(s)
    } catch {
      // non-critical
    }
  }, [slug])

  useEffect(() => {
    api.getCategories(slug).then(c => setCategories(c || [])).catch(() => {})
  }, [slug])

  useEffect(() => {
    fetchPosts()
    fetchStatus()
  }, [fetchPosts, fetchStatus])

  useEffect(() => {
    if (!loading) setIsFirstLoad(false)
  }, [loading])

  useEffect(() => {
    setSelectedIds(new Set())
  }, [filterSource, filterCategory, viewTab, search, fromDate, toDate, page])

  // Auto-refresh on page load if data is stale — mirrors original Express scheduler
  // which called runOrgCycle immediately on startup, no cron needed.
  useEffect(() => {
    const key = `spill:lastRefresh:${slug}`
    const last = parseInt(sessionStorage.getItem(key) || '0', 10)
    const staleMs = 5 * 60 * 1000 // 5 minutes
    if (Date.now() - last > staleMs) {
      sessionStorage.setItem(key, String(Date.now()))
      api.triggerRefresh(slug).catch(() => {})
    }
  }, [slug])

  async function handleRefresh() {
    setRefreshing(true)
    try {
      const before = status?.lastRefresh ?? null
      await api.triggerRefresh(slug)

      // Poll status until lastRefresh advances (refresh completed) or 45s timeout
      const deadline = Date.now() + 45_000
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 2000))
        const s = await api.getStatus(slug).catch(() => null)
        if (s && s.lastRefresh && s.lastRefresh !== before) {
          setStatus(s)
          break
        }
      }

      await fetchPosts()
      await fetchStatus()
    } catch (err) {
      if (err.message === 'unauthorized') router.replace('/login')
    } finally {
      setRefreshing(false)
    }
  }

  async function toggleReviewed(post) {
    const prev_reviewed = post.reviewed
    const willMarkRead = !prev_reviewed
    setPosts(prev => prev.map(p => p.id === post.id ? { ...p, reviewed: willMarkRead } : p))
    try {
      await api.updatePost(slug, post.id, { reviewed: willMarkRead })
      addToast({
        message: willMarkRead ? 'marked as read' : 'marked as unread',
        sub: willMarkRead ? 'stays in feed, dimmed · does not affect scoring' : null,
        undoFn: () => {
          setPosts(prev => prev.map(p => p.id === post.id ? { ...p, reviewed: prev_reviewed } : p))
          api.updatePost(slug, post.id, { reviewed: prev_reviewed }).catch(() => {})
        },
      })
    } catch {
      setPosts(prev => prev.map(p => p.id === post.id ? { ...p, reviewed: prev_reviewed } : p))
    }
  }

  function toggleSelect(postId) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(postId)) next.delete(postId)
      else next.add(postId)
      return next
    })
  }

  function handleSelectAll() {
    setSelectedIds(new Set(posts.map(p => p.id)))
  }

  function addToast({ message, sub, undoFn }) {
    const id = String(Date.now()) + String(Math.random())
    setToasts(prev => [...prev.slice(-4), { id, message, sub, undoFn }])
    toastTimersRef.current[id] = setTimeout(() => dismissToast(id), 5000)
  }

  function dismissToast(id) {
    clearTimeout(toastTimersRef.current[id])
    delete toastTimersRef.current[id]
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  const NEGATIVE_LABELS = ['not_relevant', 'wrong_geography', 'unrelated_complaint', 'too_generic', 'duplicate']
  const POSITIVE_LABELS = ['high_signal', 'useful', 'missed_category']
  function handleFeedbackSubmit(postId, label) {
    setFeedbackLoggedIds(prev => new Set([...prev, postId]))
    addToast({
      message: 'feedback logged',
      sub: NEGATIVE_LABELS.includes(label)
        ? 'spill will exclude similar posts in future cycles'
        : POSITIVE_LABELS.includes(label)
        ? 'spill will prioritize similar signals going forward'
        : 'classification tuned',
    })
  }

  async function handleUpdateStatus(post, newStatus) {
    const prevStatus = post.post_status
    setPosts(p => p.map(x => x.id === post.id ? { ...x, post_status: newStatus } : x))
    try {
      await api.updatePost(slug, post.id, { post_status: newStatus })
      const labels = { acknowledged: ['acknowledged', "logged that you're handling this"], resolved: ['resolved', 'closed — thread complete'] }
      const [msg, sub] = labels[newStatus] || [`status → ${newStatus}`, null]
      addToast({
        message: msg, sub,
        undoFn: () => {
          setPosts(p => p.map(x => x.id === post.id ? { ...x, post_status: prevStatus } : x))
          api.updatePost(slug, post.id, { post_status: prevStatus }).catch(() => {})
        },
      })
    } catch {
      setPosts(p => p.map(x => x.id === post.id ? { ...x, post_status: prevStatus } : x))
    }
  }

  async function handleArchive(post) {
    const prevStatus = post.post_status
    setPosts(p => p.filter(x => x.id !== post.id))
    try {
      await api.updatePost(slug, post.id, { post_status: 'archived' })
      addToast({
        message: 'archived',
        sub: 'moved to ⊘ archived · spill did not learn from this',
        undoFn: () => {
          api.updatePost(slug, post.id, { post_status: prevStatus || 'unread' }).catch(() => {})
          fetchPosts()
        },
      })
    } catch {
      fetchPosts()
    }
  }

  async function handleDismiss(post) {
    const prevStatus = post.post_status
    setPosts(p => p.filter(x => x.id !== post.id))
    try {
      await api.updatePost(slug, post.id, { post_status: 'dismissed' })
      addToast({
        message: 'dismissed',
        sub: 'hidden from feed · use feedback to teach spill why',
        undoFn: () => {
          api.updatePost(slug, post.id, { post_status: prevStatus || 'unread' }).catch(() => {})
          fetchPosts()
        },
      })
    } catch {
      fetchPosts()
    }
  }

  async function handleEscalate(post) {
    const prev = { manually_escalated: post.manually_escalated, post_status: post.post_status }
    const willEscalate = !post.manually_escalated
    setPosts(p => p.map(x => x.id === post.id ? { ...x, manually_escalated: willEscalate, post_status: willEscalate ? 'acknowledged' : prev.post_status } : x))
    try {
      await api.updatePost(slug, post.id, { manually_escalated: willEscalate, post_status: willEscalate ? 'acknowledged' : prev.post_status })
      addToast({
        message: willEscalate ? 'manually escalated' : 'escalation removed',
        sub: willEscalate ? 'escalation rules will fire for this post' : null,
        undoFn: () => {
          setPosts(p => p.map(x => x.id === post.id ? { ...x, ...prev } : x))
          api.updatePost(slug, post.id, prev).catch(() => {})
        },
      })
    } catch {
      setPosts(p => p.map(x => x.id === post.id ? { ...x, ...prev } : x))
    }
  }

  async function handleSave(post) {
    const prevSavedAt = post.saved_at
    const willSave = !prevSavedAt
    setPosts(p => p.map(x => x.id === post.id ? { ...x, saved_at: willSave ? new Date().toISOString() : null } : x))
    try {
      await api.updatePost(slug, post.id, { saved: willSave })
      addToast({
        message: willSave ? 'saved for later' : 'unsaved',
        sub: willSave ? 'find it in saved view' : null,
        undoFn: () => {
          setPosts(p => p.map(x => x.id === post.id ? { ...x, saved_at: prevSavedAt } : x))
          api.updatePost(slug, post.id, { saved: !willSave }).catch(() => {})
        },
      })
    } catch {
      setPosts(p => p.map(x => x.id === post.id ? { ...x, saved_at: prevSavedAt } : x))
    }
  }


  async function handleMarkSelectedRead() {
    const ids = Array.from(selectedIds)
    const results = await Promise.allSettled(ids.map(id => api.updatePost(slug, id, { reviewed: true })))
    const succeeded = new Set(ids.filter((_, i) => results[i].status === 'fulfilled'))
    setPosts(prev => prev.map(p => succeeded.has(p.id) ? { ...p, reviewed: true } : p))
    setSelectedIds(new Set())
    const failed = ids.length - succeeded.size
    if (failed > 0) {
      setActionError(`${failed} post${failed > 1 ? 's' : ''} failed to update — try again`)
      setTimeout(() => setActionError(''), 3000)
    }
  }

  function handleSearchSubmit(e) {
    e.preventDefault()
    setSearch(searchInput)
    setPage(1)
  }

  const sourceBreakdown = status?.sourceBreakdown || {}
  const sourceHealth = status?.sourceHealth || []
  const staleSources = sourceHealth.filter(s => {
    if (s.error) return true
    if (!s.lastFetchAt) return false
    return (Date.now() - new Date(s.lastFetchAt).getTime()) > 30 * 60 * 1000 // 30 min stale
  })
  const totalEscalated = status?.totalEscalated ?? 0

  const filterPillBase = {
    fontSize: 12,
    padding: '4px 12px',
    borderRadius: 99,
    border: '1px solid #1e2535',
    background: 'transparent',
    color: '#64748b',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.12s ease',
  }

  const filterPillActive = {
    ...filterPillBase,
    background: '#3b82f6',
    border: '1px solid #3b82f6',
    color: '#0d0f1a',
    fontWeight: 500,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Sticky header */}
      <div className="feed-header" style={{
        position: 'sticky',
        top: 0,
        background: '#0d0f1a',
        borderBottom: '1px solid #1e2535',
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 52,
        zIndex: 30,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: '#334155', letterSpacing: '0.05em' }}>feed</span>
          {status?.lastRefresh && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div className="live-dot" />
              <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'var(--font-mono)' }}>
                watching
              </span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* source breakdown dots */}
          {Object.keys(sourceBreakdown).length > 0 && (
            <div className="feed-source-dots" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {Object.entries(sourceBreakdown).map(([src, count]) => (
                <HeaderSourceDot key={src} source={src} count={count} />
              ))}
            </div>
          )}

          <button
            onClick={handleRefresh}
            disabled={refreshing}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: '#64748b',
              background: 'transparent',
              border: '1px solid #1e2535',
              borderRadius: 8,
              padding: '5px 12px',
              fontFamily: 'inherit',
              cursor: refreshing ? 'not-allowed' : 'pointer',
              opacity: refreshing ? 0.5 : 1,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={e => { if (!refreshing) { e.currentTarget.style.borderColor = '#243047'; e.currentTarget.style.color = '#e2e8f0' }}}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#1e2535'; e.currentTarget.style.color = '#64748b' }}
          >
            <span style={{ display: 'inline-block', animation: refreshing ? 'spin 1s linear infinite' : 'none' }}>↻</span>
            refresh
          </button>

          {status?.lastRefresh && (
            <span style={{ fontSize: 11, color: '#334155', fontFamily: 'var(--font-mono)' }}>
              {timeAgo(status.lastRefresh)}
            </span>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="feed-filter-bar" style={{
        padding: '10px 24px',
        borderBottom: '1px solid #1e2535',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        flexShrink: 0,
      }}>
        {/* Source filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={() => { setFilterSource(''); setPage(1) }}
            style={!filterSource ? filterPillActive : filterPillBase}
            onMouseEnter={e => { if (filterSource) { e.currentTarget.style.borderColor = '#243047'; e.currentTarget.style.color = '#e2e8f0' }}}
            onMouseLeave={e => { if (filterSource) { e.currentTarget.style.borderColor = '#1e2535'; e.currentTarget.style.color = '#64748b' }}}
          >
            all
          </button>
          {SOURCES.map(src => (
            <button
              key={src}
              onClick={() => { setFilterSource(src === filterSource ? '' : src); setPage(1) }}
              style={filterSource === src ? { ...filterPillActive, background: SOURCE_COLORS[src] + '22', border: `1px solid ${SOURCE_COLORS[src]}66`, color: SOURCE_COLORS[src] } : filterPillBase}
              onMouseEnter={e => { if (filterSource !== src) { e.currentTarget.style.borderColor = '#243047'; e.currentTarget.style.color = '#e2e8f0' }}}
              onMouseLeave={e => { if (filterSource !== src) { e.currentTarget.style.borderColor = '#1e2535'; e.currentTarget.style.color = '#64748b' }}}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: SOURCE_COLORS[src] || '#64748b', display: 'inline-block' }} />
                {SOURCE_LABELS[src] || src}
              </span>
            </button>
          ))}
        </div>

        {/* Category filter */}
        {categories.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 1, height: 16, background: '#1e2535', flexShrink: 0 }} />
            <select
              value={filterCategory}
              onChange={e => { setFilterCategory(e.target.value); setPage(1) }}
              style={{
                fontSize: 12,
                padding: '3px 8px',
                height: 30,
                borderRadius: 8,
                width: 'auto',
                minWidth: 120,
                color: filterCategory ? '#e2e8f0' : '#64748b',
                background: filterCategory ? '#1e2338' : 'transparent',
                border: filterCategory ? '1px solid #3b82f666' : '1px solid #1e2535',
                cursor: 'pointer',
              }}
            >
              <option value="">all categories</option>
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>
        )}

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', gap: 2, padding: 3, background: '#0d0f1a', borderRadius: 8, border: '1px solid #1e2535' }}>
          {[
            { key: 'feed', label: 'feed' },
            { key: 'escalated', label: '⚡ escalated' },
            { key: 'saved', label: '⊡ saved' },
            { key: 'archived', label: '⊘ archived' },
            { key: 'dismissed', label: '× dismissed' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => { setViewTab(tab.key); setPage(1) }}
              style={{
                fontSize: 11, padding: '4px 10px', borderRadius: 5,
                background: viewTab === tab.key ? '#191d2b' : 'transparent',
                color: viewTab === tab.key ? '#e2e8f0' : '#64748b',
                border: viewTab === tab.key ? '1px solid #1e2535' : '1px solid transparent',
                cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', position: 'relative' }}>
          <input
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="search..."
            style={{
              width: 180,
              fontSize: 12,
              padding: '5px 12px',
              paddingRight: searchInput ? 28 : 12,
              height: 30,
              borderRadius: 8,
            }}
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => { setSearchInput(''); setSearch(''); setPage(1) }}
              style={{
                position: 'absolute',
                right: 8,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: '#475569',
                cursor: 'pointer',
                padding: 0,
                fontSize: 12,
                lineHeight: 1,
                display: 'flex',
                alignItems: 'center',
                transition: 'color 0.12s',
              }}
              onMouseEnter={e => e.currentTarget.style.color = '#94a3b8'}
              onMouseLeave={e => e.currentTarget.style.color = '#475569'}
              title="clear search"
            >
              ✕
            </button>
          )}
        </form>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="date"
            value={fromDate}
            onChange={e => { setFromDate(e.target.value); setPage(1) }}
            style={{ fontSize: 11, padding: '3px 8px', height: 30, borderRadius: 8, width: 130, color: fromDate ? '#e2e8f0' : '#475569' }}
            title="from date"
          />
          <span style={{ fontSize: 11, color: '#334155' }}>–</span>
          <input
            type="date"
            value={toDate}
            onChange={e => { setToDate(e.target.value); setPage(1) }}
            style={{ fontSize: 11, padding: '3px 8px', height: 30, borderRadius: 8, width: 130, color: toDate ? '#e2e8f0' : '#475569' }}
            title="to date"
          />
          {(fromDate || toDate) && (
            <button
              onClick={() => { setFromDate(''); setToDate(''); setPage(1) }}
              style={{ fontSize: 11, color: '#475569', background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px' }}
              title="clear dates"
            >✕</button>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="feed-stats-bar" style={{
        padding: '7px 24px',
        borderBottom: '1px solid #1e2535',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 11.5, color: '#64748b', fontFamily: 'var(--font-mono)' }}>
          {total} signals
        </span>
        {totalEscalated > 0 && (
          <span style={{ fontSize: 11.5, color: '#3b82f6', fontFamily: 'var(--font-mono)' }}>
            {totalEscalated} escalated
          </span>
        )}
        {status?.lastRefresh && (
          <span style={{ fontSize: 11, color: '#334155', fontFamily: 'var(--font-mono)' }}>
            last seen {timeAgo(status.lastRefresh)}
          </span>
        )}
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div style={{
          padding: '8px 24px',
          borderBottom: '1px solid rgba(59,130,246,0.25)',
          background: 'rgba(59,130,246,0.07)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexShrink: 0,
          animation: 'fadeIn 0.15s ease both',
        }}>
          <span style={{ fontSize: 12, color: '#60a5fa', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
            {selectedIds.size} selected
          </span>
          <button
            onClick={handleSelectAll}
            style={{
              fontSize: 12, color: '#475569', background: 'none', border: 'none',
              cursor: 'pointer', fontFamily: 'inherit', padding: 0, transition: 'color 0.12s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#94a3b8'}
            onMouseLeave={e => e.currentTarget.style.color = '#475569'}
          >
            select all
          </button>
          <div style={{ flex: 1 }} />
          <button
            onClick={handleMarkSelectedRead}
            style={{
              fontSize: 12, padding: '5px 14px',
              background: '#3b82f6', color: '#fff',
              border: 'none', borderRadius: 7,
              fontFamily: 'inherit', fontWeight: 500,
              cursor: 'pointer', transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          >
            mark as read →
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            style={{
              fontSize: 13, color: '#334155', background: 'none', border: 'none',
              cursor: 'pointer', lineHeight: 1, padding: '2px 4px', transition: 'color 0.12s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#94a3b8'}
            onMouseLeave={e => e.currentTarget.style.color = '#334155'}
            title="clear selection"
          >
            ✕
          </button>
        </div>
      )}

      {/* Action error toast */}
      {actionError && (
        <div style={{
          padding: '8px 24px',
          background: 'rgba(248,113,113,0.08)',
          borderBottom: '1px solid rgba(248,113,113,0.2)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
          animation: 'fadeIn 0.15s ease both',
        }}>
          <span style={{ fontSize: 12, color: '#f87171' }}>{actionError}</span>
        </div>
      )}

      {/* Stale source health warning */}
      {staleSources.length > 0 && (
        <div style={{
          padding: '8px 24px',
          background: 'rgba(245,158,11,0.07)',
          borderBottom: '1px solid rgba(245,158,11,0.2)',
          display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        }}>
          <span style={{ fontSize: 11, color: '#f59e0b' }}>
            ⚠ {staleSources.map(s => s.source).join(', ')} {staleSources.length === 1 ? 'has' : 'have'} not fetched recently{staleSources.some(s => s.error) ? ' — check credentials in settings' : ''}
          </span>
        </div>
      )}

      {/* Feed */}
      <div className="scrollbar-thin" style={{ flex: 1, overflowY: 'auto' }}>
        {/* Loading skeletons */}
        {loading && (
          <div>
            {[...Array(6)].map((_, i) => <SkeletonRow key={i} />)}
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 24px', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#f87171' }}>{error}</span>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && posts.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 24px', gap: 8 }}>
            {filterSource || filterCategory || viewTab !== 'feed' || search ? (
              <>
                <div style={{ fontSize: 15, color: '#64748b', fontWeight: 400 }}>no results.</div>
                <div style={{ fontSize: 13, color: '#334155' }}>try adjusting your filters.</div>
                <button
                  onClick={() => { setFilterSource(''); setFilterCategory(''); setViewTab('feed'); setSearch(''); setSearchInput(''); setFromDate(''); setToDate(''); setPage(1) }}
                  style={{ marginTop: 8, fontSize: 12, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  clear filters
                </button>
              </>
            ) : !status?.lastRefresh ? (
              <>
                <div style={{ fontSize: 15, color: '#64748b', fontWeight: 400 }}>spill is warming up.</div>
                <div style={{ fontSize: 13, color: '#334155' }}>first results arrive after the next refresh cycle.</div>
                <button
                  onClick={handleRefresh}
                  disabled={refreshing}
                  style={{ marginTop: 12, fontSize: 12, color: '#3b82f6', background: 'none', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 6, padding: '5px 14px', cursor: refreshing ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: refreshing ? 0.5 : 1 }}
                >
                  {refreshing ? 'fetching...' : 'fetch now →'}
                </button>
              </>
            ) : (
              <>
                <div style={{ fontSize: 15, color: '#64748b', fontWeight: 400 }}>quiet internet day.</div>
                <div style={{ fontSize: 13, color: '#334155' }}>probably a good sign. check back soon.</div>
              </>
            )}
          </div>
        )}

        {/* Post rows */}
        {!loading && !error && posts.length > 0 && (
          <div>
            {posts.map(post => {
              const timeStr = post.post_created_at
                ? timeAgo(post.post_created_at)
                : post.fetched_at
                ? timeAgo(post.fetched_at)
                : '—'
              const isExpanded = expandedPostId === post.id
              return (
                <div key={post.id} style={{ borderBottom: '1px solid #1e2535' }}>
                <div
                  className="feed-row"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 24px',
                    borderLeft: selectedIds.has(post.id)
                      ? '2px solid #3b82f6'
                      : post.escalated ? '2px solid rgba(248,113,113,0.6)' : '2px solid transparent',
                    background: selectedIds.has(post.id)
                      ? 'rgba(59,130,246,0.06)'
                      : isExpanded ? '#13161f' : post.escalated ? 'rgba(248,113,113,0.02)' : 'transparent',
                    transition: 'background 0.1s',
                    opacity: post.reviewed && !selectedIds.has(post.id) ? 0.45 : 1,
                    cursor: 'default',
                  }}
                  onMouseEnter={e => {
                    if (!selectedIds.has(post.id) && !isExpanded)
                      e.currentTarget.style.background = post.escalated ? 'rgba(248,113,113,0.05)' : '#13161f'
                  }}
                  onMouseLeave={e => {
                    if (!selectedIds.has(post.id) && !isExpanded)
                      e.currentTarget.style.background = post.escalated ? 'rgba(248,113,113,0.02)' : 'transparent'
                  }}
                >
                  {/* score pill */}
                  <ScorePill score={post.escalation_score} />

                  {/* source dot */}
                  <SourceDot source={post.source} />

                  {/* title */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <a
                        href={post.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontSize: 13.5,
                          color: '#e2e8f0',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          transition: 'color 0.1s',
                          minWidth: 0,
                        }}
                        onMouseEnter={e => e.currentTarget.style.color = '#3b82f6'}
                        onMouseLeave={e => e.currentTarget.style.color = '#e2e8f0'}
                        title={post.title || post.body}
                      >
                        {post.title || post.body?.slice(0, 80) || '(no title)'}
                      </a>
                      {post.is_influencer && (
                        <span title="high-influence account" style={{ fontSize: 10, flexShrink: 0 }}>⭐</span>
                      )}
                      {post.is_competitor && (
                        <span style={{
                          fontSize: 9, padding: '1px 5px', borderRadius: 99, flexShrink: 0,
                          color: '#f59e0b', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)',
                          whiteSpace: 'nowrap',
                        }}>
                          {post.competitor_name || 'competitor'}
                        </span>
                      )}
                      {post.location_tag && (
                        <span style={{
                          fontSize: 9, padding: '1px 5px', borderRadius: 99, flexShrink: 0,
                          color: '#64748b', background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.2)',
                          whiteSpace: 'nowrap',
                        }}>
                          📍 {post.location_tag}
                        </span>
                      )}
                      {post.is_partner && (
                        <span style={{
                          fontSize: 9, padding: '1px 5px', borderRadius: 99, flexShrink: 0,
                          color: '#a78bfa', background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.2)',
                          whiteSpace: 'nowrap',
                        }}>
                          ⟐ {post.partner_name || 'partner'}
                        </span>
                      )}
                      {(post.reasoning || post.response_template) && (
                        <button
                          onClick={() => setExpandedPostId(isExpanded ? null : post.id)}
                          title={isExpanded ? 'hide reasoning' : 'show AI reasoning'}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: isExpanded ? '#3b82f6' : '#334155',
                            fontSize: 10, padding: '1px 4px', lineHeight: 1,
                            flexShrink: 0, transition: 'color 0.12s',
                            fontFamily: 'var(--font-mono)',
                          }}
                          onMouseEnter={e => e.currentTarget.style.color = '#3b82f6'}
                          onMouseLeave={e => e.currentTarget.style.color = isExpanded ? '#3b82f6' : '#334155'}
                        >
                          {isExpanded ? '▲' : '▼'}
                        </button>
                      )}
                    </div>
                    {post.author && (
                      <div style={{ fontSize: 11, color: '#334155', marginTop: 1 }}>{post.author}</div>
                    )}
                  </div>

                  {/* category pill */}
                  <span className="feed-row-category">
                    <CategoryPill name={post.category_name} color={post.category_color} />
                  </span>

                  {/* time */}
                  <span className="feed-row-time" style={{
                    fontSize: 11,
                    color: '#334155',
                    fontFamily: 'var(--font-mono)',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    minWidth: 44,
                    textAlign: 'right',
                  }}>
                    {timeStr}
                  </span>

                  {/* SLA age indicator for unread escalated posts */}
                  {post.escalated && post.post_status === 'unread' && post.fetched_at && (
                    (() => {
                      const mins = Math.floor((Date.now() - new Date(post.fetched_at).getTime()) / 60000)
                      const isStale = mins >= 30
                      return (
                        <span style={{
                          fontSize: 10, fontFamily: 'var(--font-mono)', flexShrink: 0,
                          color: isStale ? '#f87171' : '#475569',
                          display: mins > 0 ? 'inline' : 'none',
                        }}>
                          {mins < 60 ? `${mins}m` : `${Math.floor(mins/60)}h`}
                        </span>
                      )
                    })()
                  )}

                  {/* Status badges */}
                  {post.manually_escalated && (
                    <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 99, flexShrink: 0, color: '#f87171', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)' }}>
                      escalated
                    </span>
                  )}
                  {post.saved_at && (
                    <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 99, flexShrink: 0, color: '#a78bfa', background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.25)' }}>
                      saved
                    </span>
                  )}
                  {feedbackLoggedIds.has(post.id) && (
                    <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 99, flexShrink: 0, color: '#60a5fa', background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)', fontFamily: 'var(--font-mono)' }}>
                      ↑ learned
                    </span>
                  )}
                  {post.post_status && !['unread', 'archived', 'dismissed'].includes(post.post_status) && (
                    <span style={{
                      fontSize: 9, padding: '1px 6px', borderRadius: 99, flexShrink: 0,
                      color: post.post_status === 'resolved' ? '#4ade80' : '#60a5fa',
                      background: post.post_status === 'resolved' ? 'rgba(74,222,128,0.1)' : 'rgba(96,165,250,0.1)',
                      border: `1px solid ${post.post_status === 'resolved' ? 'rgba(74,222,128,0.25)' : 'rgba(96,165,250,0.25)'}`,
                    }}>
                      {post.post_status}
                    </span>
                  )}

                  {/* Action tray */}
                  <ActionTray
                    post={post}
                    isExpanded={isExpanded}
                    onRead={() => toggleReviewed(post)}
                    onToggleReasoning={() => setExpandedPostId(isExpanded ? null : post.id)}
                    onArchive={() => handleArchive(post)}
                    onDismiss={() => handleDismiss(post)}
                    onToggleSelect={() => toggleSelect(post.id)}
                    isSelected={selectedIds.has(post.id)}
                    moreItems={[
                      { label: 'acknowledge', sub: "log that you're handling this", fn: () => handleUpdateStatus(post, 'acknowledged'), disabled: ['acknowledged', 'resolved'].includes(post.post_status) },
                      { label: 'mark resolved', sub: 'close this thread', fn: () => handleUpdateStatus(post, 'resolved'), disabled: post.post_status === 'resolved' },
                      { label: post.manually_escalated ? 'remove escalation' : 'escalate', sub: 'fire escalation rules now', fn: () => handleEscalate(post) },
                      { label: post.saved_at ? 'unsave' : 'save', sub: 'pin to saved view', fn: () => handleSave(post) },
                      { label: 'give feedback', sub: 'teach spill what matters to you', fn: () => { setFeedbackPostId(post.id); setExpandedPostId(post.id) } },
                      { label: 'assign', sub: 'invite team from settings', fn: () => addToast({ message: 'assign coming soon', sub: 'invite your team from settings to enable' }) },
                    ]}
                  />
                </div>

                {/* Expanded panel — reasoning, notes, feedback */}
                {isExpanded && (
                  <div style={{
                    padding: '10px 24px 12px',
                    background: '#0d0f1a',
                    borderTop: '1px solid #1e2535',
                    animation: 'fadeIn 0.15s ease both',
                  }}>
                    {post.reasoning && (
                      <div style={{ marginBottom: post.response_template ? 10 : 0 }}>
                        <div style={{ fontSize: 10, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>
                          ai reasoning
                        </div>
                        <div style={{ fontSize: 12.5, color: '#64748b', lineHeight: 1.6 }}>
                          {post.reasoning}
                        </div>
                      </div>
                    )}
                    {post.response_template && (
                      <div>
                        <div style={{ fontSize: 10, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>
                          suggested response
                        </div>
                        <div style={{
                          fontSize: 12.5, color: '#94a3b8', lineHeight: 1.6,
                          padding: '8px 12px',
                          background: 'rgba(59,130,246,0.04)',
                          border: '1px solid rgba(59,130,246,0.15)',
                          borderRadius: 6,
                          fontStyle: 'italic',
                        }}>
                          {post.response_template}
                        </div>
                        <button
                          onClick={() => navigator.clipboard.writeText(post.response_template).catch(() => {})}
                          style={{
                            marginTop: 8, fontSize: 11, padding: '3px 10px',
                            background: 'transparent', color: '#475569',
                            border: '1px solid #1e2535', borderRadius: 5,
                            cursor: 'pointer', fontFamily: 'inherit',
                            transition: 'all 0.12s',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.borderColor = '#243047' }}
                          onMouseLeave={e => { e.currentTarget.style.color = '#475569'; e.currentTarget.style.borderColor = '#1e2535' }}
                        >
                          copy
                        </button>
                      </div>
                    )}
                    <NoteEditor slug={slug} post={post} onSave={(notes) => setPosts(prev => prev.map(p => p.id === post.id ? { ...p, notes } : p))} />
                    {feedbackPostId === post.id ? (
                      <FeedbackPanel
                        post={post}
                        slug={slug}
                        categories={categories}
                        onClose={() => setFeedbackPostId(null)}
                        onCategoryChange={(catId) => {
                          const cat = categories.find(c => c.id === catId)
                          setPosts(p => p.map(x => x.id === post.id ? { ...x, category_id: catId || null, category_name: cat?.name || null, category_color: cat?.color || null } : x))
                        }}
                        onFeedbackSubmit={(label) => handleFeedbackSubmit(post.id, label)}
                      />
                    ) : (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #1e2535' }}>
                        <button
                          onClick={() => setFeedbackPostId(post.id)}
                          style={{
                            fontSize: 11, color: '#334155', background: 'none',
                            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                            padding: 0, transition: 'color 0.12s',
                          }}
                          onMouseEnter={e => e.currentTarget.style.color = '#64748b'}
                          onMouseLeave={e => e.currentTarget.style.color = '#334155'}
                        >
                          give feedback — teach spill what matters
                        </button>
                      </div>
                    )}
                  </div>
                )}
                </div>
              )
            })}
          </div>
        )}

        {/* Pagination */}
        {!loading && pages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 24px' }}>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              style={{
                fontSize: 12,
                color: '#64748b',
                background: 'transparent',
                border: '1px solid #1e2535',
                borderRadius: 8,
                padding: '5px 14px',
                cursor: page === 1 ? 'not-allowed' : 'pointer',
                opacity: page === 1 ? 0.4 : 1,
                fontFamily: 'inherit',
                transition: 'all 0.12s',
              }}
            >
              prev
            </button>
            <span style={{ fontSize: 11.5, color: '#334155', fontFamily: 'var(--font-mono)' }}>
              {page} / {pages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(pages, p + 1))}
              disabled={page === pages}
              style={{
                fontSize: 12,
                color: '#64748b',
                background: 'transparent',
                border: '1px solid #1e2535',
                borderRadius: 8,
                padding: '5px 14px',
                cursor: page === pages ? 'not-allowed' : 'pointer',
                opacity: page === pages ? 0.4 : 1,
                fontFamily: 'inherit',
                transition: 'all 0.12s',
              }}
            >
              next
            </button>
          </div>
        )}
      </div>

      {/* Toast notifications */}
      {toasts.length > 0 && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
          {toasts.map(t => (
            <div key={t.id} style={{ background: '#13161f', border: '1px solid #1e2535', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, minWidth: 260, maxWidth: 360, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', animation: 'fadeIn 0.15s ease both', pointerEvents: 'auto' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: '#e2e8f0' }}>{t.message}</div>
                {t.sub && <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>{t.sub}</div>}
              </div>
              {t.undoFn && (
                <button
                  onClick={() => { t.undoFn(); dismissToast(t.id) }}
                  style={{ fontSize: 11, color: '#3b82f6', background: 'none', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 5, cursor: 'pointer', padding: '2px 8px', fontFamily: 'inherit', flexShrink: 0, transition: 'all 0.12s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.1)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
                >
                  undo
                </button>
              )}
              <button
                onClick={() => dismissToast(t.id)}
                style={{ fontSize: 12, color: '#334155', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', lineHeight: 1, flexShrink: 0, transition: 'color 0.12s' }}
                onMouseEnter={e => e.currentTarget.style.color = '#64748b'}
                onMouseLeave={e => e.currentTarget.style.color = '#334155'}
              >✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
