'use client'
import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import OrgNav from '@/components/OrgNav'
import { api } from '@/lib/api'

function MetricCard({ label, value, sub, color = '#3b82f6' }) {
  return (
    <div style={{ background: '#12151e', border: '1px solid #1e2535', borderRadius: 10, padding: '18px 20px' }}>
      <div style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 600, color, fontFamily: 'monospace', marginBottom: 4 }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: 11, color: '#475569' }}>{sub}</div>}
    </div>
  )
}

export default function SupervisorPage() {
  const { org: slug } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(7)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api.mmtGetSupervisor(slug, days)
      setData(d)
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [slug, days])

  useEffect(() => { load() }, [load])

  const slaRate = data ? (100 - (data.slaBreachRate || 0) * 100).toFixed(1) : null

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0d0f1a' }}>
      <OrgNav slug={slug} />
      <main style={{ marginLeft: 208, flex: 1, padding: '28px 32px', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 500, color: '#e2e8f0', margin: '0 0 4px' }}>Supervisor Dashboard</h1>
            <p style={{ fontSize: 12, color: '#475569', margin: 0 }}>Team performance · real-time</p>
          </div>
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            style={{ background: '#191d2b', border: '1px solid #1e2535', borderRadius: 6, color: '#e2e8f0', fontSize: 13, padding: '6px 10px' }}
          >
            {[1, 7, 14, 30].map(d => <option key={d} value={d}>Last {d} {d === 1 ? 'day' : 'days'}</option>)}
          </select>
        </div>

        {loading ? (
          <div style={{ color: '#475569', fontSize: 13 }}>loading metrics...</div>
        ) : !data ? (
          <div style={{ color: '#475569', fontSize: 13 }}>failed to load</div>
        ) : (
          <>
            {/* Top metrics */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, marginBottom: 28 }}>
              <MetricCard label="Total Tickets" value={data.totalTickets} color="#60a5fa" />
              <MetricCard label="Open Tickets" value={data.openTickets} color="#fbbf24" />
              <MetricCard label="SLA Compliance" value={slaRate ? `${slaRate}%` : '—'} color={slaRate >= 90 ? '#4ade80' : '#f87171'} />
              <MetricCard label="Avg First Response" value={data.avgFirstResponseMinutes ? `${Math.round(data.avgFirstResponseMinutes)}m` : '—'} color="#a78bfa" sub="target: 60m" />
              <MetricCard label="High Influencers" value={data.highInfluencerTickets} color="#a855f7" />
              <MetricCard label="Detractors" value={data.detractorTickets} color="#ef4444" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 28 }}>
              {/* Volume by channel */}
              <div style={{ background: '#12151e', border: '1px solid #1e2535', borderRadius: 10, padding: '18px 20px' }}>
                <h3 style={{ fontSize: 13, fontWeight: 500, color: '#e2e8f0', margin: '0 0 14px' }}>Volume by Channel</h3>
                {Object.entries(data.volumeByChannel || {}).length === 0 ? (
                  <p style={{ fontSize: 12, color: '#475569' }}>No data</p>
                ) : (
                  Object.entries(data.volumeByChannel).sort((a,b) => b[1]-a[1]).map(([ch, count]) => {
                    const max = Math.max(...Object.values(data.volumeByChannel))
                    return (
                      <div key={ch} style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontSize: 12, color: '#94a3b8', textTransform: 'capitalize' }}>{ch}</span>
                          <span style={{ fontSize: 12, color: '#64748b', fontFamily: 'monospace' }}>{count}</span>
                        </div>
                        <div style={{ height: 4, background: '#1e2535', borderRadius: 2 }}>
                          <div style={{ height: 4, width: `${(count / max) * 100}%`, background: '#3b82f6', borderRadius: 2 }} />
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Status distribution */}
              <div style={{ background: '#12151e', border: '1px solid #1e2535', borderRadius: 10, padding: '18px 20px' }}>
                <h3 style={{ fontSize: 13, fontWeight: 500, color: '#e2e8f0', margin: '0 0 14px' }}>Status Distribution</h3>
                {Object.entries(data.statusDistribution || {}).length === 0 ? (
                  <p style={{ fontSize: 12, color: '#475569' }}>No data</p>
                ) : (
                  (() => {
                    const STATUS_COLORS = { new: '#f87171', open: '#60a5fa', pending: '#fbbf24', woc: '#a78bfa', awaiting: '#fb923c', closed: '#4ade80' }
                    const total = Object.values(data.statusDistribution).reduce((a,b) => a+Number(b), 0)
                    return Object.entries(data.statusDistribution).map(([st, count]) => (
                      <div key={st} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[st] || '#64748b', flexShrink: 0 }} />
                        <span style={{ fontSize: 12, color: '#94a3b8', flex: 1, textTransform: 'capitalize' }}>{st}</span>
                        <span style={{ fontSize: 12, color: '#64748b', fontFamily: 'monospace' }}>{count}</span>
                        <span style={{ fontSize: 11, color: '#334155' }}>({total > 0 ? ((count/total)*100).toFixed(0) : 0}%)</span>
                      </div>
                    ))
                  })()
                )}
              </div>
            </div>

            {/* Agent performance table */}
            <div style={{ background: '#12151e', border: '1px solid #1e2535', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e2535' }}>
                <h3 style={{ fontSize: 13, fontWeight: 500, color: '#e2e8f0', margin: 0 }}>Agent Performance</h3>
              </div>
              {!data.agentStats?.length ? (
                <div style={{ padding: '20px', color: '#475569', fontSize: 13 }}>No agent data for this period</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #1e2535' }}>
                      {['Agent', 'Assigned', 'Closed', 'Avg First Response', 'SLA Breaches'].map(h => (
                        <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: '#475569', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.agentStats.map(a => (
                      <tr key={a.user_id} style={{ borderBottom: '1px solid #1a1f2e' }}>
                        <td style={{ padding: '12px 16px', fontSize: 13, color: '#e2e8f0' }}>{a.user_name || 'Unknown'}</td>
                        <td style={{ padding: '12px 16px', fontSize: 13, color: '#94a3b8', fontFamily: 'monospace' }}>{a.tickets_assigned}</td>
                        <td style={{ padding: '12px 16px', fontSize: 13, color: '#4ade80', fontFamily: 'monospace' }}>{a.tickets_closed}</td>
                        <td style={{ padding: '12px 16px', fontSize: 13, color: a.avg_first_response_minutes > 60 ? '#f87171' : '#94a3b8', fontFamily: 'monospace' }}>
                          {a.avg_first_response_minutes ? `${Math.round(a.avg_first_response_minutes)}m` : '—'}
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: 13, color: a.sla_breached_count > 0 ? '#f87171' : '#4ade80', fontFamily: 'monospace' }}>{a.sla_breached_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
