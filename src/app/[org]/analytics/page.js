'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'

// Pure SVG mini sparkline — no deps
function Sparkline({ data, color = '#3b82f6', width = 160, height = 36 }) {
  if (!data || data.length < 2) return (
    <svg width={width} height={height}>
      <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="#1e2535" strokeWidth={1} />
    </svg>
  )
  const vals = data.map(d => d.count)
  const max = Math.max(...vals, 1)
  const min = Math.min(...vals, 0)
  const range = max - min || 1
  const pad = 3
  const pts = data.map((d, i) => {
    const x = pad + (i / (data.length - 1)) * (width - pad * 2)
    const y = pad + ((1 - (d.count - min) / range) * (height - pad * 2))
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <polyline
        points={`${pad},${height} ${pts} ${pad + (data.length - 1) / (data.length - 1) * (width - pad * 2)},${height}`}
        fill={color}
        fillOpacity={0.08}
        stroke="none"
      />
    </svg>
  )
}

function SentimentBar({ value }) {
  // value 0-20, 0=positive, 20=extreme negative
  const pct = (value / 20) * 100
  const color = value >= 15 ? '#f87171' : value >= 10 ? '#818cf8' : value >= 6 ? '#f59e0b' : '#4ade80'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 4, background: '#1e2535', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 11, color, fontFamily: 'var(--font-mono)', minWidth: 28 }}>{value.toFixed(1)}</span>
    </div>
  )
}

function VolumeChart({ data }) {
  const width = 800
  const height = 80
  const pad = { top: 8, bottom: 20, left: 0, right: 0 }
  const chartW = width - pad.left - pad.right
  const chartH = height - pad.top - pad.bottom
  const max = Math.max(...data.map(d => d.count), 1)
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * chartW
    const y = pad.top + (1 - d.count / max) * chartH
    return { x, y, ...d }
  })
  const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const fillD = `${pathD} L${pts[pts.length - 1].x},${pad.top + chartH} L${pts[0].x},${pad.top + chartH} Z`

  // Show ~6 date labels
  const labelStep = Math.max(1, Math.floor(data.length / 6))
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" style={{ height: height, display: 'block' }}>
        <path d={fillD} fill="#3b82f6" fillOpacity={0.07} />
        <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth={1.5} strokeLinejoin="round" />
        {pts.filter((_, i) => i % labelStep === 0 || i === pts.length - 1).map((p, i) => (
          <text key={i} x={p.x} y={height - 4} textAnchor="middle" fontSize={9} fill="#334155" fontFamily="monospace">
            {new Date(p.date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
          </text>
        ))}
      </svg>
    </div>
  )
}

export default function AnalyticsPage({ params }) {
  const slug = params.org
  const router = useRouter()
  const [stats, setStats] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [days, setDays] = useState(14)

  useEffect(() => {
    setLoading(true)
    api.getStats(slug, days)
      .then(data => { setStats(data || []); setLoading(false) })
      .catch(err => {
        if (err.message === 'unauthorized') router.replace('/login')
        else setError(err.message || 'failed to load')
        setLoading(false)
      })
  }, [slug, days])

  // Aggregate totals
  const totalPosts = stats.reduce((sum, cat) => sum + (cat.trend || []).reduce((s, d) => s + d.count, 0), 0)
  const avgSentiment = stats.length
    ? stats.reduce((sum, cat) => {
        const trend = cat.trend || []
        const catTotal = trend.reduce((s, d) => s + d.count, 0)
        const catAvg = trend.length && catTotal > 0
          ? trend.reduce((s, d) => s + d.avg_sentiment * d.count, 0) / catTotal
          : 0
        return sum + catAvg
      }, 0) / stats.length
    : 0

  // Build volume timeline across all categories
  const allDates = [...new Set(stats.flatMap(c => (c.trend || []).map(d => d.date)))].sort()
  const volumeByDate = allDates.map(date => ({
    date,
    count: stats.reduce((sum, cat) => {
      const d = (cat.trend || []).find(t => t.date === date)
      return sum + (d?.count || 0)
    }, 0)
  }))

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {[0,1,2].map(i => <div key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: '#3b82f6', animation: `pulseDot 1.2s ${i*0.18}s ease-in-out infinite` }} />)}
      </div>
      <div style={{ fontSize: 12, color: '#334155' }}>loading analytics...</div>
    </div>
  )

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '40px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 500, color: '#e2e8f0', marginBottom: 4 }}>analytics</div>
          <div style={{ fontSize: 12.5, color: '#64748b' }}>sentiment & volume trends per category.</div>
        </div>
        <div style={{ display: 'flex', gap: 2, padding: 3, background: '#0d0f1a', borderRadius: 8, border: '1px solid #1e2535' }}>
          {[7, 14, 30].map(d => (
            <button key={d} onClick={() => setDays(d)} style={{ fontSize: 12, padding: '5px 12px', borderRadius: 6, background: days === d ? '#191d2b' : 'transparent', color: days === d ? '#e2e8f0' : '#64748b', border: days === d ? '1px solid #1e2535' : '1px solid transparent', cursor: 'pointer', fontFamily: 'inherit' }}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {error && <div style={{ fontSize: 12.5, color: '#f87171', padding: '10px 14px', background: 'rgba(248,113,113,0.08)', borderRadius: 8, border: '1px solid rgba(248,113,113,0.2)', marginBottom: 20 }}>{error}</div>}

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 28 }}>
        {[
          { label: 'total signals', value: totalPosts.toLocaleString(), color: '#e2e8f0' },
          { label: 'categories tracked', value: stats.length, color: '#e2e8f0' },
          { label: 'avg sentiment', value: avgSentiment.toFixed(1) + '/20', color: avgSentiment >= 10 ? '#f87171' : avgSentiment >= 6 ? '#f59e0b' : '#4ade80' },
        ].map(card => (
          <div key={card.label} style={{ background: '#13161f', border: '1px solid #1e2535', borderRadius: 10, padding: '16px 20px' }}>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>{card.label}</div>
            <div style={{ fontSize: 22, fontWeight: 500, color: card.color, fontFamily: 'var(--font-mono)' }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* Volume trend chart */}
      {volumeByDate.length > 1 && (
        <div style={{ background: '#13161f', border: '1px solid #1e2535', borderRadius: 10, padding: '20px 24px', marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>signal volume — last {days} days</div>
          <VolumeChart data={volumeByDate} />
        </div>
      )}

      {/* Empty state */}
      {stats.length === 0 && !error && (
        <div style={{ padding: '80px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: '#64748b', marginBottom: 6 }}>no data yet.</div>
          <div style={{ fontSize: 12.5, color: '#334155' }}>analytics populate as signals are collected. check back after the first refresh cycle.</div>
        </div>
      )}

      {/* Per-category breakdown */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {stats.sort((a, b) => {
          const aTotal = (a.trend || []).reduce((s, d) => s + d.count, 0)
          const bTotal = (b.trend || []).reduce((s, d) => s + d.count, 0)
          return bTotal - aTotal
        }).map(cat => {
          const trend = cat.trend || []
          const total = trend.reduce((s, d) => s + d.count, 0)
          const avgSent = total > 0
            ? trend.reduce((s, d) => s + d.avg_sentiment * d.count, 0) / total
            : 0
          const lastWeek = trend.slice(-7).reduce((s, d) => s + d.count, 0)
          const prevWeek = trend.slice(-14, -7).reduce((s, d) => s + d.count, 0)
          const trendPct = prevWeek > 0 ? ((lastWeek - prevWeek) / prevWeek * 100).toFixed(0) : null
          return (
            <div key={cat.id} style={{ background: '#13161f', border: '1px solid #1e2535', borderRadius: 10, padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: cat.color || '#64748b', flexShrink: 0 }} />
                  <span style={{ fontSize: 13.5, fontWeight: 500, color: '#e2e8f0' }}>{cat.name}</span>
                  {trendPct !== null && (
                    <span style={{
                      fontSize: 10, padding: '1px 6px', borderRadius: 99,
                      color: Number(trendPct) > 0 ? '#f87171' : '#4ade80',
                      background: Number(trendPct) > 0 ? 'rgba(248,113,113,0.1)' : 'rgba(74,222,128,0.1)',
                      border: `1px solid ${Number(trendPct) > 0 ? 'rgba(248,113,113,0.2)' : 'rgba(74,222,128,0.2)'}`,
                    }}>
                      {Number(trendPct) > 0 ? '▲' : '▼'} {Math.abs(Number(trendPct))}%
                    </span>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#e2e8f0', fontFamily: 'var(--font-mono)' }}>{total}</div>
                  <div style={{ fontSize: 11, color: '#334155' }}>signals</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 16, alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>avg sentiment intensity</div>
                  <SentimentBar value={avgSent} />
                </div>
                <div>
                  <Sparkline data={trend} color={cat.color || '#3b82f6'} />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
