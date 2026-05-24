'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

// ─── data ────────────────────────────────────────────────────────────────────

const FLOAT_CARDS = [
  { text: 'reddit · delivery was 45 mins late and cold',         x: 4,  dur: 14, delay: 0,   opacity: 0.6 },
  { text: 'hn · show hn: we got hit by a viral complaint thread', x: 16, dur: 11, delay: 2.5, opacity: 0.4 },
  { text: 'twitter · @brand this is unacceptable',               x: 28, dur: 16, delay: 1,   opacity: 0.7 },
  { text: 'news · startup faces backlash after product launch',  x: 40, dur: 13, delay: 4,   opacity: 0.5 },
  { text: 'play store · 1★ app crashed lost my order',           x: 54, dur: 9,  delay: 0.5, opacity: 0.6 },
  { text: 'reddit · is anyone else having issues today?',        x: 66, dur: 18, delay: 3,   opacity: 0.4 },
  { text: 'hn · ask hn: how do companies track brand mentions?', x: 78, dur: 12, delay: 1.8, opacity: 0.5 },
  { text: 'twitter · 3 of my friends had the same bad experience',x: 88, dur: 15, delay: 5,  opacity: 0.7 },
  { text: 'news · founder responds amid growing criticism',       x: 6,  dur: 10, delay: 7,   opacity: 0.45 },
  { text: 'reddit · this complaint went viral overnight',        x: 22, dur: 17, delay: 2,   opacity: 0.6 },
  { text: 'play store · 2★ customer support never replied',      x: 34, dur: 13, delay: 6,   opacity: 0.4 },
  { text: 'twitter · something weird is happening with this brand',x: 48, dur: 11, delay: 3.5,opacity: 0.5 },
  { text: 'hn · the ops team left the dashboard open all day',   x: 60, dur: 14, delay: 0.8, opacity: 0.55 },
  { text: 'reddit · caught this before it became a headline',    x: 72, dur: 16, delay: 4.5, opacity: 0.65 },
  { text: 'news · backlash spreading across social platforms',   x: 82, dur: 9,  delay: 1.5, opacity: 0.45 },
  { text: 'twitter · why is nobody talking about this issue',    x: 92, dur: 12, delay: 6.5, opacity: 0.4 },
  { text: 'reddit · found this buried in a comment thread',      x: 10, dur: 15, delay: 3.2, opacity: 0.6 },
  { text: 'hn · quiet internet day. suspicious.',                x: 50, dur: 18, delay: 5.5, opacity: 0.5 },
]

const TICKER_ITEMS = [
  'delivery complaint', 'founder mention', 'viral thread', 'policy issue',
  'pr opportunity', 'safety alert', 'negative review', 'competitor attack',
  'escalation triggered', 'trust & safety flag',
]

const FEED_POSTS = [
  { score: 87, source: 'reddit',       title: 'seriously why is support this bad',              category: 'negative mention',   color: '#f87171', escalated: true,  time: '2m' },
  { score: 74, source: 'twitter',      title: 'delivery was 45 mins late and cold',             category: 'product complaint',  color: '#818cf8', escalated: true,  time: '8m' },
  { score: 61, source: 'hackernews',   title: 'show hn: tracking brand mentions at scale',      category: 'competitor mention', color: '#818cf8', escalated: false, time: '15m' },
  { score: 43, source: 'google_news',  title: 'food app growth slows in tier-2 cities',         category: 'regulatory',         color: '#60a5fa', escalated: false, time: '23m' },
  { score: 38, source: 'play_store',   title: '★★☆☆☆ app crashes on checkout every time',      category: 'product complaint',  color: '#818cf8', escalated: false, time: '31m' },
  { score: 22, source: 'reddit',       title: 'anyone else notice delivery times improving?',   category: 'positive coverage',  color: '#4ade80', escalated: false, time: '45m' },
  { score: 12, source: 'hackernews',   title: 'interesting piece on restaurant tech stacks',    category: 'noise',              color: '#334155', escalated: false, time: '1h'  },
]

const SOURCE_COLORS = {
  reddit: '#f87171',
  hackernews: '#3b82f6',
  google_news: '#4ade80',
  twitter: '#60a5fa',
  play_store: '#9b8ff7',
}

const SOURCE_LABELS = {
  reddit: 'reddit',
  hackernews: 'hn',
  google_news: 'news',
  twitter: 'twitter',
  play_store: 'play store',
}

const INTEGRATIONS = [
  { name: 'reddit',          desc: 'posts, comments & threads',      color: '#f87171' },
  { name: 'twitter / x',     desc: 'tweets and replies',             color: '#60a5fa' },
  { name: 'hacker news',     desc: 'show hn, ask hn, discussions',   color: '#3b82f6' },
  { name: 'google news',     desc: 'news articles and press',        color: '#4ade80' },
  { name: 'play store',      desc: 'app store reviews',              color: '#9b8ff7' },
  { name: 'gmail',           desc: 'escalation email alerts',        color: '#60a5fa' },
  { name: 'google sheets',   desc: 'auto-log all signals',           color: '#4ade80' },
  { name: 'slack',           desc: 'channel alerts via webhook',      color: '#f59e0b' },
]

const TEAM_CARDS = [
  { label: 'ops teams',           desc: 'catch delivery failures, support spikes, and platform incidents before your dashboards do.' },
  { label: 'customer experience', desc: 'know what customers are saying in reddit threads before it hits your inbox.' },
  { label: 'trust & safety',      desc: 'surface policy violations, coordinated attacks, and harmful content in real time.' },
  { label: 'founders',            desc: "watch the internet like it's your job. because when something goes wrong, it is." },
]

// escalation demo stages
const DEMO_STAGES = [
  { score: 12, border: 'transparent',     badge: false, alert: false },
  { score: 38, border: 'transparent',     badge: false, alert: false },
  { score: 61, border: '#818cf8',         badge: false, alert: false },
  { score: 87, border: '#f87171',         badge: true,  alert: true  },
]

// ─── helpers ──────────────────────────────────────────────────────────────────

function scoreColor(s) {
  if (s >= 80) return '#f87171'
  if (s >= 60) return '#818cf8'
  return '#334155'
}

function scoreBg(s) {
  if (s >= 80) return 'rgba(248,113,113,0.12)'
  if (s >= 60) return 'rgba(129,140,248,0.12)'
  return 'rgba(51,65,85,0.12)'
}

// ─── components ───────────────────────────────────────────────────────────────

function Nav({ hasToken }) {
  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, right: 0, height: 56,
      background: 'rgba(8,10,18,0.92)', backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid #1e2535',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 28px', zIndex: 100,
    }}>
      <Link href="/" style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 400, letterSpacing: '0.25em', color: '#e2e8f0' }}>
        spill
      </Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <a href="#how" style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: '#64748b', letterSpacing: '0.01em', transition: 'color 0.12s' }}
          onMouseEnter={e => e.currentTarget.style.color = '#94a3b8'}
          onMouseLeave={e => e.currentTarget.style.color = '#64748b'}>
          how it works
        </a>
        <Link href="/pricing" style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: '#64748b', letterSpacing: '0.01em', transition: 'color 0.12s' }}
          onMouseEnter={e => e.currentTarget.style.color = '#94a3b8'}
          onMouseLeave={e => e.currentTarget.style.color = '#64748b'}>
          pricing
        </Link>
        {hasToken ? (
          <Link href="/orgs" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#3b82f6', letterSpacing: '0.03em' }}>
            dashboard →
          </Link>
        ) : (
          <>
            <Link href="/login" style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: '#64748b', letterSpacing: '0.01em', transition: 'color 0.12s' }}
              onMouseEnter={e => e.currentTarget.style.color = '#94a3b8'}
              onMouseLeave={e => e.currentTarget.style.color = '#64748b'}>
              login
            </Link>
            <Link href="/signup" style={{
              fontFamily: 'var(--font-sans)', fontSize: 13, color: '#e2e8f0',
              background: '#3b82f6', padding: '6px 16px', borderRadius: 8, fontWeight: 500,
              transition: 'opacity 0.15s',
            }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.88'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
              get started →
            </Link>
          </>
        )}
      </div>
    </nav>
  )
}

function HeroSection() {
  const tickerRow = [...TICKER_ITEMS, ...TICKER_ITEMS]

  return (
    <section style={{
      background: '#080a12',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      overflow: 'hidden',
      paddingTop: 56,
    }}>
      {/* radial glow */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'radial-gradient(ellipse 800px 500px at 50% 40%, rgba(59,130,246,0.07) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* floating pill cards */}
      {FLOAT_CARDS.map((card, i) => (
        <div key={i} style={{
          position: 'absolute',
          left: `${card.x}%`,
          bottom: 0,
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: '#64748b',
          background: '#13161f',
          border: '1px solid #1e2535',
          borderRadius: 8,
          padding: '5px 12px',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          opacity: card.opacity,
          animation: `drift ${card.dur}s ${card.delay}s linear infinite`,
        }}>
          {card.text}
        </div>
      ))}

      {/* hero content */}
      <div style={{
        position: 'relative',
        zIndex: 10,
        textAlign: 'center',
        padding: '0 24px',
        maxWidth: 700,
      }}>
        <div style={{
          fontSize: 'clamp(3.2rem, 7vw, 5.5rem)',
          fontWeight: 300,
          color: '#e2e8f0',
          letterSpacing: '-0.02em',
          lineHeight: 1.05,
        }}>
          the internet
        </div>
        <div style={{
          fontSize: 'clamp(3.2rem, 7vw, 5.5rem)',
          fontWeight: 300,
          color: '#3b82f6',
          letterSpacing: '-0.02em',
          lineHeight: 1.05,
        }}>
          always spills.
        </div>
        <div style={{
          marginTop: 20,
          fontSize: '1.1rem',
          fontWeight: 400,
          color: '#64748b',
          maxWidth: 480,
          margin: '20px auto 0',
          lineHeight: 1.6,
        }}>
          watch what customers say when they don&apos;t tag you.
        </div>

        {/* cta buttons */}
        <div style={{
          marginTop: 36,
          display: 'flex',
          gap: 12,
          justifyContent: 'center',
          flexWrap: 'wrap',
        }}>
          <Link href="/signup" style={{
            padding: '12px 24px',
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 500,
            background: '#3b82f6',
            color: '#fff',
            display: 'inline-block',
          }}>
            start watching →
          </Link>
          <a href="#how" style={{
            padding: '12px 24px',
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 400,
            background: 'transparent',
            color: '#64748b',
            border: '1px solid #1e2535',
            display: 'inline-block',
          }}>
            see how it works
          </a>
        </div>

        {/* live stats row */}
        <div style={{
          marginTop: 48,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: '#334155',
          flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="live-dot" style={{ width: 6, height: 6 }} />
            <span style={{ color: '#64748b' }}>2,847 signals today</span>
          </div>
          <span>·</span>
          <span style={{ color: '#64748b' }}>43 escalated</span>
          <span>·</span>
          <span style={{ color: '#4ade80' }}>live</span>
        </div>
      </div>

      {/* scrolling ticker */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        background: '#0d0f1a',
        borderTop: '1px solid #1e2535',
        borderBottom: '1px solid #1e2535',
        padding: '12px 0',
        overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex',
          whiteSpace: 'nowrap',
          animation: 'ticker 25s linear infinite',
        }}>
          {tickerRow.map((item, i) => (
            <span key={i} style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: '#334155',
              padding: '0 20px',
            }}>
              {item}
              <span style={{ marginLeft: 20, color: '#1e2535' }}>·</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

function HowSection() {
  const steps = [
    {
      num: '01',
      title: 'connect sources',
      desc: 'toggle reddit, hacker news, google news, play store. no api keys needed to start.',
      extra: (
        <div style={{ display: 'flex', gap: 6, marginTop: 16, flexWrap: 'wrap' }}>
          {[['reddit', '#f87171'], ['hn', '#3b82f6'], ['news', '#4ade80'], ['play store', '#9b8ff7'], ['twitter', '#60a5fa']].map(([label, color]) => (
            <div key={label} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              fontSize: 10, fontFamily: 'var(--font-mono)', color: '#64748b',
              background: '#191d2b', borderRadius: 99, padding: '3px 8px',
              border: '1px solid #1e2535',
            }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: color }} />
              {label}
            </div>
          ))}
        </div>
      ),
    },
    {
      num: '02',
      title: 'ai reads everything',
      desc: 'every post gets classified, scored, and routed to the right category automatically.',
      extra: (
        <div style={{ marginTop: 16 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)',
            borderRadius: 99, padding: '4px 10px', fontSize: 11,
            fontFamily: 'var(--font-mono)', color: '#f87171',
          }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#f87171' }} />
            negative mention · score 87
          </div>
        </div>
      ),
    },
    {
      num: '03',
      title: 'your team gets alerted',
      desc: 'high-signal posts trigger email alerts and log to google sheets before they escalate.',
      extra: (
        <div style={{ marginTop: 16 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)',
            borderRadius: 8, padding: '6px 12px', fontSize: 11,
            fontFamily: 'var(--font-mono)', color: '#60a5fa',
          }}>
            ↗ email alert sent · logged to sheets
          </div>
        </div>
      ),
    },
  ]

  return (
    <section id="how" style={{
      background: '#0d0f1a',
      padding: '120px 24px',
    }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: '#3b82f6',
          textTransform: 'uppercase',
          letterSpacing: '0.15em',
          marginBottom: 20,
        }}>
          how it works
        </div>
        <div style={{
          fontSize: '2.5rem',
          fontWeight: 300,
          color: '#e2e8f0',
          letterSpacing: '-0.01em',
          marginBottom: 12,
        }}>
          three steps. no setup call required.
        </div>
        <div style={{
          fontSize: '1rem',
          color: '#64748b',
          marginBottom: 56,
        }}>
          connect your sources. ai reads the internet. your team gets alerted.
        </div>

        <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {steps.map((step) => (
            <div key={step.num} style={{
              flex: 1,
              minWidth: 240,
              background: '#13161f',
              border: '1px solid #1e2535',
              borderRadius: 12,
              padding: 28,
            }}>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: '#3b82f6',
              }}>
                {step.num}
              </div>
              <div style={{
                fontSize: '1rem',
                fontWeight: 500,
                color: '#e2e8f0',
                marginTop: 12,
              }}>
                {step.title}
              </div>
              <div style={{
                fontSize: 13,
                color: '#64748b',
                marginTop: 8,
                lineHeight: 1.6,
              }}>
                {step.desc}
              </div>
              {step.extra}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function DashboardPreview() {
  return (
    <section style={{
      background: '#080a12',
      padding: '100px 24px',
    }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: '#3b82f6',
          textTransform: 'uppercase',
          letterSpacing: '0.15em',
          marginBottom: 20,
        }}>
          the dashboard
        </div>
        <div style={{
          fontSize: '2.2rem',
          fontWeight: 300,
          color: '#e2e8f0',
          letterSpacing: '-0.01em',
          marginBottom: 12,
        }}>
          what your team actually sees
        </div>
        <div style={{
          fontSize: '1rem',
          color: '#64748b',
          marginBottom: 56,
        }}>
          the dashboard your ops team leaves open all day.
        </div>

        {/* mock dashboard window */}
        <div style={{
          borderRadius: 12,
          border: '1px solid #1e2535',
          overflow: 'hidden',
          boxShadow: '0 40px 80px rgba(0,0,0,0.6)',
        }}>
          {/* browser chrome top bar */}
          <div style={{
            background: '#13161f',
            height: 36,
            borderBottom: '1px solid #1e2535',
            display: 'flex',
            alignItems: 'center',
            padding: '0 14px',
            gap: 8,
          }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#f87171' }} />
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#fbbf24' }} />
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#4ade80' }} />
            </div>
            <div style={{
              flex: 1,
              textAlign: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: '#334155',
            }}>
              spill — chimes aviation
            </div>
          </div>

          {/* app layout */}
          <div style={{ display: 'flex', height: 520 }}>
            {/* sidebar */}
            <div style={{
              width: 160,
              background: '#12151e',
              borderRight: '1px solid #1e2535',
              padding: '16px 8px',
              flexShrink: 0,
            }}>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: '#334155',
                letterSpacing: '0.2em',
                padding: '8px 8px 12px',
              }}>
                spill
              </div>
              {[
                { icon: '◈', label: 'feed', active: true },
                { icon: '◇', label: 'settings', active: false },
                { icon: '◉', label: 'categories', active: false },
                { icon: '◎', label: 'escalations', active: false },
              ].map((item) => (
                <div key={item.label} style={{
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  borderRadius: 6,
                  fontSize: 10,
                  color: item.active ? '#e2e8f0' : '#64748b',
                  background: item.active ? '#1e2338' : 'transparent',
                  marginBottom: 2,
                }}>
                  <span style={{ fontSize: 9 }}>{item.icon}</span>
                  {item.label}
                </div>
              ))}
            </div>

            {/* main content */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* filter bar */}
              <div style={{
                height: 40,
                borderBottom: '1px solid #1e2535',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '0 16px',
                flexShrink: 0,
              }}>
                {['all sources', 'reddit', 'hn', 'news'].map((f, i) => (
                  <div key={f} style={{
                    height: 24,
                    display: 'flex',
                    alignItems: 'center',
                    fontSize: 11,
                    borderRadius: 99,
                    border: '1px solid #1e2535',
                    color: i === 0 ? '#e2e8f0' : '#64748b',
                    background: i === 0 ? '#1e2338' : 'transparent',
                    padding: '2px 10px',
                    whiteSpace: 'nowrap',
                  }}>
                    {f}
                  </div>
                ))}
                <div style={{ flex: 1 }} />
                <div style={{
                  height: 24, display: 'flex', alignItems: 'center',
                  fontSize: 11, borderRadius: 99, border: '1px solid #1e2535',
                  color: '#64748b', padding: '2px 10px', whiteSpace: 'nowrap',
                }}>
                  escalated only
                </div>
                <div style={{
                  height: 24, width: 100,
                  background: '#13161f', border: '1px solid #1e2535',
                  borderRadius: 6, fontSize: 11, display: 'flex',
                  alignItems: 'center', padding: '0 8px', color: '#334155',
                }}>
                  search...
                </div>
              </div>

              {/* stats bar */}
              <div style={{
                height: 30,
                borderBottom: '1px solid #1e2535',
                padding: '0 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                flexShrink: 0,
              }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#64748b' }}>47 signals</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#3b82f6' }}>3 escalated</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#334155' }}>last seen just now</span>
              </div>

              {/* feed rows */}
              <div style={{ flex: 1, overflow: 'hidden' }}>
                {FEED_POSTS.map((post, i) => (
                  <div key={i} style={{
                    height: 44,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '0 16px',
                    borderBottom: '1px solid #1e2535',
                    borderLeft: `2px solid ${post.escalated ? '#3b82f6' : 'transparent'}`,
                    fontSize: 12,
                  }}>
                    {/* score pill */}
                    <div style={{
                      width: 32,
                      height: 20,
                      borderRadius: 99,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      color: scoreColor(post.score),
                      background: scoreBg(post.score),
                      flexShrink: 0,
                    }}>
                      {post.score}
                    </div>

                    {/* source dot + label */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <div style={{
                        width: 5, height: 5, borderRadius: '50%',
                        background: SOURCE_COLORS[post.source],
                      }} />
                      <span style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        color: '#64748b',
                      }}>
                        {SOURCE_LABELS[post.source]}
                      </span>
                    </div>

                    {/* title */}
                    <div style={{
                      flex: 1,
                      color: '#e2e8f0',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {post.title}
                    </div>

                    {/* category pill */}
                    <div style={{
                      borderRadius: 99,
                      fontSize: 10,
                      padding: '1px 7px',
                      color: post.color,
                      border: `1px solid ${post.color}44`,
                      background: `${post.color}10`,
                      flexShrink: 0,
                      whiteSpace: 'nowrap',
                    }}>
                      {post.category}
                    </div>

                    {/* time */}
                    <div style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      color: '#334155',
                      flexShrink: 0,
                    }}>
                      {post.time}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function IntegrationsSection() {
  const [hovered, setHovered] = useState(null)

  return (
    <section style={{
      background: '#0d0f1a',
      padding: '100px 24px',
    }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: '#3b82f6',
          textTransform: 'uppercase',
          letterSpacing: '0.15em',
          marginBottom: 20,
        }}>
          integrations
        </div>
        <div style={{
          fontSize: '2.2rem',
          fontWeight: 300,
          color: '#e2e8f0',
          letterSpacing: '-0.01em',
          marginBottom: 12,
        }}>
          the internet lives in a lot of places.
        </div>
        <div style={{
          fontSize: '1rem',
          color: '#64748b',
          marginBottom: 56,
        }}>
          spill watches them all.
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
        }}>
          {INTEGRATIONS.map((item, i) => (
            <div
              key={item.name}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              style={{
                background: hovered === i ? `${item.color}08` : '#13161f',
                border: `1px solid ${hovered === i ? item.color + '66' : '#1e2535'}`,
                borderRadius: 10,
                padding: 20,
                cursor: 'default',
                transition: 'all 0.2s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: item.color, flexShrink: 0,
                }} />
                <div style={{ fontSize: 13, fontWeight: 500, color: '#e2e8f0' }}>
                  {item.name}
                </div>
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                {item.desc}
              </div>
              {item.soon && (
                <div style={{
                  display: 'inline-block',
                  marginTop: 8,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  color: '#334155',
                  border: '1px solid #1e2535',
                  borderRadius: 4,
                  padding: '2px 6px',
                }}>
                  coming soon
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function ForTeamsSection() {
  const [hovered, setHovered] = useState(null)

  return (
    <section style={{
      background: '#080a12',
      padding: '100px 24px',
    }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: '#3b82f6',
          textTransform: 'uppercase',
          letterSpacing: '0.15em',
          marginBottom: 20,
        }}>
          who uses spill
        </div>
        <div style={{
          fontSize: '2.2rem',
          fontWeight: 300,
          color: '#e2e8f0',
          letterSpacing: '-0.01em',
          marginBottom: 56,
        }}>
          built for people who can&apos;t afford surprises.
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 12,
        }}>
          {TEAM_CARDS.map((card, i) => (
            <div
              key={card.label}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              style={{
                background: '#13161f',
                border: `1px solid ${hovered === i ? '#243047' : '#1e2535'}`,
                borderRadius: 12,
                padding: 28,
                transition: 'border-color 0.2s ease',
              }}
            >
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: '#3b82f6',
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
                marginBottom: 10,
              }}>
                {card.label}
              </div>
              <div style={{
                fontSize: 13.5,
                color: '#64748b',
                lineHeight: 1.7,
              }}>
                {card.desc}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function EscalationDemo() {
  const [stage, setStage] = useState(0)

  useEffect(() => {
    const id = setInterval(() => {
      setStage(s => (s + 1) % 4)
    }, 3500)
    return () => clearInterval(id)
  }, [])

  const current = DEMO_STAGES[stage]

  return (
    <section style={{
      background: '#0d0f1a',
      padding: '100px 24px',
    }}>
      <div style={{ maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: '#3b82f6',
          textTransform: 'uppercase',
          letterSpacing: '0.15em',
          marginBottom: 20,
        }}>
          how escalation works
        </div>
        <div style={{
          fontSize: '2.2rem',
          fontWeight: 300,
          color: '#e2e8f0',
          letterSpacing: '-0.01em',
          marginBottom: 12,
        }}>
          from first signal to your inbox.
        </div>
        <div style={{
          fontSize: '1rem',
          color: '#64748b',
          marginBottom: 56,
          lineHeight: 1.6,
        }}>
          high-signal posts get flagged automatically. your team decides what to do next.
        </div>

        {/* animated post card */}
        <div style={{
          background: '#13161f',
          border: `1px solid #1e2535`,
          borderLeft: `2px solid ${current.border}`,
          borderRadius: 10,
          padding: '16px 20px',
          textAlign: 'left',
          transition: 'border-color 0.4s ease, border-left-color 0.4s ease',
          maxWidth: 480,
          margin: '0 auto',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            {/* score pill */}
            <div style={{
              width: 36,
              height: 22,
              borderRadius: 99,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: scoreColor(current.score),
              background: scoreBg(current.score),
              transition: 'all 0.4s ease',
              flexShrink: 0,
            }}>
              {current.score}
            </div>

            {/* source */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#f87171' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#64748b' }}>reddit</span>
            </div>

            {/* escalate badge */}
            {current.badge && (
              <div
                className="escalate-badge"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: '#f87171',
                  background: 'rgba(248,113,113,0.08)',
                  border: '1px solid rgba(248,113,113,0.3)',
                  borderRadius: 99,
                  padding: '2px 8px',
                  animation: 'escalate-pulse 2.5s ease-in-out infinite',
                }}
              >
                escalated
              </div>
            )}

            <div style={{ flex: 1 }} />
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#334155' }}>
              {stage === 0 ? 'just now' : stage === 1 ? '2m' : stage === 2 ? '5m' : '8m'}
            </div>
          </div>

          <div style={{ fontSize: 13, color: '#e2e8f0', lineHeight: 1.5, marginBottom: 10 }}>
            seriously why is support taking 3 days to respond
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              fontSize: 10,
              borderRadius: 99,
              padding: '1px 7px',
              color: '#f87171',
              border: '1px solid rgba(248,113,113,0.3)',
              background: 'rgba(248,113,113,0.08)',
            }}>
              negative mention
            </div>
            {current.alert && (
              <div style={{
                fontSize: 10,
                fontFamily: 'var(--font-mono)',
                color: '#4ade80',
                animation: 'fadeIn 0.3s ease',
              }}>
                → email alert sent
              </div>
            )}
          </div>
        </div>

        <div style={{
          marginTop: 24,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: '#334155',
        }}>
          score ≥ 60 → email alert + sheets row
        </div>

        {/* stage indicators */}
        <div style={{
          marginTop: 20,
          display: 'flex',
          justifyContent: 'center',
          gap: 6,
        }}>
          {DEMO_STAGES.map((_, i) => (
            <div key={i} style={{
              width: i === stage ? 16 : 6,
              height: 6,
              borderRadius: 99,
              background: i === stage ? '#3b82f6' : '#1e2535',
              transition: 'all 0.3s ease',
            }} />
          ))}
        </div>
      </div>
    </section>
  )
}

function FinalCTA() {
  return (
    <section style={{
      background: '#080a12',
      padding: '140px 24px',
      textAlign: 'center',
    }}>
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        <div style={{
          fontSize: '3rem',
          fontWeight: 300,
          color: '#e2e8f0',
          letterSpacing: '-0.02em',
          lineHeight: 1.1,
        }}>
          internet seems quiet right now.
        </div>
        <div style={{
          fontSize: '1rem',
          color: '#475569',
          marginTop: 12,
        }}>
          probably won&apos;t stay that way.
        </div>
        <div style={{ marginTop: 40 }}>
          <Link href="/signup" style={{
            display: 'inline-block',
            padding: '14px 32px',
            background: '#3b82f6',
            color: '#fff',
            borderRadius: 10,
            fontSize: 15,
            fontWeight: 500,
          }}>
            start watching →
          </Link>
        </div>
        <div style={{
          marginTop: 16,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: '#334155',
        }}>
          no credit card. no setup call. just data.
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer style={{
      background: '#080a12',
      borderTop: '1px solid #1e2535',
      padding: '32px 24px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 12,
    }}>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        color: '#334155',
        letterSpacing: '0.1em',
      }}>
        spill
      </div>
      <div style={{ fontSize: 12, color: '#334155' }}>
        watch the internet before it becomes a problem.
      </div>
    </footer>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [hasToken, setHasToken] = useState(false)

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('spill_token') : null
    if (token) setHasToken(true)
  }, [])

  return (
    <div style={{ background: '#080a12' }}>
      <Nav hasToken={hasToken} />
      <HeroSection />
      <HowSection />
      <DashboardPreview />
      <IntegrationsSection />
      <ForTeamsSection />
      <EscalationDemo />
      <FinalCTA />
      <Footer />
    </div>
  )
}
