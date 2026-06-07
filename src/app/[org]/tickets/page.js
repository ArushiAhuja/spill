'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import OrgNav from '@/components/OrgNav'
import { api } from '@/lib/api'
import { getUser } from '@/lib/auth'

const STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New', color: '#f87171' },
  { key: 'open', label: 'Open', color: '#60a5fa' },
  { key: 'pending', label: 'Pending', color: '#fbbf24' },
  { key: 'woc', label: 'WOC', color: '#a78bfa' },
  { key: 'awaiting', label: 'Awaiting', color: '#fb923c' },
  { key: 'closed', label: 'Closed', color: '#4ade80' },
]

const CHANNEL_LABELS = {
  twitter: { label: 'Twitter/X', color: '#60a5fa', short: 'TW' },
  facebook: { label: 'Facebook', color: '#818cf8', short: 'FB' },
  instagram: { label: 'Instagram', color: '#f472b6', short: 'IG' },
  linkedin: { label: 'LinkedIn', color: '#38bdf8', short: 'LI' },
  playstore: { label: 'Play Store', color: '#4ade80', short: 'PS' },
  appstore: { label: 'App Store', color: '#a3e635', short: 'AS' },
  manual: { label: 'Manual', color: '#94a3b8', short: 'MN' },
}

const PRIORITY_LABELS = {
  urgent: { label: 'urgent', color: '#f87171' },
  high: { label: 'high', color: '#fbbf24' },
  normal: { label: 'normal', color: '#64748b' },
  low: { label: 'low', color: '#475569' },
}

const PERSONALITIES = ['professional', 'friendly', 'apologetic', 'assertive']

function timeAgo(ts) {
  if (!ts) return ''
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

function slaStatus(ticket) {
  if (ticket.status === 'closed') return null
  const deadline = ticket.first_responded_at ? ticket.sla_subsequent_at : ticket.sla_first_response_at
  if (!deadline) return null
  const diff = new Date(deadline).getTime() - Date.now()
  if (diff < 0) return { label: 'SLA breached', color: '#f87171', urgent: true }
  if (diff < 30 * 60 * 1000) return { label: `${Math.ceil(diff / 60000)}m left`, color: '#fbbf24', urgent: false }
  return null
}

function ChannelBadge({ channel }) {
  const ch = CHANNEL_LABELS[channel] || { label: channel, color: '#64748b', short: '??' }
  return (
    <span style={{
      fontSize: 10,
      fontWeight: 600,
      padding: '2px 6px',
      borderRadius: 4,
      background: ch.color + '22',
      color: ch.color,
      border: `1px solid ${ch.color}44`,
      fontFamily: 'var(--font-mono)',
      letterSpacing: '0.04em',
    }}>{ch.short}</span>
  )
}

function StatusBadge({ status }) {
  const tab = STATUS_TABS.find(t => t.key === status)
  const color = tab?.color || '#64748b'
  return (
    <span style={{
      fontSize: 10,
      padding: '2px 8px',
      borderRadius: 99,
      background: color + '22',
      color,
      border: `1px solid ${color}44`,
    }}>{status}</span>
  )
}

function PriorityDot({ priority }) {
  const p = PRIORITY_LABELS[priority] || PRIORITY_LABELS.normal
  return <span style={{ width: 7, height: 7, borderRadius: '50%', background: p.color, display: 'inline-block', flexShrink: 0 }} title={p.label} />
}

function CustomerLabelBadge({ label }) {
  const colors = {
    'Detractor': '#ef4444',
    'Imminent Detractor': '#f97316',
    'High Influencer': '#a855f7',
    'Verified': '#3b82f6',
  }
  const color = colors[label] || '#64748b'
  return (
    <span style={{
      fontSize: 9,
      fontWeight: 700,
      padding: '1px 6px',
      borderRadius: 4,
      background: color + '22',
      color,
      border: `1px solid ${color}44`,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
    }}>{label}</span>
  )
}

export default function TicketsPage() {
  const { org: slug } = useParams()
  const [tickets, setTickets] = useState([])
  const [statusCounts, setStatusCounts] = useState({})
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [statusTab, setStatusTab] = useState('new')
  const [selected, setSelected] = useState(new Set())
  const [selectedTicket, setSelectedTicket] = useState(null)
  const [ticketDetail, setTicketDetail] = useState(null)
  const [notes, setNotes] = useState([])
  const [noteBody, setNoteBody] = useState('')
  const [noteIsInternal, setNoteIsInternal] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [aiResponses, setAiResponses] = useState([])
  const [aiPersonality, setAiPersonality] = useState('professional')
  const [loadingAI, setLoadingAI] = useState(false)
  const [cannedResponses, setCannedResponses] = useState([])
  const [showCanned, setShowCanned] = useState(false)
  const [showNewTicket, setShowNewTicket] = useState(false)
  const [showBulk, setShowBulk] = useState(false)
  const [bulkAction, setBulkAction] = useState('status')
  const [bulkValue, setBulkValue] = useState('')
  const [bulkNote, setBulkNote] = useState('')
  const [forwardEmail, setForwardEmail] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [filterChannel, setFilterChannel] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [newTicket, setNewTicket] = useState({ title: '', channel: 'manual', priority: 'normal', author: '', body: '', url: '' })
  const [saving, setSaving] = useState(false)
  const [showNewCanned, setShowNewCanned] = useState(false)
  const [newCanned, setNewCanned] = useState({ name: '', body: '', category: '', brand_personality: 'professional' })
  const [org, setOrg] = useState(null)
  const [mmtEnabled, setMmtEnabled] = useState(false)
  const [translateLoading, setTranslateLoading] = useState(false)
  const [translatedText, setTranslatedText] = useState(null)
  const [filterAging, setFilterAging] = useState('')
  const [filterAwaiting, setFilterAwaiting] = useState(false)
  const currentUser = getUser()

  const loadTickets = useCallback(async () => {
    setLoading(true)
    try {
      const params = {}
      if (statusTab !== 'all') params.status = statusTab
      if (filterChannel) params.channel = filterChannel
      if (filterPriority) params.priority = filterPriority
      if (searchQuery) params.search = searchQuery
      if (filterAging) params.aging = filterAging
      if (filterAwaiting) params.awaiting_customer = 'true'
      const data = await api.getTickets(slug, params)
      setTickets(data.tickets || [])
      setStatusCounts(data.statusCounts || {})
      setTotal(data.total || 0)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [slug, statusTab, filterChannel, filterPriority, searchQuery, filterAging, filterAwaiting])

  useEffect(() => { loadTickets() }, [loadTickets])

  useEffect(() => {
    api.getCannedResponses(slug).then(d => setCannedResponses(d.cannedResponses || [])).catch(() => {})
    api.getOrg(slug).then(d => { setOrg(d); setMmtEnabled(d?.features?.mmt === true) }).catch(() => {})
  }, [slug])

  async function openTicket(ticket) {
    setSelectedTicket(ticket)
    setAiResponses([])
    setNoteBody('')
    setLoadingDetail(true)
    try {
      const data = await api.getTicket(slug, ticket.id)
      setTicketDetail(data.ticket)
      setNotes(data.notes || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingDetail(false)
    }
  }

  async function updateTicketStatus(id, status) {
    await api.updateTicket(slug, id, { status })
    loadTickets()
    if (ticketDetail?.id === id) {
      setTicketDetail(d => ({ ...d, status }))
      setSelectedTicket(t => t?.id === id ? { ...t, status } : t)
    }
  }

  async function submitNote() {
    if (!noteBody.trim() || !ticketDetail) return
    setSaving(true)
    try {
      const data = await api.addTicketNote(slug, ticketDetail.id, { body: noteBody.trim(), is_internal: noteIsInternal })
      setNotes(n => [...n, data.note])
      setNoteBody('')
    } catch (e) { console.error(e) } finally { setSaving(false) }
  }

  async function generateAIResponse() {
    if (!ticketDetail) return
    setLoadingAI(true)
    setAiResponses([])
    try {
      const data = await api.getAIResponse(slug, ticketDetail.id, { personality: aiPersonality, iterations: 3 })
      setAiResponses(data.responses || [])
    } catch (e) { console.error(e) } finally { setLoadingAI(false) }
  }

  async function forwardTicket() {
    if (!forwardEmail.trim() || !ticketDetail) return
    await api.updateTicket(slug, ticketDetail.id, { forward_to: forwardEmail.split(',').map(e => e.trim()) })
    setForwardEmail('')
    alert('Forwarded to CD Lead')
  }

  async function translateTicket() {
    if (!ticketDetail?.body) return
    setTranslateLoading(true)
    setTranslatedText(null)
    try {
      const data = await api.mmtTranslate(slug, { text: ticketDetail.body })
      setTranslatedText(data.translated)
    } catch (e) { console.error(e) } finally { setTranslateLoading(false) }
  }

  async function doBulkAction() {
    const ids = Array.from(selected)
    if (!ids.length) return
    setSaving(true)
    try {
      await api.bulkTickets(slug, {
        ids,
        action: bulkAction,
        value: bulkAction !== 'note' ? bulkValue : undefined,
        note_body: bulkAction === 'note' ? bulkNote : undefined,
      })
      setSelected(new Set())
      setShowBulk(false)
      setBulkValue('')
      setBulkNote('')
      loadTickets()
    } catch (e) { console.error(e) } finally { setSaving(false) }
  }

  async function createTicket() {
    if (!newTicket.title.trim()) return
    setSaving(true)
    try {
      const payload = { ...newTicket }
      if (mmtEnabled) {
        const bd = {}
        for (let n = 1; n <= 8; n++) {
          if (newTicket[`booking_id_${n}`]) bd[`booking_id_${n}`] = newTicket[`booking_id_${n}`]
        }
        payload.booking_details = bd
      }
      await api.createTicket(slug, payload)
      setShowNewTicket(false)
      setNewTicket({ title: '', channel: 'manual', priority: 'normal', author: '', body: '', url: '' })
      loadTickets()
    } catch (e) { console.error(e) } finally { setSaving(false) }
  }

  async function addCannedResponse() {
    if (!newCanned.name.trim() || !newCanned.body.trim()) return
    try {
      const data = await api.createCannedResponse(slug, newCanned)
      setCannedResponses(c => [...c, data.cannedResponse])
      setShowNewCanned(false)
      setNewCanned({ name: '', body: '', category: '', brand_personality: 'professional' })
    } catch (e) { console.error(e) }
  }

  function toggleSelect(id) {
    setSelected(s => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    if (selected.size === tickets.length) setSelected(new Set())
    else setSelected(new Set(tickets.map(t => t.id)))
  }

  const sla = ticketDetail ? slaStatus(ticketDetail) : null

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0d0f1a' }}>
      <OrgNav slug={slug} />
      <main style={{ marginLeft: 208, flex: 1, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '20px 28px 0', borderBottom: '1px solid #1e2535', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <h1 style={{ fontSize: 18, fontWeight: 500, color: '#e2e8f0', margin: 0 }}>Tickets</h1>
              <p style={{ fontSize: 12, color: '#475569', margin: '4px 0 0' }}>Social inbox · multi-channel</p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {selected.size > 0 && (
                <button onClick={() => setShowBulk(true)} style={btnStyle('#1e2535', '#94a3b8')}>
                  bulk actions ({selected.size})
                </button>
              )}
              <button onClick={() => setShowCanned(true)} style={btnStyle('#1e2535', '#94a3b8')}>canned responses</button>
              <button onClick={() => setShowNewTicket(true)} style={btnStyle('#3b82f6', '#fff')}>+ new ticket</button>
            </div>
          </div>

          {/* Status tabs */}
          <div style={{ display: 'flex', gap: 0 }}>
            {STATUS_TABS.map(tab => {
              const count = tab.key === 'all' ? total : (statusCounts[tab.key] || 0)
              const active = statusTab === tab.key
              return (
                <button
                  key={tab.key}
                  onClick={() => { setStatusTab(tab.key); setSelected(new Set()) }}
                  style={{
                    padding: '8px 16px',
                    background: 'none',
                    border: 'none',
                    borderBottom: active ? `2px solid ${tab.color || '#3b82f6'}` : '2px solid transparent',
                    color: active ? (tab.color || '#3b82f6') : '#475569',
                    fontSize: 13,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    transition: 'all 0.12s',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {tab.label}
                  {count > 0 && (
                    <span style={{
                      fontSize: 10,
                      padding: '1px 6px',
                      borderRadius: 99,
                      background: active ? (tab.color || '#3b82f6') + '22' : '#1e2535',
                      color: active ? (tab.color || '#3b82f6') : '#475569',
                    }}>{count}</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Filters */}
        <div style={{ padding: '10px 28px', borderBottom: '1px solid #1e2535', display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="search tickets..."
            style={inputStyle({ width: 200 })}
          />
          <select value={filterChannel} onChange={e => setFilterChannel(e.target.value)} style={selectStyle()}>
            <option value="">all channels</option>
            {Object.entries(CHANNEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} style={selectStyle()}>
            <option value="">all priorities</option>
            {Object.keys(PRIORITY_LABELS).map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          {mmtEnabled && (
            <>
              <select value={filterAging} onChange={e => setFilterAging(e.target.value)} style={selectStyle()}>
                <option value="">all ages</option>
                <option value="2d">older than 2 days</option>
                <option value="14d">older than 14 days</option>
              </select>
              <button
                onClick={() => setFilterAwaiting(a => !a)}
                style={{
                  ...btnStyle(filterAwaiting ? '#fb923c22' : '#1e2535', filterAwaiting ? '#fb923c' : '#64748b'),
                  border: `1px solid ${filterAwaiting ? '#fb923c44' : '#1e2535'}`,
                  fontSize: 12,
                }}
              >
                {filterAwaiting ? '⏳ awaiting' : 'awaiting'}
              </button>
            </>
          )}
        </div>

        {/* Body: list + detail */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* Ticket list */}
          <div style={{ width: selectedTicket ? 380 : '100%', borderRight: selectedTicket ? '1px solid #1e2535' : 'none', overflow: 'auto', flexShrink: 0 }}>
            {/* Select all */}
            <div style={{ padding: '8px 16px', borderBottom: '1px solid #1e2535', display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={selected.size > 0 && selected.size === tickets.length} onChange={selectAll} style={{ cursor: 'pointer' }} />
              <span style={{ fontSize: 11, color: '#475569' }}>{loading ? 'loading...' : `${tickets.length} tickets`}</span>
            </div>

            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#475569', fontSize: 13 }}>loading...</div>
            ) : tickets.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#475569', fontSize: 13 }}>no tickets</div>
            ) : (
              tickets.map(ticket => {
                const isSelected = selected.has(ticket.id)
                const isOpen = selectedTicket?.id === ticket.id
                const sl = slaStatus(ticket)
                return (
                  <div
                    key={ticket.id}
                    onClick={() => openTicket(ticket)}
                    style={{
                      padding: '12px 16px',
                      borderBottom: '1px solid #1a1f2e',
                      cursor: 'pointer',
                      background: isOpen ? '#1a1f30' : isSelected ? '#191d2b' : 'transparent',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = '#161927' }}
                    onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = isSelected ? '#191d2b' : 'transparent' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={e => { e.stopPropagation(); toggleSelect(ticket.id) }}
                        onClick={e => e.stopPropagation()}
                        style={{ cursor: 'pointer', flexShrink: 0 }}
                      />
                      <PriorityDot priority={ticket.priority} />
                      <ChannelBadge channel={ticket.channel || 'manual'} />
                      {sl && (
                        <span style={{ fontSize: 10, color: sl.color, fontFamily: 'var(--font-mono)' }}>{sl.label}</span>
                      )}
                      <span style={{ fontSize: 11, color: '#334155', marginLeft: 'auto', flexShrink: 0 }}>
                        {timeAgo(ticket.created_at)}
                      </span>
                    </div>
                    <div style={{ paddingLeft: 50, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500, lineHeight: 1.3 }}>
                        {ticket.title}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {ticket.author && (
                          <span style={{ fontSize: 11, color: '#64748b' }}>
                            {ticket.author}{ticket.author_handle ? ` · @${ticket.author_handle}` : ''}
                            {ticket.follower_count > 0 ? ` · ${(ticket.follower_count / 1000).toFixed(1)}K followers` : ''}
                          </span>
                        )}
                        <StatusBadge status={ticket.status} />
                        {ticket.assigned_user_name && (
                          <span style={{ fontSize: 11, color: '#475569' }}>→ {ticket.assigned_user_name}</span>
                        )}
                        {parseInt(ticket.note_count) > 0 && (
                          <span style={{ fontSize: 11, color: '#475569' }}>💬 {ticket.note_count}</span>
                        )}
                      </div>
                      {ticket.tags?.length > 0 && (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {ticket.tags.slice(0, 3).map(tag => (
                            <span key={tag} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: '#1e2535', color: '#64748b' }}>#{tag}</span>
                          ))}
                        </div>
                      )}
                      {mmtEnabled && ticket.customer_labels?.length > 0 && (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                          {ticket.customer_labels.map(lbl => <CustomerLabelBadge key={lbl} label={lbl} />)}
                        </div>
                      )}
                      {mmtEnabled && ticket.reopen_count > 0 && (
                        <span style={{ fontSize: 10, color: '#f97316' }}>↺ repeat customer</span>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Ticket detail panel */}
          {selectedTicket && (
            <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
              {loadingDetail ? (
                <div style={{ padding: 40, color: '#475569', fontSize: 13 }}>loading...</div>
              ) : ticketDetail ? (
                <>
                  {/* Detail header */}
                  <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #1e2535', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <ChannelBadge channel={ticketDetail.channel || 'manual'} />
                          <StatusBadge status={ticketDetail.status} />
                          <PriorityDot priority={ticketDetail.priority} />
                          {sla && <span style={{ fontSize: 11, color: sla.color, fontFamily: 'var(--font-mono)' }}>{sla.label}</span>}
                        </div>
                        <h2 style={{ fontSize: 15, fontWeight: 500, color: '#e2e8f0', margin: 0, lineHeight: 1.4 }}>{ticketDetail.title}</h2>
                        {ticketDetail.author && (
                          <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>
                            {ticketDetail.author}
                            {ticketDetail.author_handle ? ` · @${ticketDetail.author_handle}` : ''}
                            {ticketDetail.follower_count > 0 ? ` · ${ticketDetail.follower_count.toLocaleString()} followers` : ''}
                          </p>
                        )}
                        {ticketDetail.url && (
                          <a href={ticketDetail.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#3b82f6', textDecoration: 'none' }}>
                            view original post ↗
                          </a>
                        )}
                      </div>
                      <button onClick={() => { setSelectedTicket(null); setTicketDetail(null) }}
                        style={{ ...btnStyle('#1e2535', '#94a3b8'), padding: '4px 10px', fontSize: 12 }}>✕</button>
                    </div>

                    {/* Status actions */}
                    <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                      {STATUS_TABS.slice(1).map(s => (
                        <button
                          key={s.key}
                          onClick={() => updateTicketStatus(ticketDetail.id, s.key)}
                          style={{
                            ...btnStyle(ticketDetail.status === s.key ? s.color + '22' : '#1e2535', ticketDetail.status === s.key ? s.color : '#64748b'),
                            border: `1px solid ${ticketDetail.status === s.key ? s.color + '44' : '#1e2535'}`,
                            padding: '4px 12px',
                            fontSize: 11,
                          }}
                        >{s.label}</button>
                      ))}
                    </div>

                    {mmtEnabled && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                        <button
                          onClick={() => api.updateTicket(slug, ticketDetail.id, { is_sticky: !ticketDetail.is_sticky }).then(() => {
                            setTicketDetail(d => ({ ...d, is_sticky: !d.is_sticky }))
                          })}
                          style={{
                            ...btnStyle(ticketDetail.is_sticky ? '#fbbf2422' : '#1e2535', ticketDetail.is_sticky ? '#fbbf24' : '#475569'),
                            border: `1px solid ${ticketDetail.is_sticky ? '#fbbf2444' : '#1e2535'}`,
                            padding: '3px 10px', fontSize: 11,
                          }}
                        >
                          {ticketDetail.is_sticky ? '📌 sticky' : '📌 pin'}
                        </button>
                        {ticketDetail.awaiting_customer && (
                          <span style={{ fontSize: 11, color: '#fb923c', fontWeight: 500 }}>⏳ awaiting agent response</span>
                        )}
                      </div>
                    )}

                    {/* Assigned */}
                    <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, color: '#475569' }}>assigned to:</span>
                      <span style={{ fontSize: 12, color: ticketDetail.assigned_user_name ? '#e2e8f0' : '#334155' }}>
                        {ticketDetail.assigned_user_name || 'unassigned'}
                      </span>
                      <span style={{ fontSize: 11, color: '#334155' }}>· {timeAgo(ticketDetail.created_at)}</span>
                    </div>

                    {/* Tags */}
                    {ticketDetail.tags?.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
                        {ticketDetail.tags.map(tag => (
                          <span key={tag} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: '#1e2535', color: '#64748b' }}>#{tag}</span>
                        ))}
                      </div>
                    )}

                    {/* MMT customer labels in detail */}
                    {mmtEnabled && ticketDetail.customer_labels?.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
                        {ticketDetail.customer_labels.map(lbl => <CustomerLabelBadge key={lbl} label={lbl} />)}
                      </div>
                    )}
                  </div>

                  {/* Body */}
                  {ticketDetail.body && (
                    <div style={{ padding: '16px 24px', borderBottom: '1px solid #1e2535', flexShrink: 0 }}>
                      <p style={{ fontSize: 13, color: '#94a3b8', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{ticketDetail.body}</p>
                    </div>
                  )}

                  {/* Notes thread */}
                  <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
                    <p style={{ fontSize: 11, color: '#475569', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Notes & Activity</p>

                    {notes.length === 0 ? (
                      <p style={{ fontSize: 12, color: '#334155' }}>no notes yet</p>
                    ) : (
                      notes.map(note => (
                        <div key={note.id} style={{
                          marginBottom: 12,
                          padding: '10px 14px',
                          borderRadius: 8,
                          background: note.is_internal ? '#191d2b' : '#1a1f30',
                          border: `1px solid ${note.is_internal ? '#1e2535' : '#2d3748'}`,
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontSize: 11, color: '#64748b' }}>
                              {note.author_name || 'agent'} · {note.is_internal ? '🔒 internal' : '📤 reply'}
                            </span>
                            <span style={{ fontSize: 11, color: '#334155' }}>{timeAgo(note.created_at)}</span>
                          </div>
                          <p style={{ fontSize: 13, color: '#cbd5e1', margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{note.body}</p>
                        </div>
                      ))
                    )}

                    {/* Add note */}
                    <div style={{ marginTop: 16 }}>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <button
                          onClick={() => setNoteIsInternal(true)}
                          style={btnStyle(noteIsInternal ? '#1e2535' : 'transparent', noteIsInternal ? '#94a3b8' : '#475569')}
                        >🔒 internal note</button>
                        <button
                          onClick={() => setNoteIsInternal(false)}
                          style={btnStyle(!noteIsInternal ? '#1e2535' : 'transparent', !noteIsInternal ? '#94a3b8' : '#475569')}
                        >📤 reply</button>
                        <button
                          onClick={() => setShowCanned(true)}
                          style={{ ...btnStyle('transparent', '#475569'), marginLeft: 'auto' }}
                        >canned ↗</button>
                      </div>
                      <textarea
                        value={noteBody}
                        onChange={e => setNoteBody(e.target.value)}
                        placeholder={noteIsInternal ? 'add internal note...' : 'write reply...'}
                        rows={3}
                        style={{ ...inputStyle({ width: '100%', resize: 'vertical' }), fontFamily: 'inherit' }}
                      />
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button onClick={submitNote} disabled={saving || !noteBody.trim()} style={btnStyle('#3b82f6', '#fff')}>
                          {saving ? 'saving...' : noteIsInternal ? 'add note' : 'send reply'}
                        </button>
                      </div>
                    </div>

                    {/* Forward to CD Lead */}
                    <div style={{ marginTop: 20, padding: '12px 14px', borderRadius: 8, background: '#191d2b', border: '1px solid #1e2535' }}>
                      <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Forward to CD Lead</p>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          value={forwardEmail}
                          onChange={e => setForwardEmail(e.target.value)}
                          placeholder="email@example.com, email2@example.com"
                          style={inputStyle({ flex: 1 })}
                        />
                        <button onClick={forwardTicket} style={btnStyle('#1e2535', '#94a3b8')}>forward</button>
                      </div>
                    </div>

                    {/* MMT translation */}
                    {mmtEnabled && ticketDetail.body && (
                      <div style={{ marginTop: 20, padding: '12px 14px', borderRadius: 8, background: '#191d2b', border: '1px solid #1e2535' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                          <p style={{ fontSize: 11, color: '#64748b', margin: 0, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Translate</p>
                          <button onClick={translateTicket} disabled={translateLoading} style={{ ...btnStyle('#1e2535', '#94a3b8'), fontSize: 11, padding: '3px 10px' }}>
                            {translateLoading ? 'translating...' : '🌐 to English'}
                          </button>
                        </div>
                        {translatedText && (
                          <p style={{ fontSize: 13, color: '#94a3b8', margin: 0, lineHeight: 1.6, fontStyle: 'italic' }}>{translatedText}</p>
                        )}
                      </div>
                    )}

                    {/* AI Response generator */}
                    <div style={{ marginTop: 20, padding: '14px', borderRadius: 8, background: '#191d2b', border: '1px solid #1e2535' }}>
                      <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>AI Response Generator</p>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                        {PERSONALITIES.map(p => (
                          <button
                            key={p}
                            onClick={() => setAiPersonality(p)}
                            style={btnStyle(aiPersonality === p ? '#3b82f622' : 'transparent', aiPersonality === p ? '#3b82f6' : '#475569')}
                          >{p}</button>
                        ))}
                      </div>
                      <button onClick={generateAIResponse} disabled={loadingAI} style={btnStyle('#3b82f6', '#fff')}>
                        {loadingAI ? 'generating...' : 'generate responses'}
                      </button>
                      {aiResponses.length > 0 && (
                        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {aiResponses.map((r, i) => (
                            <div key={i} style={{ padding: '10px 12px', borderRadius: 6, background: '#12151e', border: '1px solid #1e2535' }}>
                              <p style={{ fontSize: 13, color: '#cbd5e1', margin: '0 0 8px', lineHeight: 1.5 }}>{r}</p>
                              <button
                                onClick={() => { setNoteBody(r); setNoteIsInternal(false) }}
                                style={{ ...btnStyle('#1e2535', '#64748b'), fontSize: 11, padding: '3px 10px' }}
                              >use this</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      </main>

      {/* New ticket modal */}
      {showNewTicket && (
        <Modal title="New Ticket" onClose={() => setShowNewTicket(false)}>
          <label style={labelStyle}>Title *</label>
          <input value={newTicket.title} onChange={e => setNewTicket(t => ({ ...t, title: e.target.value }))} style={inputStyle({ width: '100%' })} placeholder="issue or complaint summary" />

          <label style={labelStyle}>Channel</label>
          <select value={newTicket.channel} onChange={e => setNewTicket(t => ({ ...t, channel: e.target.value }))} style={selectStyle({ width: '100%' })}>
            {Object.entries(CHANNEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>

          <label style={labelStyle}>Priority</label>
          <select value={newTicket.priority} onChange={e => setNewTicket(t => ({ ...t, priority: e.target.value }))} style={selectStyle({ width: '100%' })}>
            {Object.keys(PRIORITY_LABELS).map(k => <option key={k} value={k}>{k}</option>)}
          </select>

          <label style={labelStyle}>Author name</label>
          <input value={newTicket.author} onChange={e => setNewTicket(t => ({ ...t, author: e.target.value }))} style={inputStyle({ width: '100%' })} placeholder="customer name" />

          <label style={labelStyle}>Content</label>
          <textarea value={newTicket.body} onChange={e => setNewTicket(t => ({ ...t, body: e.target.value }))} rows={3} style={{ ...inputStyle({ width: '100%' }), resize: 'vertical' }} placeholder="original post or complaint content" />

          <label style={labelStyle}>URL</label>
          <input value={newTicket.url} onChange={e => setNewTicket(t => ({ ...t, url: e.target.value }))} style={inputStyle({ width: '100%' })} placeholder="link to original post" />

          {mmtEnabled && (
            <>
              <label style={labelStyle}>Booking IDs (MMT)</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[1,2,3,4,5,6,7,8].map(n => (
                  <input
                    key={n}
                    value={newTicket[`booking_id_${n}`] || ''}
                    onChange={e => setNewTicket(t => ({ ...t, [`booking_id_${n}`]: e.target.value }))}
                    style={inputStyle({ width: '100%' })}
                    placeholder={`Booking ID ${n}`}
                  />
                ))}
              </div>
            </>
          )}

          <button onClick={createTicket} disabled={saving} style={{ ...btnStyle('#3b82f6', '#fff'), marginTop: 16, width: '100%' }}>
            {saving ? 'creating...' : 'create ticket'}
          </button>
        </Modal>
      )}

      {/* Bulk actions modal */}
      {showBulk && selected.size > 0 && (
        <Modal title={`Bulk actions (${selected.size} tickets)`} onClose={() => setShowBulk(false)}>
          <label style={labelStyle}>Action</label>
          <select value={bulkAction} onChange={e => setBulkAction(e.target.value)} style={selectStyle({ width: '100%' })}>
            <option value="status">change status</option>
            <option value="assign">assign to (user ID)</option>
            <option value="tag">add tag</option>
            <option value="note">add internal note</option>
          </select>

          {bulkAction === 'status' && (
            <>
              <label style={labelStyle}>New status</label>
              <select value={bulkValue} onChange={e => setBulkValue(e.target.value)} style={selectStyle({ width: '100%' })}>
                <option value="">select...</option>
                {STATUS_TABS.slice(1).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </>
          )}
          {bulkAction === 'assign' && (
            <>
              <label style={labelStyle}>User email / ID</label>
              <input value={bulkValue} onChange={e => setBulkValue(e.target.value)} style={inputStyle({ width: '100%' })} placeholder="user id or clear" />
            </>
          )}
          {bulkAction === 'tag' && (
            <>
              <label style={labelStyle}>Tag</label>
              <input value={bulkValue} onChange={e => setBulkValue(e.target.value)} style={inputStyle({ width: '100%' })} placeholder="tag name" />
            </>
          )}
          {bulkAction === 'note' && (
            <>
              <label style={labelStyle}>Note</label>
              <textarea value={bulkNote} onChange={e => setBulkNote(e.target.value)} rows={3} style={{ ...inputStyle({ width: '100%' }), resize: 'vertical' }} />
            </>
          )}

          <button onClick={doBulkAction} disabled={saving} style={{ ...btnStyle('#3b82f6', '#fff'), marginTop: 16, width: '100%' }}>
            {saving ? 'applying...' : 'apply'}
          </button>
        </Modal>
      )}

      {/* Canned responses modal */}
      {showCanned && (
        <Modal title="Canned Responses" onClose={() => setShowCanned(false)} wide>
          <button onClick={() => setShowNewCanned(s => !s)} style={{ ...btnStyle('#1e2535', '#94a3b8'), marginBottom: 12 }}>
            {showNewCanned ? '− cancel' : '+ new canned response'}
          </button>

          {showNewCanned && (
            <div style={{ padding: '12px 14px', borderRadius: 8, background: '#12151e', border: '1px solid #1e2535', marginBottom: 16 }}>
              <input value={newCanned.name} onChange={e => setNewCanned(c => ({ ...c, name: e.target.value }))} style={inputStyle({ width: '100%', marginBottom: 8 })} placeholder="response name" />
              <select value={newCanned.brand_personality} onChange={e => setNewCanned(c => ({ ...c, brand_personality: e.target.value }))} style={selectStyle({ width: '100%', marginBottom: 8 })}>
                {PERSONALITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <input value={newCanned.category} onChange={e => setNewCanned(c => ({ ...c, category: e.target.value }))} style={inputStyle({ width: '100%', marginBottom: 8 })} placeholder="category (optional)" />
              <textarea value={newCanned.body} onChange={e => setNewCanned(c => ({ ...c, body: e.target.value }))} rows={3} style={{ ...inputStyle({ width: '100%' }), resize: 'vertical', marginBottom: 8 }} placeholder="response text..." />
              <button onClick={addCannedResponse} style={btnStyle('#3b82f6', '#fff')}>save</button>
            </div>
          )}

          {cannedResponses.length === 0 ? (
            <p style={{ fontSize: 13, color: '#475569' }}>no canned responses yet</p>
          ) : (
            cannedResponses.map(cr => (
              <div key={cr.id} style={{ padding: '12px 14px', borderRadius: 8, background: '#191d2b', border: '1px solid #1e2535', marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: '#e2e8f0' }}>{cr.name}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {cr.category && <span style={{ fontSize: 10, color: '#64748b' }}>{cr.category}</span>}
                    <span style={{ fontSize: 10, color: '#475569' }}>{cr.brand_personality}</span>
                  </div>
                </div>
                <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 8px', lineHeight: 1.5 }}>{cr.body}</p>
                <button
                  onClick={() => {
                    if (ticketDetail) { setNoteBody(cr.body); setNoteIsInternal(false) }
                    setShowCanned(false)
                  }}
                  style={{ ...btnStyle('#1e2535', '#64748b'), fontSize: 11, padding: '3px 10px' }}
                >use</button>
              </div>
            ))
          )}
        </Modal>
      )}
    </div>
  )
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }} onClick={onClose}>
      <div style={{
        background: '#12151e', border: '1px solid #1e2535', borderRadius: 12,
        padding: '24px', width: '100%', maxWidth: wide ? 600 : 460, maxHeight: '80vh',
        overflow: 'auto',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 500, color: '#e2e8f0' }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function btnStyle(bg, color) {
  return {
    padding: '6px 14px',
    background: bg,
    color,
    border: 'none',
    borderRadius: 6,
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'opacity 0.12s',
    whiteSpace: 'nowrap',
  }
}

function inputStyle(extra = {}) {
  return {
    background: '#191d2b',
    border: '1px solid #1e2535',
    borderRadius: 6,
    color: '#e2e8f0',
    fontSize: 13,
    padding: '6px 10px',
    fontFamily: 'inherit',
    outline: 'none',
    ...extra,
  }
}

function selectStyle(extra = {}) {
  return {
    ...inputStyle(),
    cursor: 'pointer',
    ...extra,
  }
}

const labelStyle = {
  display: 'block',
  fontSize: 11,
  color: '#64748b',
  marginBottom: 4,
  marginTop: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
}
