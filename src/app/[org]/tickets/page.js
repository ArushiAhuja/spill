'use client'
import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import OrgNav from '@/components/OrgNav'
import { api } from '@/lib/api'
import { getUser } from '@/lib/auth'
import { theme as T } from '@/lib/theme'

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
  manual: { label: 'Manual', color: '#a8b4c8', short: 'MN' },
}

const PRIORITY_LABELS = {
  urgent: { label: 'urgent', color: '#f87171' },
  high: { label: 'high', color: '#fbbf24' },
  normal: { label: 'normal', color: '#a8b4c8' },
  low: { label: 'low', color: '#7c8ba1' },
}

const PERSONALITIES = ['professional', 'friendly', 'apologetic', 'assertive']
const LOB_OPTIONS = ['Air', 'Hotel', 'Bus', 'Cabs', 'Holidays', 'Payments', 'Other']
const SMART_QUEUES = [
  { key: 'all', label: 'All work' },
  { key: 'unanswered_48h', label: 'Unanswered > 48 hours', color: '#fb7185' },
  { key: 'sla_breached', label: 'SLA breached', color: '#f87171' },
  { key: 'expedited', label: 'Expedited escalations', color: '#fbbf24' },
  { key: 'pending_customer', label: 'Pending customer action', color: '#60a5fa' },
  { key: 'unassigned', label: 'Unassigned', color: '#c084fc' },
]

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
  const ch = CHANNEL_LABELS[channel] || { label: channel, color: '#a8b4c8', short: '??' }
  return (
    <span style={{
      fontSize: 12,
      fontWeight: 600,
      padding: '3px 8px',
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
  const color = tab?.color || '#a8b4c8'
  return (
    <span style={{
      fontSize: 12,
      padding: '3px 10px',
      borderRadius: 99,
      background: color + '22',
      color,
      border: `1px solid ${color}44`,
    }}>{status}</span>
  )
}

function PriorityDot({ priority }) {
  const p = PRIORITY_LABELS[priority] || PRIORITY_LABELS.normal
  return <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, display: 'inline-block', flexShrink: 0 }} title={p.label} />
}

function AgentChip({ name }) {
  const assigned = Boolean(name)
  return (
    <span style={{
      fontSize: 12,
      fontWeight: 600,
      padding: '3px 9px',
      borderRadius: 99,
      background: assigned ? 'rgba(96,165,250,0.16)' : 'rgba(168,180,200,0.12)',
      color: assigned ? '#93c5fd' : T.muted,
      border: `1px solid ${assigned ? 'rgba(96,165,250,0.35)' : T.borderSoft}`,
    }}>
      Agent · {name || 'Unassigned'}
    </span>
  )
}

function CustomerLabelBadge({ label }) {
  const colors = {
    'Detractor': '#ef4444',
    'Imminent Detractor': '#f97316',
    'High Influencer': '#a855f7',
    'Verified': '#3b82f6',
  }
  const color = colors[label] || '#a8b4c8'
  return (
    <span style={{
      fontSize: 11,
      fontWeight: 700,
      padding: '2px 7px',
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
  const [smartQueue, setSmartQueue] = useState('all')
  const [queueCounts, setQueueCounts] = useState({})
  const [members, setMembers] = useState([])
  const [toolsOpen, setToolsOpen] = useState(false)
  const [listCollapsed, setListCollapsed] = useState(false)
  const [metadataDraft, setMetadataDraft] = useState({ lob: '', booking_id: '', contact_email: '', contact_phone: '', use_case: '' })
  const [tagDraft, setTagDraft] = useState('')
  const [exporting, setExporting] = useState(false)
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
      if (smartQueue !== 'all') params.queue = smartQueue
      const data = await api.getTickets(slug, params)
      setTickets(data.tickets || [])
      setStatusCounts(data.statusCounts || {})
      setTotal(data.total || 0)
      setQueueCounts(data.queueCounts || {})
      setMembers(data.members || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [slug, statusTab, filterChannel, filterPriority, searchQuery, filterAging, filterAwaiting, smartQueue])

  useEffect(() => { loadTickets() }, [loadTickets])

  useEffect(() => {
    api.getCannedResponses(slug).then(d => setCannedResponses(d.cannedResponses || [])).catch(() => {})
    api.getOrg(slug).then(d => { setOrg(d); setMmtEnabled(d?.features?.mmt === true) }).catch(() => {})
  }, [slug])

  async function openTicket(ticket) {
    setSelectedTicket(ticket)
    setAiResponses([])
    setNoteBody('')
    setTagDraft('')
    setListCollapsed(false)
    setLoadingDetail(true)
    try {
      const data = await api.getTicket(slug, ticket.id)
      setTicketDetail(data.ticket)
      setNotes(data.notes || [])
      const fields = data.ticket.custom_fields || {}
      setMetadataDraft({ lob: data.ticket.lob || '', booking_id: fields.booking_id || '', contact_email: fields.contact_email || '', contact_phone: fields.contact_phone || '', use_case: fields.use_case || '' })
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingDetail(false)
    }
  }

  async function saveTags(nextTags) {
    if (!ticketDetail) return
    const data = await api.updateTicket(slug, ticketDetail.id, { tags: nextTags })
    setTicketDetail(current => ({ ...current, ...data.ticket }))
    setSelectedTicket(current => current?.id === data.ticket.id ? { ...current, ...data.ticket } : current)
    loadTickets()
  }

  async function addTag() {
    const tag = tagDraft.trim().replace(/^#/, '')
    if (!tag || !ticketDetail) return
    const existing = ticketDetail.tags || []
    if (existing.includes(tag)) { setTagDraft(''); return }
    await saveTags([...existing, tag])
    setTagDraft('')
  }

  async function updateTicketStatus(id, status) {
    await api.updateTicket(slug, id, { status })
    loadTickets()
    if (ticketDetail?.id === id) {
      setTicketDetail(d => ({ ...d, status }))
      setSelectedTicket(t => t?.id === id ? { ...t, status } : t)
    }
  }

  async function updateAssignee(assignedTo) {
    if (!ticketDetail) return
    const member = members.find(item => item.id === assignedTo)
    const data = await api.updateTicket(slug, ticketDetail.id, { assigned_to: assignedTo || null, assigned_name: member?.name || null })
    setTicketDetail(current => ({ ...current, ...data.ticket, assigned_user_name: member?.name || null }))
    setSelectedTicket(current => current?.id === data.ticket.id ? { ...current, ...data.ticket, assigned_user_name: member?.name || null } : current)
    loadTickets()
  }

  async function saveMetadata() {
    if (!ticketDetail) return
    setSaving(true)
    try {
      const custom_fields = Object.fromEntries(Object.entries(metadataDraft).filter(([key, value]) => key !== 'lob' && String(value || '').trim()).map(([key, value]) => [key, String(value).trim()]))
      const data = await api.updateTicket(slug, ticketDetail.id, { lob: metadataDraft.lob, custom_fields })
      setTicketDetail(current => ({ ...current, ...data.ticket }))
      setSelectedTicket(current => current?.id === data.ticket.id ? { ...current, ...data.ticket } : current)
      loadTickets()
    } finally { setSaving(false) }
  }

  async function downloadRawData() {
    setExporting(true)
    try {
      const blob = await api.exportTickets(slug)
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = href; link.download = `${slug}-spill-tickets.csv`; link.click()
      URL.revokeObjectURL(href)
    } catch (e) { console.error(e) } finally { setExporting(false) }
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
      const payload = { ...newTicket, custom_fields: newTicket.booking_id ? { booking_id: newTicket.booking_id } : {} }
      delete payload.booking_id
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
    <div style={{ display: 'flex', minHeight: '100vh', background: T.bg }}>
      <OrgNav slug={slug} />
      <main style={{ marginLeft: 208, flex: 1, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: T.bg }}>

        {/* Header */}
        <div style={{ padding: '18px 24px 0', borderBottom: `1px solid ${T.borderSoft}`, flexShrink: 0, background: T.surface }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 650, color: T.text, margin: 0 }}>Tickets</h1>
              <p style={{ fontSize: 14, color: T.muted, margin: '4px 0 0' }}>Priority-first social inbox · multi-channel</p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {selected.size > 0 && (
                <button onClick={() => setShowBulk(true)} style={btnStyle(T.surfaceRaised, T.muted)}>
                  bulk actions ({selected.size})
                </button>
              )}
              <button onClick={() => setShowCanned(true)} style={btnStyle(T.surfaceRaised, T.muted)}>canned responses</button>
              <button onClick={downloadRawData} disabled={exporting} style={btnStyle(T.surfaceRaised, T.textSecondary)}>{exporting ? 'exporting…' : 'Download raw data'}</button>
              <button onClick={() => setShowNewTicket(true)} style={btnStyle(T.accent, '#fff')}>+ new ticket</button>
            </div>
          </div>

          {/* Smart queues first — SLA navigation */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '0 0 12px' }}>
            <span style={{ fontSize: 12, color: T.muted, alignSelf: 'center', fontWeight: 800, letterSpacing: '.06em' }}>PRIORITY QUEUES</span>
            {SMART_QUEUES.map(queue => {
              const active = smartQueue === queue.key
              const count = queue.key === 'all' ? total : (queueCounts[queue.key] || 0)
              const color = queue.color || T.textSecondary
              return <button key={queue.key} onClick={() => { setSmartQueue(queue.key); setStatusTab('all'); setSelected(new Set()) }} style={{ ...btnStyle(active ? `${color}22` : T.surfaceRaised, active ? color : T.textSecondary), border: `1px solid ${active ? `${color}66` : T.border}`, fontSize: 13, padding: '7px 12px' }}>{queue.label} <span style={{ fontFamily:'var(--font-mono)', marginLeft:4 }}>{count}</span></button>
            })}
          </div>

          {/* Status tabs */}
          <div style={{ display: 'flex', gap: 0, overflowX: 'auto' }}>
            {STATUS_TABS.map(tab => {
              const count = tab.key === 'all' ? total : (statusCounts[tab.key] || 0)
              const active = statusTab === tab.key
              return (
                <button
                  key={tab.key}
                  onClick={() => { setStatusTab(tab.key); setSmartQueue('all'); setSelected(new Set()) }}
                  style={{
                    padding: '10px 16px',
                    background: 'none',
                    border: 'none',
                    borderBottom: active ? `2px solid ${tab.color || T.accent}` : '2px solid transparent',
                    color: active ? (tab.color || T.accent) : T.muted,
                    fontSize: 14,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    transition: 'all 0.12s',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tab.label}
                  {count > 0 && (
                    <span style={{
                      fontSize: 12,
                      padding: '1px 7px',
                      borderRadius: 99,
                      background: active ? (tab.color || T.accent) + '22' : T.surfaceRaised,
                      color: active ? (tab.color || T.accent) : T.muted,
                    }}>{count}</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Filters */}
        <div style={{ padding: '10px 24px', borderBottom: `1px solid ${T.borderSoft}`, display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', background: T.surface }}>
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="search tickets..."
            style={inputStyle({ width: 220 })}
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
                  ...btnStyle(filterAwaiting ? '#fb923c22' : T.surfaceRaised, filterAwaiting ? '#fb923c' : T.muted),
                  border: `1px solid ${filterAwaiting ? '#fb923c44' : T.border}`,
                  fontSize: 13,
                }}
              >
                {filterAwaiting ? '⏳ awaiting' : 'awaiting'}
              </button>
            </>
          )}
        </div>

        {/* Body: compact list + conversation-first detail */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* Ticket list */}
          <div style={{ width: selectedTicket ? (listCollapsed ? 56 : 280) : '100%', borderRight: selectedTicket ? `1px solid ${T.border}` : 'none', overflow: 'auto', flexShrink: 0, background: T.surface, transition: 'width .15s ease' }}>
            <div style={{ padding: '8px 12px', borderBottom: `1px solid ${T.borderSoft}`, display: 'flex', alignItems: 'center', gap: 8 }}>
              {!listCollapsed && <>
                <input type="checkbox" checked={selected.size > 0 && selected.size === tickets.length} onChange={selectAll} style={{ cursor: 'pointer' }} />
                <span style={{ fontSize: 13, color: T.muted }}>{loading ? 'loading...' : `${tickets.length} tickets`}</span>
              </>}
              {selectedTicket && (
                <button onClick={() => setListCollapsed(v => !v)} style={{ ...btnStyle('transparent', T.muted), marginLeft: 'auto', padding: '4px 8px', fontSize: 12 }} title={listCollapsed ? 'Expand list' : 'Collapse list'}>
                  {listCollapsed ? '›' : '‹'}
                </button>
              )}
            </div>

            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: T.muted, fontSize: 14 }}>loading...</div>
            ) : tickets.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: T.muted, fontSize: 14 }}>no tickets</div>
            ) : listCollapsed ? (
              tickets.map(ticket => {
                const isOpen = selectedTicket?.id === ticket.id
                return (
                  <button key={ticket.id} onClick={() => openTicket(ticket)} title={ticket.title}
                    style={{ display:'block', width:'100%', padding:'12px 8px', border:'none', borderBottom:`1px solid ${T.borderSoft}`, background: isOpen ? T.surfaceRaised : 'transparent', cursor:'pointer' }}>
                    <PriorityDot priority={ticket.priority} />
                  </button>
                )
              })
            ) : (
              tickets.map(ticket => {
                const isSelected = selected.has(ticket.id)
                const isOpen = selectedTicket?.id === ticket.id
                const sl = slaStatus(ticket)
                const agentName = ticket.assigned_user_name || ticket.assigned_name
                return (
                  <div
                    key={ticket.id}
                    onClick={() => openTicket(ticket)}
                    style={{
                      padding: '14px 14px',
                      borderBottom: `1px solid ${T.borderSoft}`,
                      cursor: 'pointer',
                      background: isOpen ? T.surfaceRaised : isSelected ? T.surfaceHover : 'transparent',
                      transition: 'background 0.1s',
                      borderLeft: isOpen ? `3px solid ${T.accent}` : '3px solid transparent',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
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
                        <span style={{ fontSize: 12, color: sl.color, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{sl.label}</span>
                      )}
                      <span style={{ fontSize: 12, color: T.faint, marginLeft: 'auto', flexShrink: 0 }}>
                        {timeAgo(ticket.created_at)}
                      </span>
                    </div>
                    <div style={{ paddingLeft: 28, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ fontSize: 15, color: T.text, fontWeight: 600, lineHeight: 1.35 }}>
                        {ticket.title}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <AgentChip name={agentName} />
                        <StatusBadge status={ticket.status} />
                        {ticket.lob && <span style={{ fontSize: 11, fontWeight: 700, color:'#67e8f9', letterSpacing:'.04em' }}>{ticket.lob.toUpperCase()}</span>}
                      </div>
                      {ticket.author && (
                        <span style={{ fontSize: 13, color: T.muted }}>
                          {ticket.author}{ticket.author_handle ? ` · @${ticket.author_handle}` : ''}
                          {ticket.follower_count > 0 ? ` · ${(ticket.follower_count / 1000).toFixed(1)}K followers` : ''}
                        </span>
                      )}
                      {ticket.tags?.length > 0 && (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {ticket.tags.slice(0, 3).map(tag => (
                            <span key={tag} style={{ fontSize: 12, padding: '2px 7px', borderRadius: 4, background: T.surfaceHover, color: T.muted }}>#{tag}</span>
                          ))}
                        </div>
                      )}
                      {mmtEnabled && ticket.customer_labels?.length > 0 && (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {ticket.customer_labels.map(lbl => <CustomerLabelBadge key={lbl} label={lbl} />)}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Ticket detail — conversation occupies the center */}
          {selectedTicket && (
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', background: T.bg }}>
              {loadingDetail ? (
                <div style={{ padding: 40, color: T.muted, fontSize: 14 }}>loading...</div>
              ) : ticketDetail ? (
                <>
                  <div style={{ flex: 1, minWidth: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
                  {/* Compact header */}
                  <div style={{ padding: '16px 28px 12px', borderBottom: `1px solid ${T.borderSoft}`, flexShrink: 0, background: T.surface }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                          <ChannelBadge channel={ticketDetail.channel || 'manual'} />
                          <StatusBadge status={ticketDetail.status} />
                          <PriorityDot priority={ticketDetail.priority} />
                          <AgentChip name={ticketDetail.assigned_user_name || ticketDetail.assigned_name} />
                          {sla && <span style={{ fontSize: 13, color: sla.color, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{sla.label}</span>}
                        </div>
                        <h2 style={{ fontSize: 20, fontWeight: 650, color: T.text, margin: 0, lineHeight: 1.35 }}>{ticketDetail.title}</h2>
                        {ticketDetail.author && (
                          <p style={{ fontSize: 14, color: T.muted, margin: '6px 0 0' }}>
                            {ticketDetail.author}
                            {ticketDetail.author_handle ? ` · @${ticketDetail.author_handle}` : ''}
                            {ticketDetail.follower_count > 0 ? ` · ${ticketDetail.follower_count.toLocaleString()} followers` : ''}
                            <span style={{ color: T.faint }}> · {timeAgo(ticketDetail.created_at)}</span>
                          </p>
                        )}
                        {ticketDetail.url && (
                          <a href={ticketDetail.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#93c5fd', textDecoration: 'none' }}>
                            view original post ↗
                          </a>
                        )}
                      </div>
                      <button onClick={() => { setSelectedTicket(null); setTicketDetail(null) }}
                        style={{ ...btnStyle(T.surfaceRaised, T.muted), padding: '6px 12px', fontSize: 13 }}>✕</button>
                    </div>

                    <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                      {STATUS_TABS.slice(1).map(s => (
                        <button
                          key={s.key}
                          onClick={() => updateTicketStatus(ticketDetail.id, s.key)}
                          style={{
                            ...btnStyle(ticketDetail.status === s.key ? s.color + '22' : T.surfaceRaised, ticketDetail.status === s.key ? s.color : T.muted),
                            border: `1px solid ${ticketDetail.status === s.key ? s.color + '44' : T.border}`,
                            padding: '5px 12px',
                            fontSize: 13,
                          }}
                        >{s.label}</button>
                      ))}
                    </div>

                    {/* Inline metadata & tags — visible without opening tools */}
                    <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: T.surfaceRaised, border: `1px solid ${T.borderSoft}` }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
                        <div>
                          <label style={miniLabel}>Line of business</label>
                          <select value={metadataDraft.lob} onChange={e => setMetadataDraft(d => ({ ...d, lob: e.target.value }))} style={selectStyle({ width: '100%' })}>
                            <option value="">Unclassified</option>
                            {LOB_OPTIONS.map(lob => <option key={lob} value={lob}>{lob}</option>)}
                          </select>
                        </div>
                        <div>
                          <label style={miniLabel}>Booking ID</label>
                          <input value={metadataDraft.booking_id} onChange={e => setMetadataDraft(d => ({ ...d, booking_id: e.target.value }))} style={inputStyle({ width: '100%' })} placeholder="Booking / case ID" />
                        </div>
                        <div>
                          <label style={miniLabel}>Contact email</label>
                          <input value={metadataDraft.contact_email} onChange={e => setMetadataDraft(d => ({ ...d, contact_email: e.target.value }))} style={inputStyle({ width: '100%' })} placeholder="customer@email.com" />
                        </div>
                        <div>
                          <label style={miniLabel}>Contact phone</label>
                          <input value={metadataDraft.contact_phone} onChange={e => setMetadataDraft(d => ({ ...d, contact_phone: e.target.value }))} style={inputStyle({ width: '100%' })} placeholder="Phone" />
                        </div>
                        <div>
                          <label style={miniLabel}>Use case</label>
                          <input value={metadataDraft.use_case} onChange={e => setMetadataDraft(d => ({ ...d, use_case: e.target.value }))} style={inputStyle({ width: '100%' })} placeholder="refund, delay…" />
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <button onClick={saveMetadata} disabled={saving} style={btnStyle(T.accent, '#fff')}>{saving ? 'saving…' : 'Save metadata'}</button>
                        {(ticketDetail.tags || []).map(tag => (
                          <button key={tag} onClick={() => saveTags((ticketDetail.tags || []).filter(t => t !== tag))} style={{ fontSize: 13, padding: '4px 10px', borderRadius: 99, background: T.surfaceHover, color: T.textSecondary, border: `1px solid ${T.border}`, cursor: 'pointer' }}>#{tag} ×</button>
                        ))}
                        <input value={tagDraft} onChange={e => setTagDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }} placeholder="Add tag" style={inputStyle({ width: 140 })} />
                        <button onClick={addTag} style={btnStyle(T.surfaceHover, T.muted)}>tag</button>
                      </div>
                    </div>
                  </div>

                  {/* Conversation thread — primary reading surface */}
                  <div style={{ flex: 1, overflow: 'auto', padding: '20px 28px', background: T.bg }}>
                    <p style={{ fontSize: 12, color: T.muted, margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Conversation</p>

                    {ticketDetail.body && (
                      <div style={{
                        marginBottom: 16,
                        padding: '16px 18px',
                        borderRadius: 12,
                        background: T.surface,
                        border: `1px solid ${T.border}`,
                        maxWidth: 860,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ fontSize: 13, color: T.muted, fontWeight: 600 }}>Customer</span>
                          <span style={{ fontSize: 12, color: T.faint }}>{timeAgo(ticketDetail.created_at)}</span>
                        </div>
                        <p style={{ fontSize: 16, color: T.text, margin: 0, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{ticketDetail.body}</p>
                      </div>
                    )}

                    {notes.length === 0 && !ticketDetail.body ? (
                      <p style={{ fontSize: 14, color: T.muted }}>No conversation yet</p>
                    ) : (
                      notes.map(note => (
                        <div key={note.id} style={{
                          marginBottom: 14,
                          padding: '14px 18px',
                          borderRadius: 12,
                          background: note.is_internal ? T.surfaceRaised : T.surface,
                          border: `1px solid ${note.is_internal ? T.borderSoft : T.border}`,
                          maxWidth: 860,
                          marginLeft: note.is_internal ? 0 : 24,
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 13, color: T.textSecondary, fontWeight: 600 }}>
                              {note.author_name || 'Agent'} · {note.is_internal ? '🔒 internal' : '📤 reply'}
                            </span>
                            <span style={{ fontSize: 12, color: T.faint }}>{timeAgo(note.created_at)}</span>
                          </div>
                          <p style={{ fontSize: 15, color: T.text, margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{note.body}</p>
                        </div>
                      ))
                    )}

                    {/* Composer */}
                    <div style={{ marginTop: 20, maxWidth: 860, position: 'sticky', bottom: 0, background: T.bg, paddingBottom: 8 }}>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                        <button onClick={() => setNoteIsInternal(true)} style={btnStyle(noteIsInternal ? T.surfaceRaised : 'transparent', noteIsInternal ? T.textSecondary : T.faint)}>🔒 internal note</button>
                        <button onClick={() => setNoteIsInternal(false)} style={btnStyle(!noteIsInternal ? T.surfaceRaised : 'transparent', !noteIsInternal ? T.textSecondary : T.faint)}>📤 reply</button>
                        <button onClick={() => setShowCanned(true)} style={{ ...btnStyle('transparent', T.faint), marginLeft: 'auto' }}>canned ↗</button>
                      </div>
                      <textarea
                        value={noteBody}
                        onChange={e => setNoteBody(e.target.value)}
                        placeholder={noteIsInternal ? 'add internal note...' : 'write reply...'}
                        rows={4}
                        style={{ ...inputStyle({ width: '100%', resize: 'vertical', fontSize: 15 }), fontFamily: 'inherit' }}
                      />
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button onClick={submitNote} disabled={saving || !noteBody.trim()} style={btnStyle(T.accent, '#fff')}>
                          {saving ? 'saving...' : noteIsInternal ? 'add note' : 'send reply'}
                        </button>
                      </div>
                    </div>

                    {/* Secondary tools under conversation */}
                    <div style={{ marginTop: 28, maxWidth: 860, display: 'grid', gap: 12 }}>
                      <div style={{ padding: '12px 14px', borderRadius: 10, background: T.surface, border: `1px solid ${T.borderSoft}` }}>
                        <p style={{ fontSize: 12, color: T.muted, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Forward to CD Lead</p>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input value={forwardEmail} onChange={e => setForwardEmail(e.target.value)} placeholder="email@example.com" style={inputStyle({ flex: 1 })} />
                          <button onClick={forwardTicket} style={btnStyle(T.surfaceRaised, T.muted)}>forward</button>
                        </div>
                      </div>

                      {mmtEnabled && ticketDetail.body && (
                        <div style={{ padding: '12px 14px', borderRadius: 10, background: T.surface, border: `1px solid ${T.borderSoft}` }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                            <p style={{ fontSize: 12, color: T.muted, margin: 0, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Translate</p>
                            <button onClick={translateTicket} disabled={translateLoading} style={{ ...btnStyle(T.surfaceRaised, T.muted), fontSize: 12, padding: '4px 10px' }}>
                              {translateLoading ? 'translating...' : '🌐 to English'}
                            </button>
                          </div>
                          {translatedText && <p style={{ fontSize: 15, color: T.muted, margin: 0, lineHeight: 1.6, fontStyle: 'italic' }}>{translatedText}</p>}
                        </div>
                      )}

                      <div style={{ padding: 14, borderRadius: 10, background: T.surface, border: `1px solid ${T.borderSoft}` }}>
                        <p style={{ fontSize: 12, color: T.muted, margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>AI Response Generator</p>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                          {PERSONALITIES.map(p => (
                            <button key={p} onClick={() => setAiPersonality(p)} style={btnStyle(aiPersonality === p ? T.accentSoft : 'transparent', aiPersonality === p ? T.accent : T.faint)}>{p}</button>
                          ))}
                        </div>
                        <button onClick={generateAIResponse} disabled={loadingAI} style={btnStyle(T.accent, '#fff')}>
                          {loadingAI ? 'generating...' : 'generate responses'}
                        </button>
                        {aiResponses.length > 0 && (
                          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {aiResponses.map((r, i) => (
                              <div key={i} style={{ padding: '10px 12px', borderRadius: 8, background: T.bg, border: `1px solid ${T.borderSoft}` }}>
                                <p style={{ fontSize: 14, color: T.textSecondary, margin: '0 0 8px', lineHeight: 1.55 }}>{r}</p>
                                <button onClick={() => { setNoteBody(r); setNoteIsInternal(false) }} style={{ ...btnStyle(T.surfaceRaised, T.muted), fontSize: 12, padding: '4px 10px' }}>use this</button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  </div>

                  {/* Collapsible side tools */}
                  <aside style={{ width: toolsOpen ? 280 : 44, flexShrink: 0, overflow: 'auto', borderLeft: `1px solid ${T.border}`, background: T.surface, transition: 'width .15s ease' }}>
                    <button onClick={() => setToolsOpen(open => !open)} aria-expanded={toolsOpen} style={{ width:'100%', padding:'14px', background:'transparent', border:0, borderBottom:`1px solid ${T.borderSoft}`, color: T.text, textAlign: toolsOpen ? 'left' : 'center', fontSize:13, fontWeight:700 }}>
                      {toolsOpen ? 'Controls ›' : '‹'}
                    </button>
                    {toolsOpen && <div style={{ padding:14 }}>
                      <p style={panelLabel}>OWNER / AGENT</p>
                      <select value={ticketDetail.assigned_to || ''} onChange={e => updateAssignee(e.target.value)} style={{ ...selectStyle({ width:'100%' }), fontSize:14 }}>
                        <option value="">Unassigned</option>
                        {members.map(member => <option key={member.id} value={member.id}>{member.name || member.email}</option>)}
                      </select>
                      <p style={{ fontSize:14, color: T.textSecondary, margin:'10px 0 18px', fontWeight: 600 }}>
                        {ticketDetail.assigned_user_name || ticketDetail.assigned_name || 'Unassigned'}
                      </p>

                      <p style={panelLabel}>DATA ACCESS</p>
                      <p style={{fontSize:13,color:T.muted,lineHeight:1.5,margin:'0 0 8px'}}>CSV includes tags, LOB, booking/contact fields, owner and SLA. JSON works with Power BI / Tableau via bearer token.</p>
                      <button onClick={downloadRawData} disabled={exporting} style={{...btnStyle(T.surfaceRaised, T.textSecondary),width:'100%', marginBottom:8}}>{exporting ? 'exporting…' : 'Download CSV'}</button>
                      <code style={{display:'block',overflowWrap:'anywhere',fontSize:12,color:'#93c5fd',lineHeight:1.45}}>/api/orgs/{slug}/tickets/export?format=json</code>
                    </div>}
                  </aside>
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

          <label style={labelStyle}>Line of business</label>
          <select value={newTicket.lob || ''} onChange={e => setNewTicket(t => ({ ...t, lob: e.target.value }))} style={selectStyle({ width:'100%' })}><option value="">Unclassified</option>{LOB_OPTIONS.map(lob => <option key={lob} value={lob}>{lob}</option>)}</select>
          <label style={labelStyle}>Booking / case ID</label>
          <input value={newTicket.booking_id || ''} onChange={e => setNewTicket(t => ({ ...t, booking_id: e.target.value }))} style={inputStyle({ width:'100%' })} placeholder="Booking ID or customer reference" />

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
    padding: '7px 14px',
    background: bg,
    color,
    border: 'none',
    borderRadius: 6,
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'opacity 0.12s',
    whiteSpace: 'nowrap',
  }
}

function inputStyle(extra = {}) {
  return {
    background: T.surfaceRaised,
    border: `1px solid ${T.border}`,
    borderRadius: 6,
    color: T.text,
    fontSize: 14,
    padding: '8px 10px',
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
  fontSize: 12,
  color: T.muted,
  marginBottom: 4,
  marginTop: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
}
const panelLabel = { fontSize:11, color: T.muted, fontWeight:800, letterSpacing:'.1em', margin:'0 0 8px' }
const miniLabel = { display:'block', fontSize:12, color: T.muted, margin:'0 0 4px', fontWeight: 600 }
