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
  { text: 'reddit · caught the refund post before it went viral',       x: 8,  dur: 17, delay: 7,   op: 0.32 },
  { text: 'play store · 1★ support never replied in 4 days',            x: 44, dur: 9,  delay: 2,   op: 0.28 },
]

// Features can be { section: 'label' } for group headers or plain strings
const PLANS = [
  {
    key: 'monitor',
    name: 'monitor',
    solve: 'see issues.',
    price: '$399',
    priceSub: '/month',
    tagline: 'Catch customer issues before they spread.',
    desc: 'For teams that need visibility.',
    cta: 'start 7-day trial',
    ctaHref: '/onboarding',
    ctaStyle: 'outline',
    badge: null,
    accentColor: '#60a5fa',
    features: [
      { section: 'monitoring' },
      'realtime monitoring',
      'reddit · rss · news · reviews · x/twitter',
      'ai relevance filtering',
      'ai categories + escalation scoring',
      { section: 'workspace' },
      'shared workspace',
      'team invites + role permissions',
      'comments + notes',
      'basic feedback learning',
      { section: 'routing' },
      'gmail alerts',
      'google sheets escalation',
      'alert rules + notifications',
      { section: 'history' },
      '30-day history · 1 org',
    ],
  },
  {
    key: 'coordinate',
    name: 'coordinate',
    solve: 'work together.',
    price: '$999',
    priceSub: '/month',
    tagline: 'Turn internet signals into operational workflows.',
    desc: 'For teams that need accountability.',
    cta: 'start 7-day trial',
    ctaHref: '/onboarding',
    ctaStyle: 'primary',
    badge: 'most popular',
    accentColor: '#3b82f6',
    highlight: true,
    prev: 'everything in monitor +',
    features: [
      { section: 'query lifecycle' },
      'assign ownership + escalation status',
      'archive/dismiss logic',
      'saved views + internal notes',
      'feedback history + audit trail',
      { section: 'collaboration' },
      'unlimited members',
      'multi-team workspace',
      'activity feed + workspace notifications',
      { section: 'routing' },
      'advanced escalation rules',
      'multiple email routes',
      'source-specific routing',
      'digest emails',
      { section: 'intelligence' },
      'custom categories',
      'company learning memory',
      'competitor monitoring',
      { section: 'history' },
      '90-day history · multiple orgs',
    ],
  },
  {
    key: 'command',
    name: 'command center',
    solve: 'run internet operations.',
    price: '$2,999',
    priceSub: '/month',
    tagline: 'Run internet operations like a real system.',
    desc: 'For companies where reputation impacts revenue.',
    cta: 'talk to us',
    ctaHref: 'mailto:hello@getspill.io',
    ctaStyle: 'premium',
    badge: 'this is the moat',
    accentColor: '#818cf8',
    highlight2: true,
    prev: 'everything in coordinate +',
    features: [
      { section: 'ticketing + incidents' },
      'ticketing system + escalation queues',
      'incident timelines + SLA tracking',
      'ownership chains + incident war room',
      'status transitions + resolution tracking',
      { section: 'ops intelligence' },
      'root cause tagging',
      'recurring issue detection',
      'trend detection + ai summaries',
      'executive reporting + analytics',
      { section: 'governance' },
      'audit logs + role hierarchy',
      'approval flows + workspace controls',
      { section: 'integrations' },
      'slack + api access',
      'crm/helpdesk integrations',
      'custom webhooks',
      { section: 'history' },
      '1-year+ history',
    ],
  },
]

const COMPARISON = [
  { manual: 'scattered tabs across reddit, twitter, news', spill: 'unified signal feed — one ops view' },
  { manual: 'find out 4 hours after it goes viral', spill: 'catch the first post before the thread grows' },
  { manual: 'reactive escalation after the damage', spill: 'automated alerts fired at your score threshold' },
  { manual: 'no signal from app store reviews', spill: 'play store + app store tracked continuously' },
  { manual: 'whoever checks reddit last wins', spill: 'team inbox with ownership, notes, and status' },
  { manual: 'gut feel on what actually matters', spill: 'ai scores every signal, learns from your feedback' },
]

const FAQS = [
  {
    q: "what happens after the 7-day trial?",
    a: "your workspace becomes read-only. you can see everything that was caught — posts, alerts, categories — but no new signals come in until you pick a plan. we want you to feel what you'd lose before you decide.",
  },
  {
    q: "why don't you charge per mention?",
    a: "mentions are a vanity metric. ops teams care about incident response time, coverage depth, and catching fires before they spread — not follower counts. pricing reflects operational value, not noise volume.",
  },
  {
    q: "why is there no free tier?",
    a: "because free tiers teach you the wrong thing. the trial lets you see spill working on real signals from your brand. after that, the question isn't 'is it worth paying for?' — it's 'which plan fits how we work?'",
  },
  {
    q: "what's the real difference between monitor and coordinate?",
    a: "monitor answers: 'what's happening?' coordinate answers: 'who's handling it?' coordinate adds query ownership, lifecycle tracking, saved views, and team-wide workflows. it's the difference between a feed and an ops system.",
  },
  {
    q: "what makes command center different from coordinate?",
    a: "command center is zendesk + pagerduty + social intelligence. you get ticketing queues, incident war rooms, SLA tracking, escalation hierarchies, and executive reporting. it's not more monitoring — it's a full internet incident management layer.",
  },
  {
    q: "does spill learn from our team's corrections?",
    a: "yes. every time you label a signal — wrong category, not relevant, different severity — spill adjusts. over time the feed becomes increasingly calibrated to your operational reality, not generic brand noise.",
  },
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

function TierProgression() {
  const tiers = [
    { name: 'monitor', solve: 'see issues.', color: '#60a5fa' },
    { name: 'coordinate', solve: 'work together.', color: '#3b82f6' },
    { name: 'command center', solve: 'run internet operations.', color: '#818cf8' },
  ]
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, flexWrap: 'wrap', rowGap: 12 }}>
      {tiers.map((t, i) => (
        <div key={t.name} style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            padding: '10px 20px',
            background: `${t.color}0d`,
            border: `1px solid ${t.color}2a`,
            borderRadius: 10,
          }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: t.color, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
              {t.name}
            </span>
            <span style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>{t.solve}</span>
          </div>
          {i < tiers.length - 1 && (
            <div style={{ width: 32, height: 1, background: 'linear-gradient(90deg, #1e2535, #334155)', flexShrink: 0, margin: '0 2px' }} />
          )}
        </div>
      ))}
    </div>
  )
}

function TrialBanner() {
  return (
    <div style={{
      background: 'rgba(59,130,246,0.06)',
      border: '1px solid rgba(59,130,246,0.2)',
      borderRadius: 10,
      padding: '12px 20px',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 12, flexWrap: 'wrap',
      marginBottom: 32,
    }}>
      <span className="live-dot" style={{ width: 6, height: 6, flexShrink: 0 }} />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#60a5fa' }}>
        7-day free trial on all plans
      </span>
      <span style={{ width: 1, height: 12, background: '#1e2535', flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: '#475569' }}>
        connect sources · invite team · receive live alerts · no credit card required
      </span>
      <span style={{ width: 1, height: 12, background: '#1e2535', flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: '#334155' }}>
        workspace becomes read-only after 7 days until upgraded
      </span>
    </div>
  )
}

function PricingCard({ plan }) {
  const [hovered, setHovered] = useState(false)
  const { highlight, highlight2, accentColor } = plan

  const borderColor = highlight
    ? hovered ? 'rgba(59,130,246,0.6)' : 'rgba(59,130,246,0.35)'
    : highlight2
      ? hovered ? 'rgba(129,140,248,0.5)' : 'rgba(129,140,248,0.25)'
      : hovered ? '#243047' : '#1e2535'

  const cardBg = highlight ? '#0f1525' : highlight2 ? '#10101e' : '#0d0f1a'

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
        display: 'flex', flexDirection: 'column',
        transition: 'border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease',
        transform: (highlight || highlight2) ? (hovered ? 'translateY(-4px)' : 'translateY(-2px)') : hovered ? 'translateY(-2px)' : 'none',
        boxShadow: highlight
          ? `0 0 60px rgba(59,130,246,${hovered ? 0.15 : 0.07}), 0 20px 40px rgba(0,0,0,0.4)`
          : highlight2
            ? `0 0 60px rgba(129,140,248,${hovered ? 0.12 : 0.05}), 0 20px 40px rgba(0,0,0,0.4)`
            : hovered ? '0 8px 30px rgba(0,0,0,0.3)' : 'none',
      }}
    >
      {/* top glow */}
      {(highlight || highlight2) && (
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 14, pointerEvents: 'none',
          background: `radial-gradient(ellipse 80% 50% at 50% 0%, ${accentColor}0d 0%, transparent 70%)`,
        }} />
      )}

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* badge */}
        <div style={{ minHeight: 20, marginBottom: 16 }}>
          {plan.badge && (
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 9, padding: '2px 8px', borderRadius: 99,
              letterSpacing: '0.1em', textTransform: 'uppercase',
              color: accentColor,
              background: `${accentColor}12`,
              border: `1px solid ${accentColor}30`,
            }}>
              {plan.badge}
            </span>
          )}
        </div>

        {/* plan name */}
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: accentColor, textTransform: 'uppercase', letterSpacing: '0.18em', marginBottom: 4 }}>
          {plan.name}
        </div>

        {/* solve statement */}
        <div style={{ fontSize: 12, color: '#475569', fontStyle: 'italic', marginBottom: 16 }}>
          {plan.solve}
        </div>

        {/* price */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 2 }}>
          <span style={{ fontSize: '2.4rem', fontWeight: 300, color: '#e2e8f0', letterSpacing: '-0.02em', lineHeight: 1 }}>
            {plan.price}
          </span>
          <span style={{ fontSize: 12, color: '#334155' }}>{plan.priceSub}</span>
        </div>

        {/* tagline + desc */}
        <div style={{ fontSize: 14, fontWeight: 500, color: '#e2e8f0', marginTop: 12, marginBottom: 3, lineHeight: 1.3 }}>
          {plan.tagline}
        </div>
        <div style={{ fontSize: 12, color: '#475569', marginBottom: 20, lineHeight: 1.5 }}>
          {plan.desc}
        </div>

        {/* "everything in X +" */}
        {plan.prev && (
          <div style={{
            fontSize: 11, fontFamily: 'var(--font-mono)', color: accentColor,
            background: `${accentColor}0d`, border: `1px solid ${accentColor}22`,
            borderRadius: 6, padding: '5px 10px', marginBottom: 16,
          }}>
            {plan.prev}
          </div>
        )}

        {/* features */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          {plan.features.map((f, i) => {
            if (f && typeof f === 'object' && f.section) {
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  margin: i === 0 ? '0 0 8px' : '12px 0 8px',
                }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.1em', flexShrink: 0 }}>
                    {f.section}
                  </span>
                  <div style={{ flex: 1, height: 1, background: '#1e2535' }} />
                </div>
              )
            }
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: accentColor, marginTop: 2, flexShrink: 0 }}>✓</span>
                <span style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.4 }}>{f}</span>
              </div>
            )
          })}
        </div>

        {/* divider */}
        <div style={{ borderTop: '1px solid #1e2535', margin: '24px 0' }} />

        {/* cta */}
        {plan.ctaStyle === 'primary' ? (
          <Link href={plan.ctaHref} style={{
            display: 'block', textAlign: 'center', padding: '11px 20px',
            borderRadius: 10, fontSize: 13, fontWeight: 500,
            background: '#3b82f6', color: '#fff', border: '1px solid transparent',
            transition: 'opacity 0.15s',
          }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.88'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
            {plan.cta}
          </Link>
        ) : plan.ctaStyle === 'premium' ? (
          <a href={plan.ctaHref} style={{
            display: 'block', textAlign: 'center', padding: '11px 20px',
            borderRadius: 10, fontSize: 13, fontWeight: 500,
            background: 'rgba(129,140,248,0.1)', color: '#818cf8',
            border: '1px solid rgba(129,140,248,0.3)',
            transition: 'all 0.15s',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(129,140,248,0.16)'; e.currentTarget.style.borderColor = 'rgba(129,140,248,0.5)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(129,140,248,0.1)'; e.currentTarget.style.borderColor = 'rgba(129,140,248,0.3)' }}>
            {plan.cta}
          </a>
        ) : (
          <Link href={plan.ctaHref} style={{
            display: 'block', textAlign: 'center', padding: '11px 20px',
            borderRadius: 10, fontSize: 13, fontWeight: 500,
            background: 'transparent', color: '#e2e8f0', border: '1px solid #1e2535',
            transition: 'all 0.15s',
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#243047'; e.currentTarget.style.color = '#e2e8f0' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#1e2535'; e.currentTarget.style.color = '#e2e8f0' }}>
            {plan.cta}
          </Link>
        )}
      </div>
    </div>
  )
}

function EnterpriseBanner() {
  const [hovered, setHovered] = useState(false)
  const features = [
    'sso / saml', 'dedicated onboarding',
    'custom models + integrations', 'private deployments',
    'white glove support', 'custom source ingestion',
    'executive dashboards', 'deployment flexibility',
    'dedicated slack channel', 'custom compliance',
  ]
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        marginTop: 10,
        background: '#0d0f1a',
        border: `1px solid ${hovered ? 'rgba(245,158,11,0.35)' : 'rgba(245,158,11,0.15)'}`,
        borderRadius: 14,
        padding: '28px 32px',
        display: 'flex', alignItems: 'center', gap: 40, flexWrap: 'wrap',
        transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
        boxShadow: hovered ? '0 0 60px rgba(245,158,11,0.06)' : 'none',
      }}
    >
      <div style={{ flex: '1 1 260px' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.18em', marginBottom: 10 }}>
          enterprise
        </div>
        <div style={{ fontSize: '1.5rem', fontWeight: 300, color: '#e2e8f0', letterSpacing: '-0.01em', lineHeight: 1.2, marginBottom: 8 }}>
          built around your operations.
        </div>
        <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.6 }}>
          $10k–100k+/year · custom pricing
        </div>
        <div style={{ fontSize: 12, color: '#334155', marginTop: 4, lineHeight: 1.5 }}>
          for airlines, large marketplaces, fintech, and enterprise ops at scale.
        </div>
      </div>

      <div style={{ flex: '1 1 320px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 28px' }}>
        {features.map((f, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: '#f59e0b', flexShrink: 0 }}>✓</span>
            <span style={{ fontSize: 12, color: '#64748b' }}>{f}</span>
          </div>
        ))}
      </div>

      <div style={{ flexShrink: 0, alignSelf: 'center' }}>
        <a href="mailto:hello@getspill.io" style={{
          display: 'block', padding: '12px 24px', whiteSpace: 'nowrap',
          background: 'rgba(245,158,11,0.08)', color: '#f59e0b',
          border: '1px solid rgba(245,158,11,0.25)', borderRadius: 10,
          fontSize: 13, fontWeight: 500, transition: 'all 0.15s',
        }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(245,158,11,0.14)'; e.currentTarget.style.borderColor = 'rgba(245,158,11,0.45)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(245,158,11,0.08)'; e.currentTarget.style.borderColor = 'rgba(245,158,11,0.25)' }}>
          let&apos;s talk →
        </a>
      </div>
    </div>
  )
}

function LiveFeedStrip() {
  const items = [
    { score: 87, src: 'reddit',  cat: 'delivery failure',   color: '#f87171', text: 'why is my order 3 hours late' },
    { score: 74, src: 'twitter', cat: 'support spike',      color: '#818cf8', text: '@brand no one is picking up' },
    { score: 61, src: 'hn',      cat: 'competitor mention', color: '#818cf8', text: 'how startups are handling ops at scale' },
    { score: 44, src: 'news',    cat: 'regulatory',         color: '#60a5fa', text: 'food app growth slows in tier-2 cities' },
    { score: 82, src: 'play',    cat: 'payment issue',      color: '#f87171', text: '★★☆☆☆ charged twice, no refund' },
    { score: 28, src: 'reddit',  cat: 'positive coverage',  color: '#4ade80', text: 'delivery was actually early today' },
  ]
  return (
    <div style={{ background: '#0d0f1a', border: '1px solid #1e2535', borderRadius: 12, overflow: 'hidden', boxShadow: '0 0 60px rgba(59,130,246,0.06)' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #1e2535', display: 'flex', alignItems: 'center', gap: 10, background: '#13161f' }}>
        <span className="live-dot" style={{ width: 6, height: 6 }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#64748b' }}>live signal feed</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#334155' }}>{items.length} signals · 3 escalated</span>
      </div>
      {items.map((item, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '9px 16px', borderBottom: i < items.length - 1 ? '1px solid #1e2535' : 'none',
          borderLeft: `2px solid ${item.score >= 60 ? item.color + '80' : 'transparent'}`,
          animation: `fadeIn 0.4s ${i * 0.08}s ease both`,
        }}>
          <div style={{
            width: 32, height: 18, borderRadius: 99, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-mono)', fontSize: 10.5,
            color: scoreColor(item.score), background: scoreBg(item.score),
          }}>{item.score}</div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#334155', flexShrink: 0, minWidth: 40 }}>{item.src}</span>
          <span style={{ flex: 1, fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.text}</span>
          <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 99, flexShrink: 0, color: item.color, background: `${item.color}12`, border: `1px solid ${item.color}44` }}>{item.cat}</span>
        </div>
      ))}
    </div>
  )
}

function ComparisonSection() {
  return (
    <section style={{ padding: '120px 24px', background: '#080a12' }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 20 }}>
          reality check
        </div>
        <div style={{ fontSize: 'clamp(1.8rem, 4vw, 2.6rem)', fontWeight: 300, color: '#e2e8f0', letterSpacing: '-0.02em', marginBottom: 8 }}>
          still checking reddit manually?
        </div>
        <div style={{ fontSize: '1rem', color: '#64748b', marginBottom: 60, lineHeight: 1.6 }}>
          your ops team deserves better tooling than 12 open browser tabs.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          <div style={{ background: '#13161f', border: '1px solid #1e2535', borderRadius: '10px 0 0 0', padding: '14px 20px' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em' }}>manual monitoring</div>
          </div>
          <div style={{ background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.25)', borderLeft: 'none', borderRadius: '0 10px 0 0', padding: '14px 20px' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '0.1em' }}>spill</div>
          </div>
          {COMPARISON.map((row, i) => {
            const isLast = i === COMPARISON.length - 1
            return (
              <>
                <div key={`m-${i}`} style={{ background: '#13161f', border: '1px solid #1e2535', borderTop: 'none', borderRadius: isLast ? '0 0 0 10px' : 0, padding: '14px 20px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ fontSize: 11, color: '#334155', flexShrink: 0, marginTop: 1 }}>✗</span>
                  <span style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.5 }}>{row.manual}</span>
                </div>
                <div key={`s-${i}`} style={{ background: 'rgba(59,130,246,0.04)', border: '1px solid rgba(59,130,246,0.2)', borderTop: 'none', borderLeft: 'none', borderRadius: isLast ? '0 0 10px 0' : 0, padding: '14px 20px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
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
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 20 }}>faq</div>
        <div style={{ fontSize: '2.2rem', fontWeight: 300, color: '#e2e8f0', letterSpacing: '-0.01em', marginBottom: 48 }}>the obvious questions.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {FAQS.map((faq, i) => {
            const isOpen = openIdx === i
            return (
              <div key={i} style={{ background: isOpen ? '#13161f' : 'transparent', border: '1px solid #1e2535', borderRadius: 10, overflow: 'hidden', transition: 'background 0.15s', marginBottom: 2 }}>
                <button
                  onClick={() => setOpenIdx(isOpen ? null : i)}
                  style={{ width: '100%', textAlign: 'left', padding: '16px 20px', background: 'none', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  <span style={{ fontSize: 13.5, fontWeight: 500, color: isOpen ? '#e2e8f0' : '#94a3b8', lineHeight: 1.4 }}>{faq.q}</span>
                  <span style={{ fontSize: 11, color: '#334155', flexShrink: 0, display: 'inline-block', transition: 'transform 0.2s ease', transform: isOpen ? 'rotate(180deg)' : 'none' }}>▾</span>
                </button>
                {isOpen && (
                  <div style={{ padding: '0 20px 18px', fontSize: 13, color: '#64748b', lineHeight: 1.7, animation: 'fadeUp 0.15s ease both' }}>
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
    <footer style={{ background: '#080a12', borderTop: '1px solid #1e2535', padding: '32px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
      <Link href="/" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#334155', letterSpacing: '0.1em' }}>spill</Link>
      <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
        <a href="/#how" style={{ fontSize: 12, color: '#334155', transition: 'color 0.12s' }} onMouseEnter={e => e.currentTarget.style.color = '#64748b'} onMouseLeave={e => e.currentTarget.style.color = '#334155'}>how it works</a>
        <Link href="/pricing" style={{ fontSize: 12, color: '#334155', transition: 'color 0.12s' }} onMouseEnter={e => e.currentTarget.style.color = '#64748b'} onMouseLeave={e => e.currentTarget.style.color = '#334155'}>pricing</Link>
        <Link href="/login" style={{ fontSize: 12, color: '#334155', transition: 'color 0.12s' }} onMouseEnter={e => e.currentTarget.style.color = '#64748b'} onMouseLeave={e => e.currentTarget.style.color = '#334155'}>login</Link>
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
        minHeight: '60vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', background: '#080a12',
      }}>
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse 700px 400px at 50% 30%, rgba(59,130,246,0.06) 0%, transparent 70%)' }} />

        {mounted && FLOAT_CARDS.map((card, i) => (
          <div key={i} style={{
            position: 'absolute', left: `${card.x}%`, bottom: 0,
            fontFamily: 'var(--font-mono)', fontSize: 11,
            color: '#64748b', background: '#13161f',
            border: '1px solid #1e2535', borderRadius: 8, padding: '4px 10px',
            whiteSpace: 'nowrap', pointerEvents: 'none', opacity: card.op,
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
            internet operations<br />
            <span style={{ color: '#3b82f6' }}>infrastructure.</span>
          </h1>
          <p style={{ margin: '20px auto 0', fontSize: '1.05rem', color: '#64748b', lineHeight: 1.65, maxWidth: 500 }}>
            spill is not social listening. plans reflect how operationally sophisticated your company is — not how many mentions you track.
          </p>
          <div style={{ marginTop: 12, fontFamily: 'var(--font-mono)', fontSize: 11, color: '#334155' }}>
            no per-mention charges · no seat traps · no vanity metrics
          </div>
        </div>
      </section>

      {/* Pricing cards */}
      <section style={{ padding: '0 24px 100px', background: '#080a12' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          {/* Tier progression */}
          <div style={{ marginBottom: 32 }}>
            <TierProgression />
          </div>

          {/* Trial banner */}
          <TrialBanner />

          {/* 3 plan cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
            {PLANS.map(plan => <PricingCard key={plan.key} plan={plan} />)}
          </div>

          {/* Enterprise banner */}
          <EnterpriseBanner />

          <div style={{
            marginTop: 24,
            background: 'rgba(59,130,246,0.04)',
            border: '1px solid rgba(59,130,246,0.12)',
            borderRadius: 10,
            padding: '14px 20px',
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            justifyContent: 'center',
          }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#3b82f6', whiteSpace: 'nowrap' }}>
              all plans include:
            </span>
            {['shared workspace', 'team invites', 'email alerts', 'Google Sheets integration', 'AI categorization', 'onboarding support'].map((item, i, arr) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 12, color: '#64748b' }}>{item}</span>
                {i < arr.length - 1 && <span style={{ color: '#1e2535', fontSize: 10 }}>·</span>}
              </span>
            ))}
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
            the ops feed your team can&apos;t close.
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

      {/* How to choose */}
      <section style={{ padding: '60px 24px 100px', background: '#080a12' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 20 }}>
            how to choose
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 300, color: '#e2e8f0', letterSpacing: '-0.01em', marginBottom: 48 }}>
            different operational problems.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {[
              {
                when: "you're a startup or lean team who needs to catch brand fires early",
                tier: 'monitor', tierColor: '#60a5fa',
                desc: "realtime monitoring across reddit, news, reviews, and x/twitter. ai-scored feed. shared workspace with your team. 30-day signal history. no ops overhead — just awareness.",
              },
              {
                when: "your ops team is handling incidents and needs to coordinate around them",
                tier: 'coordinate', tierColor: '#3b82f6',
                desc: "query ownership, escalation lifecycle, saved views, and multi-team workflows. this is where 'who saw it' becomes 'who owns it, and what happened next.'",
              },
              {
                when: "you need an internet incident management layer, not just monitoring",
                tier: 'command center', tierColor: '#818cf8',
                desc: "ticketing queues, incident war rooms, SLA tracking, escalation hierarchies, and executive reporting. zendesk + pagerduty + social intelligence in one ops surface.",
              },
              {
                when: "you're an airline, marketplace, or enterprise brand with custom compliance and deployment needs",
                tier: 'enterprise', tierColor: '#f59e0b',
                desc: "sso, private deployments, custom models, dedicated onboarding, and white-glove support. we build around your org structure.",
              },
            ].map((item, i) => (
              <div key={i} style={{ padding: '18px 20px', background: '#0d0f1a', border: '1px solid #1e2535', borderRadius: 10, display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 2 }}>
                <div style={{ flexShrink: 0, paddingTop: 2 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, padding: '2px 8px', borderRadius: 99, color: item.tierColor, background: `${item.tierColor}14`, border: `1px solid ${item.tierColor}40`, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                    {item.tier}
                  </span>
                </div>
                <div>
                  <div style={{ fontSize: 13.5, color: '#94a3b8', fontWeight: 500, marginBottom: 4 }}>{item.when}</div>
                  <div style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.5 }}>{item.desc}</div>
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
            <Link href="/onboarding" style={{ display: 'inline-block', padding: '13px 28px', background: '#3b82f6', color: '#fff', borderRadius: 10, fontSize: 14, fontWeight: 500, transition: 'opacity 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.88'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
              start 7-day trial →
            </Link>
            <a href="mailto:hello@getspill.io" style={{ display: 'inline-block', padding: '13px 28px', background: 'transparent', color: '#64748b', border: '1px solid #1e2535', borderRadius: 10, fontSize: 14, transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#243047'; e.currentTarget.style.color = '#94a3b8' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#1e2535'; e.currentTarget.style.color = '#64748b' }}>
              talk to us
            </a>
          </div>
          <div style={{ marginTop: 16, fontFamily: 'var(--font-mono)', fontSize: 11, color: '#334155' }}>
            7 days free · all features · no credit card required
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
