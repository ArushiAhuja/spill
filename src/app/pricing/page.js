'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'

// ─── data ────────────────────────────────────────────────────────────────────

const FLOAT_CARDS = [
  { text: 'reddit · delivery failed again. third time this week',       x: 3,  dur: 16, delay: 0,   op: 0.35 },
  { text: 'hn · why do ops teams still find out from twitter?',         x: 14, dur: 12, delay: 2.5, op: 0.25 },
  { text: 'play store · ★★☆☆☆ app crashes every checkout',            x: 26, dur: 15, delay: 1,   op: 0.3  },
  { text: 'news · startup faces backlash over service outage',          x: 38, dur: 11, delay: 4,   op: 0.28 },
  { text: 'twitter · @brand this is unacceptable. 2 hours waiting',     x: 52, dur: 18, delay: 0.5, op: 0.35 },
  { text: 'reddit · is anyone else seeing delays right now?',           x: 64, dur: 13, delay: 3,   op: 0.25 },
  { text: 'hn · our trust & safety team uses spill religiously',        x: 76, dur: 14, delay: 1.8, op: 0.3  },
  { text: 'news · founder responds amid growing social backlash',       x: 86, dur: 10, delay: 5,   op: 0.28 },
  { text: 'reddit · caught the refund policy post before it went viral',x: 8,  dur: 17, delay: 7,   op: 0.32 },
  { text: 'play store · 1★ support never replied in 4 days',            x: 44, dur: 9,  delay: 2,   op: 0.28 },
]

const PLANS = [
  {
    key: 'sandbox',
    name: 'sandbox',
    price: 'free',
    priceSub: 'forever',
    tagline: 'kick the tires.',
    desc: 'for demos, founders, and exploration.',
    cta: 'try spill',
    ctaHref: '/login',
    ctaStyle: 'outline',
    badge: null,
    features: [
      '1 workspace',
      '1 monitoring room',
      '3 sources',
      'delayed refresh (hourly)',
      '7-day signal history',
      'ai categorization',
      'spill branding',
    ],
    limits: ['delayed refresh', 'spill branding', '7-day history'],
  },
  {
    key: 'starter',
    name: 'starter',
    price: '$149',
    priceSub: 'per month',
    tagline: 'your first internet ops room.',
    desc: 'for startups and lean ops teams.',
    cta: 'start watching',
    ctaHref: '/login',
    ctaStyle: 'outline',
    badge: 'popular for startups',
    features: [
      'realtime monitoring',
      'reddit, news, rss & reviews',
      'ai categorization + scoring',
      'email & slack alerts',
      'custom categories',
      '3 seats',
      '30-day history',
    ],
    limits: [],
  },
  {
    key: 'growth',
    name: 'growth',
    price: '$499',
    priceSub: 'per month',
    tagline: 'where ops gets serious.',
    desc: 'for cx + ops teams at consumer companies.',
    cta: 'build your ops room',
    ctaHref: '/login',
    ctaStyle: 'primary',
    badge: 'core spill tier',
    features: [
      'everything in starter',
      'unlimited monitoring',
      'gmail, slack & sheets routing',
      'feedback learning',
      'team collaboration',
      'saved views + workflows',
      'mute windows + snooze',
      'escalation rules',
      'daily digest emails',
      '10 seats',
      '90-day history',
      'api access',
    ],
    limits: [],
    highlight: true,
  },
  {
    key: 'enterprise',
    name: 'enterprise',
    price: 'custom',
    priceSub: 'talk to us',
    tagline: 'internet infrastructure.',
    desc: 'for airlines, marketplaces, fintech, large consumer brands.',
    cta: 'talk to us',
    ctaHref: 'mailto:hello@getspill.io',
    ctaStyle: 'outline',
    badge: null,
    features: [
      'everything in growth',
      'sso / saml',
      'audit logs',
      'sla guarantees',
      'unlimited seats',
      'custom alert routing',
      'executive reporting',
      'dedicated onboarding',
      'dedicated support channel',
    ],
    limits: [],
  },
]

const COMPARISON = [
  { manual: 'scattered tabs across reddit, twitter, news', spill: 'unified signal feed, one view' },
  { manual: 'find out 4 hours after it goes viral', spill: 'catch the first post before the thread grows' },
  { manual: 'reactive escalation after the damage', spill: 'automated alerts at score threshold' },
  { manual: 'no signal from app store reviews', spill: 'play store + app store tracked continuously' },
  { manual: 'whoever checks reddit last wins', spill: 'team inbox with assignments and notes' },
  { manual: 'gut feel on what matters', spill: 'ai scores every signal, learns from your feedback' },
]

const FAQS = [
  {
    q: "why don't you charge per mention?",
    a: "mentions are a vanity metric. ops teams care about response time, incident coverage, and preventing fires — not follower counts. our pricing reflects operational value, not noise volume.",
  },
  {
    q: "can we run a pilot before committing?",
    a: "yes. sandbox is free and doesn't expire. connect your sources, set up categories, and see spill catch real signals from your brand before you put a card down.",
  },
  {
    q: "does spill learn from our feedback?",
    a: "every time you label a signal — useful, not relevant, wrong category — spill adjusts. over time the feed gets increasingly specific to your operational reality, not generic brand noise.",
  },
  {
    q: "can teams collaborate inside spill?",
    a: "starter gives you 3 seats. growth gives you 10 + internal notes, saved views, and shared escalation rules. enterprise is unlimited. everyone works the same feed.",
  },
  {
    q: "do you support custom workflows?",
    a: "growth tier ships with escalation rules (score threshold → email/slack/sheets), mute windows, snooze, and api access. if your ops flow doesn't fit, enterprise includes custom routing.",
  },
  {
    q: "can i start free?",
    a: "yes, always. sandbox tier is free, no card required, and doesn't time out. upgrade when you need realtime refresh or team seats.",
  },
]

const CATEGORIES = [
  { name: 'delivery failure', color: '#f87171', score: 87 },
  { name: 'policy complaint', color: '#f87171', score: 79 },
  { name: 'competitor mention', color: '#818cf8', score: 61 },
  { name: 'payment issue', color: '#f87171', score: 84 },
  { name: 'support spike', color: '#818cf8', score: 66 },
  { name: 'positive coverage', color: '#4ade80', score: 32 },
  { name: 'noise', color: '#334155', score: 14 },
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
  const [mobileOpen, setMobileOpen] = useState(false)

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
      <div className="nav-links" style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <a href="/#how" style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: '#64748b', letterSpacing: '0.01em', transition: 'color 0.12s' }}
          onMouseEnter={e => e.currentTarget.style.color = '#94a3b8'}
          onMouseLeave={e => e.currentTarget.style.color = '#64748b'}>
          how it works
        </a>
        <Link href="/pricing" style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: '#e2e8f0', letterSpacing: '0.01em' }}>
          pricing
        </Link>
        <Link href={hasToken ? '/orgs' : '/login'} style={{
          fontFamily: 'var(--font-sans)', fontSize: 13, color: '#e2e8f0',
          background: '#3b82f6', padding: '6px 16px', borderRadius: 8, fontWeight: 500,
          transition: 'opacity 0.15s',
        }}
          onMouseEnter={e => e.currentTarget.style.opacity = '0.88'}
          onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
          {hasToken ? 'dashboard →' : 'get started →'}
        </Link>
      </div>
    </nav>
  )
}

function LiveFeedStrip() {
  const items = [
    { score: 87, src: 'reddit',   cat: 'delivery failure',  color: '#f87171', text: 'why is my order 3 hours late' },
    { score: 74, src: 'twitter',  cat: 'support spike',     color: '#818cf8', text: '@brand no one is picking up' },
    { score: 61, src: 'hn',       cat: 'competitor mention',color: '#818cf8', text: 'how startups are handling ops at scale' },
    { score: 44, src: 'news',     cat: 'regulatory',        color: '#60a5fa', text: 'food app growth slows in tier-2 cities' },
    { score: 82, src: 'play',     cat: 'payment issue',     color: '#f87171', text: '★★☆☆☆ charged twice, no refund' },
    { score: 28, src: 'reddit',   cat: 'positive coverage', color: '#4ade80', text: 'delivery was actually early today' },
  ]

  return (
    <div style={{
      background: '#0d0f1a',
      border: '1px solid #1e2535', borderRadius: 12,
      overflow: 'hidden',
      boxShadow: '0 0 60px rgba(59,130,246,0.06)',
    }}>
      {/* header */}
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid #1e2535',
        display: 'flex', alignItems: 'center', gap: 10,
        background: '#13161f',
      }}>
        <span className="live-dot" style={{ width: 6, height: 6 }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#64748b' }}>live signal feed</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#334155' }}>{items.length} signals · 3 escalated</span>
      </div>

      {/* rows */}
      {items.map((item, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '9px 16px', borderBottom: i < items.length - 1 ? '1px solid #1e2535' : 'none',
          borderLeft: `2px solid ${item.score >= 60 ? item.color + '80' : 'transparent'}`,
          background: 'transparent',
          animation: `fadeIn 0.4s ${i * 0.08}s ease both`,
        }}>
          <div style={{
            width: 32, height: 18, borderRadius: 99, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-mono)', fontSize: 10.5,
            color: scoreColor(item.score), background: scoreBg(item.score),
          }}>
            {item.score}
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#334155', flexShrink: 0, minWidth: 40 }}>{item.src}</span>
          <span style={{ flex: 1, fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.text}</span>
          <span style={{
            fontSize: 10, padding: '1px 7px', borderRadius: 99, flexShrink: 0,
            color: item.color, background: `${item.color}12`, border: `1px solid ${item.color}44`,
          }}>{item.cat}</span>
        </div>
      ))}
    </div>
  )
}

function PricingCard({ plan }) {
  const [hovered, setHovered] = useState(false)

  const isHighlighted = plan.highlight
  const cardBg = isHighlighted ? '#0f1525' : '#0d0f1a'
  const borderColor = isHighlighted
    ? hovered ? 'rgba(59,130,246,0.6)' : 'rgba(59,130,246,0.35)'
    : hovered ? '#243047' : '#1e2535'
  const glowOpacity = isHighlighted ? (hovered ? 0.15 : 0.08) : 0

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        background: cardBg,
        border: `1px solid ${borderColor}`,
        borderRadius: 14,
        padding: '28px 24px',
        display: 'flex',
        flexDirection: 'column',
        transition: 'border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease',
        transform: isHighlighted ? (hovered ? 'translateY(-4px)' : 'translateY(-2px)') : hovered ? 'translateY(-2px)' : 'none',
        boxShadow: isHighlighted
          ? `0 0 60px rgba(59,130,246,${glowOpacity}), 0 20px 40px rgba(0,0,0,0.4)`
          : hovered ? '0 8px 30px rgba(0,0,0,0.3)' : 'none',
        flex: 1,
        minWidth: 220,
      }}
    >
      {/* glow overlay */}
      {isHighlighted && (
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 14, pointerEvents: 'none',
          background: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(59,130,246,0.08) 0%, transparent 70%)',
          transition: 'opacity 0.2s ease',
          opacity: hovered ? 1.5 : 1,
        }} />
      )}

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* badge */}
        <div style={{ minHeight: 22, marginBottom: 12 }}>
          {plan.badge && (
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9.5,
              padding: '2px 8px',
              borderRadius: 99,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              ...(isHighlighted
                ? { color: '#60a5fa', background: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.3)' }
                : { color: '#64748b', background: '#13161f', border: '1px solid #1e2535' }
              ),
            }}>
              {plan.badge}
            </span>
          )}
        </div>

        {/* plan name */}
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: isHighlighted ? '#3b82f6' : '#475569',
          textTransform: 'uppercase',
          letterSpacing: '0.15em',
          marginBottom: 8,
        }}>
          {plan.name}
        </div>

        {/* price */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
          <span style={{
            fontSize: plan.price === 'custom' ? '2rem' : '2.4rem',
            fontWeight: 300,
            color: '#e2e8f0',
            letterSpacing: '-0.02em',
            lineHeight: 1,
          }}>
            {plan.price}
          </span>
          {plan.priceSub && (
            <span style={{ fontSize: 12, color: '#475569' }}>{plan.priceSub}</span>
          )}
        </div>

        {/* tagline */}
        <div style={{ fontSize: 15, fontWeight: 500, color: '#e2e8f0', marginBottom: 4, lineHeight: 1.3, marginTop: 8 }}>
          {plan.tagline}
        </div>
        <div style={{ fontSize: 12, color: '#475569', marginBottom: 24, lineHeight: 1.5 }}>
          {plan.desc}
        </div>

        {/* features */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
          {plan.features.map((f, i) => {
            const isLimit = plan.limits?.includes(f)
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{
                  fontSize: 11,
                  color: isLimit ? '#334155' : isHighlighted ? '#60a5fa' : '#475569',
                  marginTop: 1.5,
                  flexShrink: 0,
                }}>
                  {isLimit ? '—' : '✓'}
                </span>
                <span style={{
                  fontSize: 12.5,
                  color: isLimit ? '#334155' : '#94a3b8',
                  lineHeight: 1.4,
                }}>
                  {f}
                </span>
              </div>
            )
          })}
        </div>

        {/* divider */}
        <div style={{ borderTop: '1px solid #1e2535', margin: '24px 0' }} />

        {/* cta */}
        <Link
          href={plan.ctaHref}
          style={{
            display: 'block',
            textAlign: 'center',
            padding: '11px 20px',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 500,
            fontFamily: 'inherit',
            transition: 'all 0.15s',
            ...(plan.ctaStyle === 'primary'
              ? { background: '#3b82f6', color: '#fff', border: '1px solid transparent' }
              : { background: 'transparent', color: '#e2e8f0', border: '1px solid #1e2535' }
            ),
          }}
          onMouseEnter={e => {
            if (plan.ctaStyle === 'primary') { e.currentTarget.style.background = '#2563eb' }
            else { e.currentTarget.style.borderColor = '#243047'; e.currentTarget.style.color = '#e2e8f0' }
          }}
          onMouseLeave={e => {
            if (plan.ctaStyle === 'primary') { e.currentTarget.style.background = '#3b82f6' }
            else { e.currentTarget.style.borderColor = '#1e2535'; e.currentTarget.style.color = '#e2e8f0' }
          }}
        >
          {plan.cta}
        </Link>
      </div>
    </div>
  )
}

function ComparisonSection() {
  return (
    <section style={{ padding: '120px 24px', background: '#080a12' }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        {/* label */}
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 20 }}>
          reality check
        </div>

        <div style={{ fontSize: 'clamp(1.8rem, 4vw, 2.6rem)', fontWeight: 300, color: '#e2e8f0', letterSpacing: '-0.02em', marginBottom: 8 }}>
          still checking reddit manually?
        </div>
        <div style={{ fontSize: '1rem', color: '#64748b', marginBottom: 60, lineHeight: 1.6 }}>
          your ops team deserves better tooling than 12 open browser tabs.
        </div>

        {/* comparison grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          {/* headers */}
          <div style={{ background: '#13161f', border: '1px solid #1e2535', borderRadius: '10px 0 0 0', padding: '14px 20px' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              manual monitoring
            </div>
          </div>
          <div style={{ background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.25)', borderLeft: 'none', borderRadius: '0 10px 0 0', padding: '14px 20px' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              spill
            </div>
          </div>

          {/* rows */}
          {COMPARISON.map((row, i) => {
            const isLast = i === COMPARISON.length - 1
            return (
              <>
                <div key={`m-${i}`} style={{
                  background: '#13161f',
                  border: '1px solid #1e2535', borderTop: 'none',
                  borderRadius: isLast ? '0 0 0 10px' : 0,
                  padding: '14px 20px',
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                }}>
                  <span style={{ fontSize: 11, color: '#334155', flexShrink: 0, marginTop: 1 }}>✗</span>
                  <span style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.5 }}>{row.manual}</span>
                </div>
                <div key={`s-${i}`} style={{
                  background: 'rgba(59,130,246,0.04)',
                  border: '1px solid rgba(59,130,246,0.2)', borderTop: 'none', borderLeft: 'none',
                  borderRadius: isLast ? '0 0 10px 0' : 0,
                  padding: '14px 20px',
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                }}>
                  <span style={{ fontSize: 11, color: '#3b82f6', flexShrink: 0, marginTop: 1 }}>✓</span>
                  <span style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.5 }}>{row.spill}</span>
                </div>
              </>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function FAQSection() {
  const [openIdx, setOpenIdx] = useState(null)

  return (
    <section style={{ padding: '80px 24px 120px', background: '#0d0f1a' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 20 }}>
          faq
        </div>
        <div style={{ fontSize: '2.2rem', fontWeight: 300, color: '#e2e8f0', letterSpacing: '-0.01em', marginBottom: 48 }}>
          the obvious questions.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {FAQS.map((faq, i) => {
            const isOpen = openIdx === i
            return (
              <div
                key={i}
                style={{
                  background: isOpen ? '#13161f' : 'transparent',
                  border: '1px solid #1e2535',
                  borderRadius: 10,
                  overflow: 'hidden',
                  transition: 'background 0.15s',
                  marginBottom: 2,
                }}
              >
                <button
                  onClick={() => setOpenIdx(isOpen ? null : i)}
                  style={{
                    width: '100%', textAlign: 'left',
                    padding: '16px 20px',
                    background: 'none', border: 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
                    cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'color 0.12s',
                  }}
                >
                  <span style={{ fontSize: 13.5, fontWeight: 500, color: isOpen ? '#e2e8f0' : '#94a3b8', lineHeight: 1.4 }}>
                    {faq.q}
                  </span>
                  <span style={{
                    fontSize: 11, color: '#334155', flexShrink: 0,
                    transition: 'transform 0.2s ease',
                    display: 'inline-block',
                    transform: isOpen ? 'rotate(180deg)' : 'none',
                  }}>▾</span>
                </button>
                {isOpen && (
                  <div style={{
                    padding: '0 20px 18px',
                    fontSize: 13, color: '#64748b', lineHeight: 1.7,
                    animation: 'fadeUp 0.15s ease both',
                  }}>
                    {faq.a}
                  </div>
                )}
              </div>
            )
          })}
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
      padding: '32px 28px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      flexWrap: 'wrap', gap: 12,
    }}>
      <Link href="/" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#334155', letterSpacing: '0.1em' }}>
        spill
      </Link>
      <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
        <a href="/#how" style={{ fontSize: 12, color: '#334155', transition: 'color 0.12s' }}
          onMouseEnter={e => e.currentTarget.style.color = '#64748b'}
          onMouseLeave={e => e.currentTarget.style.color = '#334155'}>how it works</a>
        <Link href="/pricing" style={{ fontSize: 12, color: '#334155', transition: 'color 0.12s' }}
          onMouseEnter={e => e.currentTarget.style.color = '#64748b'}
          onMouseLeave={e => e.currentTarget.style.color = '#334155'}>pricing</Link>
        <Link href="/login" style={{ fontSize: 12, color: '#334155', transition: 'color 0.12s' }}
          onMouseEnter={e => e.currentTarget.style.color = '#64748b'}
          onMouseLeave={e => e.currentTarget.style.color = '#334155'}>login</Link>
      </div>
    </footer>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function PricingPage() {
  const [hasToken, setHasToken] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const token = typeof window !== 'undefined' ? localStorage.getItem('spill_token') : null
    if (token) setHasToken(true)
  }, [])

  return (
    <div style={{ background: '#080a12', minHeight: '100vh' }}>
      <Nav hasToken={hasToken} />

      {/* Hero */}
      <section style={{
        position: 'relative', overflow: 'hidden',
        padding: 'clamp(100px, 14vw, 160px) 24px 80px',
        minHeight: '60vh',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        background: '#080a12',
      }}>
        {/* radial glow */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(ellipse 700px 400px at 50% 30%, rgba(59,130,246,0.06) 0%, transparent 70%)',
        }} />

        {/* floating cards */}
        {mounted && FLOAT_CARDS.map((card, i) => (
          <div key={i} style={{
            position: 'absolute', left: `${card.x}%`, bottom: 0,
            fontFamily: 'var(--font-mono)', fontSize: 11,
            color: '#64748b', background: '#13161f',
            border: '1px solid #1e2535', borderRadius: 8,
            padding: '4px 10px', whiteSpace: 'nowrap',
            pointerEvents: 'none', opacity: card.op,
            animation: `drift ${card.dur}s ${card.delay}s linear infinite`,
          }}>
            {card.text}
          </div>
        ))}

        <div style={{ position: 'relative', zIndex: 10, textAlign: 'center', maxWidth: 680 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 20 }}>
            pricing
          </div>
          <h1 style={{ fontSize: 'clamp(2.4rem, 6vw, 4rem)', fontWeight: 300, color: '#e2e8f0', letterSpacing: '-0.02em', lineHeight: 1.1, margin: 0 }}>
            operational intelligence.<br />
            <span style={{ color: '#3b82f6' }}>not vanity metrics.</span>
          </h1>
          <p style={{ marginTop: 20, fontSize: '1.05rem', color: '#64748b', lineHeight: 1.65, maxWidth: 500, margin: '20px auto 0' }}>
            spill detects operational fires before they become headlines. pricing reflects what that&apos;s actually worth.
          </p>
          <div style={{ marginTop: 12, fontFamily: 'var(--font-mono)', fontSize: 11, color: '#334155' }}>
            no per-mention charges. no seat traps. no marketing fluff.
          </div>
        </div>
      </section>

      {/* Pricing cards */}
      <section style={{ padding: '0 24px 100px', background: '#080a12' }}>
        <div style={{ maxWidth: 1060, margin: '0 auto' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 10,
            alignItems: 'stretch',
          }}>
            {PLANS.map(plan => (
              <PricingCard key={plan.key} plan={plan} />
            ))}
          </div>

          <div style={{ marginTop: 28, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: '#334155' }}>
            all plans include ai scoring · activity log · escalation history · api access on growth+
          </div>
        </div>
      </section>

      {/* Live feed preview */}
      <section style={{ padding: '20px 24px 100px', background: '#0d0f1a' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 16 }}>
            what you&apos;re actually buying
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 300, color: '#e2e8f0', letterSpacing: '-0.01em', marginBottom: 8 }}>
            the ops feed your team leaves open all day.
          </div>
          <div style={{ fontSize: '1rem', color: '#64748b', marginBottom: 36, lineHeight: 1.6 }}>
            every signal scored, classified, and routed — before you even know there&apos;s a problem.
          </div>
          <LiveFeedStrip />
          <div style={{ marginTop: 14, fontFamily: 'var(--font-mono)', fontSize: 11, color: '#334155', textAlign: 'center' }}>
            ai scores every signal · sends alerts at your threshold · logs to sheets / slack
          </div>
        </div>
      </section>

      {/* What makes each tier different */}
      <section style={{ padding: '60px 24px 100px', background: '#080a12' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 20 }}>
            how to choose
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 300, color: '#e2e8f0', letterSpacing: '-0.01em', marginBottom: 48 }}>
            when to move up.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {[
              {
                when: 'you want to see spill in action first',
                tier: 'sandbox',
                tierColor: '#475569',
                desc: "free. connect sources. watch signals flow. no expiry. upgrade when you're convinced."
              },
              {
                when: "you're a startup with a lean team watching brand presence",
                tier: 'starter',
                tierColor: '#60a5fa',
                desc: 'realtime feed, alerts, and 30-day history. the minimum viable internet ops stack.'
              },
              {
                when: "your ops team is handling incidents, routing signals, and needs team workflows",
                tier: 'growth',
                tierColor: '#3b82f6',
                desc: 'escalation rules, mute windows, feedback learning, daily digests, api access. this is the ops room.'
              },
              {
                when: "you're an airline, marketplace, or large consumer brand with compliance requirements",
                tier: 'enterprise',
                tierColor: '#a78bfa',
                desc: 'sso, audit logs, sla, dedicated support. we build a custom routing layer for your org structure.'
              },
            ].map((item, i) => (
              <div key={i} style={{
                padding: '18px 20px',
                background: '#0d0f1a',
                border: '1px solid #1e2535',
                borderRadius: 10,
                display: 'flex', alignItems: 'flex-start', gap: 16,
                marginBottom: 2,
              }}>
                <div style={{ flexShrink: 0, paddingTop: 2 }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 8px', borderRadius: 99,
                    color: item.tierColor, background: `${item.tierColor}14`, border: `1px solid ${item.tierColor}40`,
                    letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap',
                  }}>
                    {item.tier}
                  </span>
                </div>
                <div>
                  <div style={{ fontSize: 13.5, color: '#94a3b8', fontWeight: 500, marginBottom: 4 }}>
                    {item.when}
                  </div>
                  <div style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.5 }}>
                    {item.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <ComparisonSection />
      <FAQSection />

      {/* Final CTA */}
      <section style={{ padding: '100px 24px 140px', background: '#080a12', textAlign: 'center' }}>
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
          <div style={{ fontSize: '2.8rem', fontWeight: 300, color: '#e2e8f0', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            internet seems quiet right now.
          </div>
          <div style={{ fontSize: '1rem', color: '#475569', marginTop: 10 }}>
            probably won&apos;t stay that way.
          </div>
          <div style={{ marginTop: 36, display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/login" style={{
              display: 'inline-block', padding: '13px 28px',
              background: '#3b82f6', color: '#fff', borderRadius: 10,
              fontSize: 14, fontWeight: 500, transition: 'opacity 0.15s',
            }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.88'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
              start watching →
            </Link>
            <a href="mailto:hello@getspill.io" style={{
              display: 'inline-block', padding: '13px 28px',
              background: 'transparent', color: '#64748b',
              border: '1px solid #1e2535', borderRadius: 10,
              fontSize: 14, transition: 'all 0.15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#243047'; e.currentTarget.style.color = '#94a3b8' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#1e2535'; e.currentTarget.style.color = '#64748b' }}>
              talk to us
            </a>
          </div>
          <div style={{ marginTop: 16, fontFamily: 'var(--font-mono)', fontSize: 11, color: '#334155' }}>
            sandbox is free. no card required. no setup call.
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
