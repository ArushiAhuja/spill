'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import OrgNav from '@/components/OrgNav'
import { api } from '@/lib/api'
import { getUser } from '@/lib/auth'

function fmtTime(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

function fmtDuration(loginAt, logoutAt, breakMin) {
  if (!loginAt) return '—'
  const end = logoutAt ? new Date(logoutAt) : new Date()
  const totalMin = Math.floor((end - new Date(loginAt)) / 60000) - (breakMin || 0)
  if (totalMin < 0) return '0m'
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export default function TimesheetPage() {
  const { org: slug } = useParams()
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [activeSession, setActiveSession] = useState(null)
  const [saving, setSaving] = useState(false)
  const [breakInput, setBreakInput] = useState('')
  const currentUser = getUser()

  async function load() {
    setLoading(true)
    try {
      const data = await api.mmtGetSessions(slug, selectedDate)
      setSessions(data.sessions || [])
      const mine = (data.sessions || []).find(s => s.user_id === currentUser?.id && !s.logout_at)
      setActiveSession(mine || null)
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [slug, selectedDate])

  async function clockIn() {
    setSaving(true)
    try {
      await api.mmtPostSession(slug, { action: 'login' })
      load()
    } catch (e) { alert(e.message) } finally { setSaving(false) }
  }

  async function clockOut() {
    setSaving(true)
    try {
      await api.mmtPostSession(slug, { action: 'logout' })
      setActiveSession(null)
      load()
    } catch (e) { alert(e.message) } finally { setSaving(false) }
  }

  async function logBreak() {
    const mins = parseInt(breakInput)
    if (!mins || mins < 0) return
    setSaving(true)
    try {
      await api.mmtPostSession(slug, { action: 'break', break_minutes: mins })
      setBreakInput('')
      load()
    } catch (e) { alert(e.message) } finally { setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0d0f1a' }}>
      <OrgNav slug={slug} />
      <main style={{ marginLeft: 208, flex: 1, padding: '28px 32px', overflowY: 'auto' }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 18, fontWeight: 500, color: '#e2e8f0', margin: '0 0 4px' }}>Agent Timesheet</h1>
          <p style={{ fontSize: 12, color: '#475569', margin: 0 }}>Daily login/logout tracking and productivity</p>
        </div>

        {/* Date picker + clock in/out */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24, flexWrap: 'wrap' }}>
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            style={{ background: '#191d2b', border: '1px solid #1e2535', borderRadius: 6, color: '#e2e8f0', fontSize: 13, padding: '6px 10px', fontFamily: 'inherit' }}
          />
          {!activeSession ? (
            <button onClick={clockIn} disabled={saving} style={btn('#22c55e', '#fff')}>
              {saving ? 'clocking in...' : '▶ Clock In'}
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#22c55e' }}>● Active since {fmtTime(activeSession.login_at)}</span>
              <input
                value={breakInput}
                onChange={e => setBreakInput(e.target.value)}
                placeholder="break mins"
                style={{ background: '#191d2b', border: '1px solid #1e2535', borderRadius: 6, color: '#e2e8f0', fontSize: 12, padding: '5px 8px', width: 90 }}
              />
              <button onClick={logBreak} disabled={saving || !breakInput} style={btn('#fbbf24', '#000')}>log break</button>
              <button onClick={clockOut} disabled={saving} style={btn('#f87171', '#fff')}>■ Clock Out</button>
            </div>
          )}
        </div>

        {/* Sessions table */}
        {loading ? (
          <div style={{ color: '#475569', fontSize: 13 }}>loading...</div>
        ) : sessions.length === 0 ? (
          <div style={{ color: '#475569', fontSize: 13 }}>No sessions for this date.</div>
        ) : (
          <div style={{ background: '#12151e', border: '1px solid #1e2535', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1e2535' }}>
                  {['Agent', 'Login', 'Logout', 'Break', 'Productive Hours', 'Tickets Worked'].map(h => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: '#475569', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessions.map(s => (
                  <tr key={s.id} style={{ borderBottom: '1px solid #1a1f2e' }}>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#e2e8f0' }}>
                      {s.user_name || s.user_email}
                      {!s.logout_at && <span style={{ marginLeft: 6, fontSize: 10, color: '#22c55e' }}>● live</span>}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#94a3b8', fontFamily: 'monospace' }}>{fmtTime(s.login_at)}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#94a3b8', fontFamily: 'monospace' }}>{fmtTime(s.logout_at)}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#94a3b8' }}>{s.break_minutes || 0}m</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#60a5fa', fontWeight: 500 }}>{fmtDuration(s.login_at, s.logout_at, s.break_minutes)}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#94a3b8' }}>{s.tickets_count || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}

function btn(bg, color) {
  return {
    padding: '7px 16px',
    background: bg,
    color,
    border: 'none',
    borderRadius: 6,
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontWeight: 500,
  }
}
