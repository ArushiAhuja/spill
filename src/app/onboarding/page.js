'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'

const SOURCES = [
  { id: 'reddit', label: 'Reddit', icon: '●', color: '#f87171', desc: 'posts, comments & AMAs' },
  { id: 'hackernews', label: 'Hacker News', icon: '▲', color: '#3b82f6', desc: 'show HN, ask HN, discussions' },
  { id: 'google_news', label: 'Google News', icon: '◆', color: '#4ade80', desc: 'news articles & press' },
  { id: 'twitter', label: 'Twitter / X', icon: '✕', color: '#60a5fa', desc: 'tweets and threads' },
  { id: 'playstore', label: 'Play Store', icon: '▶', color: '#9b8ff7', desc: 'app reviews' },
  { id: 'youtube', label: 'YouTube', icon: '▷', color: '#f87171', desc: 'comments — coming soon', disabled: true },
]

const INTEGRATIONS = [
  { id: 'gmail', label: 'Gmail', icon: '✉', desc: 'get email alerts on escalations' },
  { id: 'sheets', label: 'Google Sheets', icon: '◻', desc: 'auto-log everything to a spreadsheet' },
  { id: 'reddit_api', label: 'Reddit API', icon: '●', desc: 'higher rate limits, more posts' },
  { id: 'twitter_api', label: 'Twitter / X', icon: '✕', desc: 'tweets and threads (needs bearer token)' },
]

function toSlug(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 6)
}

function ProgressBar({ step, total = 6 }) {
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 48 }}>
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: 3,
            borderRadius: 99,
            background: i < step ? '#3b82f6' : '#1e2535',
            transition: 'background 0.3s ease',
            opacity: i === step - 1 ? 1 : i < step ? 0.6 : 0.4,
          }}
        />
      ))}
    </div>
  )
}

function SourceCard({ source, selected, onToggle }) {
  return (
    <button
      onClick={() => !source.disabled && onToggle(source.id)}
      disabled={source.disabled}
      style={{
        textAlign: 'left',
        padding: '14px 16px',
        borderRadius: 10,
        border: `1px solid ${selected ? source.color + '66' : '#1e2535'}`,
        background: selected ? source.color + '12' : '#13161f',
        opacity: source.disabled ? 0.35 : 1,
        cursor: source.disabled ? 'not-allowed' : 'pointer',
        transition: 'all 0.15s ease',
        boxShadow: selected ? `0 0 0 1px ${source.color}33` : 'none',
        position: 'relative',
      }}
    >
      {/* toggle indicator */}
      <div style={{ position: 'absolute', top: 12, right: 12 }}>
        <div className={`toggle-track ${selected ? 'on' : ''}`}>
          <div className="toggle-thumb" />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, paddingRight: 44 }}>
        <span style={{ fontSize: 13, color: source.color }}>{source.icon}</span>
        <span style={{ fontSize: 13.5, fontWeight: 500, color: '#e2e8f0' }}>{source.label}</span>
      </div>
      <div style={{ fontSize: 12, color: '#64748b' }}>{source.desc}</div>
    </button>
  )
}

function CategoryLine({ cat, delay }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), delay)
    return () => clearTimeout(t)
  }, [delay])

  if (!visible) return null

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 0',
        borderBottom: '1px solid #1e2535',
        animation: 'slideIn 0.2s ease both',
      }}
    >
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: cat.color || '#3b82f6', flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: '#e2e8f0' }}>{cat.name}</span>
        <span style={{ fontSize: 12, color: '#64748b', marginLeft: 10 }}>{cat.description}</span>
      </div>
      <div style={{
        fontSize: 11,
        color: cat.severity >= 20 ? '#f87171' : cat.severity >= 10 ? '#818cf8' : '#334155',
        background: cat.severity >= 20 ? 'rgba(248,113,113,0.1)' : cat.severity >= 10 ? 'rgba(129,140,248,0.1)' : '#191d2b',
        padding: '2px 8px',
        borderRadius: 99,
        border: `1px solid ${cat.severity >= 20 ? 'rgba(248,113,113,0.25)' : cat.severity >= 10 ? 'rgba(129,140,248,0.25)' : '#1e2535'}`,
      }}>
        {cat.severity >= 20 ? 'critical' : cat.severity >= 10 ? 'high' : 'low'}
      </div>
    </div>
  )
}

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [loadingMsg, setLoadingMsg] = useState('setting up your workspace...')
  const [allVisible, setAllVisible] = useState(false)

  const [formData, setFormData] = useState({
    name: '',
    website: '',
    description: '',
    competitors: '',
    industryMonitoring: false,
    industryKeywords: '',
  })
  const [selectedSources, setSelectedSources] = useState(new Set(['reddit', 'hackernews', 'google_news']))
  const [onboardResult, setOnboardResult] = useState(null)
  const [createdSlug, setCreatedSlug] = useState('')

  useEffect(() => {
    const token = localStorage.getItem('spill_token')
    if (!token) router.replace('/login')
  }, [router])

  // when step 4 loads, trigger the "all visible" after all categories animate in
  useEffect(() => {
    if (step === 4 && onboardResult?.categories) {
      setAllVisible(false)
      const totalDelay = onboardResult.categories.length * 180 + 600
      const t = setTimeout(() => setAllVisible(true), totalDelay)
      return () => clearTimeout(t)
    }
  }, [step, onboardResult])

  function toggleSource(id) {
    setSelectedSources(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Separated so a retry after onboard timeout skips org creation (org already exists)
  async function runOnboard(slug) {
    setError('')
    setLoading(true)
    setLoadingMsg('connecting sources...')
    try {
      const allSourceIds = SOURCES.filter(s => !s.disabled).map(s => s.id)
      await Promise.all(
        allSourceIds.map(s =>
          api.updateSource(slug, s, { enabled: selectedSources.has(s) })
        )
      )
      setLoadingMsg('building your categories...')
      const result = await api.onboard(slug)
      setOnboardResult(result)
      setStep(4)
    } catch (err) {
      // Org was already created — show a retry that goes straight to the onboard step
      setError((err.message || 'something went wrong') + ' — tap retry to try again.')
    } finally {
      setLoading(false)
      setLoadingMsg('setting up your workspace...')
    }
  }

  async function handleGenerate() {
    setError('')
    setLoading(true)
    setAllVisible(false)

    // If org was already created in a previous failed attempt, skip straight to onboard
    if (createdSlug) {
      await runOnboard(createdSlug)
      return
    }

    const competitorsList = formData.competitors
      ? formData.competitors.split(',').map(s => s.trim()).filter(Boolean)
      : []

    let org = null
    let slug = toSlug(formData.name) || 'workspace'

    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const kwList = formData.industryKeywords
          .split(',').map(k => k.trim()).filter(Boolean)
        org = await api.createOrg({
          name: formData.name,
          slug: attempt === 0 ? slug : `${slug}-${randomSuffix()}`,
          website: formData.website,
          description: formData.description,
          competitors: competitorsList,
          industry_monitoring: formData.industryMonitoring,
          industry_keywords: kwList,
        })
        slug = org.slug || slug
        break
      } catch (err) {
        const msg = (err.message || '').toLowerCase()
        const isConflict = msg.includes('already') || msg.includes('unique') || msg.includes('exist') || msg.includes('duplicate')
        if (!isConflict || attempt === 3) {
          setError('could not create workspace. please try again.')
          setLoading(false)
          return
        }
      }
    }

    if (!org) {
      setError('something went wrong.')
      setLoading(false)
      return
    }

    // Persist slug before calling onboard — if onboard fails, retry reuses this slug
    setCreatedSlug(slug)
    setLoading(false)
    await runOnboard(slug)
  }

  const container = {
    minHeight: '100vh',
    background: '#0d0f1a',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
  }
  const inner = { width: '100%', maxWidth: 540 }

  const btnPrimary = {
    padding: '11px 28px',
    background: '#3b82f6',
    color: '#0d0f1a',
    border: 'none',
    borderRadius: 10,
    fontSize: 13.5,
    fontWeight: 500,
    fontFamily: 'inherit',
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  }

  const btnBack = {
    background: 'none',
    border: 'none',
    color: '#64748b',
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: 'inherit',
  }

  return (
    <div style={container}>
      <div style={inner}>
        <ProgressBar step={step} />

        {/* Step 1: website + name */}
        {step === 1 && (
          <div style={{ animation: 'fadeUp 0.5s ease both' }}>
            <div style={{ marginBottom: 36 }}>
              <div style={{ fontSize: 22, fontWeight: 500, color: '#e2e8f0', marginBottom: 8 }}>
                your company's website
              </div>
              <div style={{ fontSize: 13, color: '#64748b' }}>
                we'll use this as a starting point for your setup
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <input
                type="text"
                value={formData.website}
                onChange={e => setFormData(f => ({ ...f, website: e.target.value }))}
                placeholder="https://yourcompany.com"
                autoFocus
                style={{ fontSize: 15 }}
              />
            </div>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
                company name
              </div>
              <input
                type="text"
                value={formData.name}
                onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
                placeholder="Acme Corp"
              />
            </div>
            <button
              onClick={() => { setError(''); if (formData.name.trim().length >= 2) setStep(2) }}
              disabled={formData.name.trim().length < 2}
              style={{ ...btnPrimary, opacity: formData.name.trim().length < 2 ? 0.3 : 1 }}
            >
              continue →
            </button>
          </div>
        )}

        {/* Step 2: describe */}
        {step === 2 && (
          <div style={{ animation: 'fadeUp 0.5s ease both' }}>
            <div style={{ marginBottom: 36 }}>
              <div style={{ fontSize: 22, fontWeight: 500, color: '#e2e8f0', marginBottom: 8 }}>
                what do they do?
              </div>
              <div style={{ fontSize: 13, color: '#64748b' }}>
                be specific — the more context you give, the sharper the monitoring.
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <textarea
                rows={6}
                value={formData.description}
                onChange={e => setFormData(f => ({ ...f, description: e.target.value }))}
                placeholder="We build software that helps companies track and respond to online mentions in real time..."
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 11, color: '#334155', marginTop: 4 }}>
                {formData.description.split(/\s+/).filter(Boolean).length} / 200 words
              </div>
            </div>
            <div style={{ marginBottom: 32 }}>
              <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
                competitors (optional)
              </div>
              <input
                type="text"
                value={formData.competitors}
                onChange={e => setFormData(f => ({ ...f, competitors: e.target.value }))}
                placeholder="Competitor A, Competitor B"
              />
              <div style={{ fontSize: 11, color: '#334155', marginTop: 4 }}>comma separated</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <button onClick={() => setStep(1)} style={btnBack}>← back</button>
              <button
                onClick={() => { setError(''); if (formData.description.trim().length >= 10) setStep(3) }}
                disabled={formData.description.trim().length < 10}
                style={{ ...btnPrimary, opacity: formData.description.trim().length < 10 ? 0.3 : 1 }}
              >
                continue →
              </button>
            </div>
          </div>
        )}

        {/* Step 3: sources */}
        {step === 3 && (
          <div style={{ animation: 'fadeUp 0.5s ease both' }}>
            <div style={{ marginBottom: 36 }}>
              <div style={{ fontSize: 22, fontWeight: 500, color: '#e2e8f0', marginBottom: 8 }}>
                what do you want to watch?
              </div>
              <div style={{ fontSize: 13, color: '#64748b' }}>
                toggle what matters to you. you can change this anytime.
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              {SOURCES.map(source => (
                <SourceCard
                  key={source.id}
                  source={source}
                  selected={selectedSources.has(source.id)}
                  onToggle={toggleSource}
                />
              ))}
            </div>

            {/* Industry monitoring toggle */}
            <div style={{
              padding: '14px 16px',
              borderRadius: 10,
              border: `1px solid ${formData.industryMonitoring ? 'rgba(59,130,246,0.3)' : '#1e2535'}`,
              background: formData.industryMonitoring ? 'rgba(59,130,246,0.05)' : '#13161f',
              marginBottom: 32,
              transition: 'all 0.15s ease',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 500, color: '#e2e8f0', marginBottom: 3 }}>
                    watch industry signals too
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
                    surface posts relevant to your space even when your brand isn't mentioned — e.g. "delivery delays" or "payment failures" without naming you specifically
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setFormData(f => ({ ...f, industryMonitoring: !f.industryMonitoring }))}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0, marginTop: 2 }}
                >
                  <div className={`toggle-track ${formData.industryMonitoring ? 'on' : ''}`}>
                    <div className="toggle-thumb" />
                  </div>
                </button>
              </div>
              {formData.industryMonitoring && (
                <div style={{ marginTop: 14, animation: 'fadeIn 0.2s ease both' }}>
                  <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
                    keywords to watch <span style={{ color: '#334155', textTransform: 'none', letterSpacing: 0 }}>(comma-separated)</span>
                  </div>
                  <input
                    type="text"
                    value={formData.industryKeywords}
                    onChange={e => setFormData(f => ({ ...f, industryKeywords: e.target.value }))}
                    placeholder="food delivery delay, driver cancelled, payment failed, order missing"
                  />
                  <div style={{ fontSize: 11, color: '#334155', marginTop: 5 }}>
                    posts matching any keyword surface even without your brand name
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div style={{ color: '#f87171', fontSize: 12.5, marginBottom: 16 }}>{error}</div>
            )}
            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#64748b', fontSize: 13 }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[0, 1, 2].map(i => (
                    <div
                      key={i}
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: '50%',
                        background: '#3b82f6',
                        animation: `pulseDot 1.2s ${i * 0.18}s ease-in-out infinite`,
                      }}
                    />
                  ))}
                </div>
                {loadingMsg}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <button onClick={() => setStep(2)} style={btnBack}>← back</button>
                <button
                  onClick={handleGenerate}
                  disabled={selectedSources.size === 0}
                  style={{ ...btnPrimary, opacity: selectedSources.size === 0 ? 0.3 : 1 }}
                >
                  set up monitoring →
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step 4: generating (terminal-style category reveal) */}
        {step === 4 && onboardResult && (
          <div style={{ animation: 'fadeUp 0.5s ease both' }}>
            <div style={{ marginBottom: 32 }}>
              <div style={{ fontSize: 22, fontWeight: 500, color: '#e2e8f0', marginBottom: 8 }}>
                building your setup
              </div>
              <div style={{ fontSize: 13, color: '#64748b' }}>
                we generated {onboardResult.categories?.length || 0} categories based on your company
              </div>
            </div>

            {/* terminal panel */}
            <div style={{
              background: '#13161f',
              border: '1px solid #1e2535',
              borderRadius: 10,
              padding: '16px 20px',
              marginBottom: 24,
              minHeight: 200,
            }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#334155', marginBottom: 12 }}>
                {'>'} analyzing company description...
              </div>
              {onboardResult.categories?.map((cat, i) => (
                <CategoryLine key={cat.id || cat.name || i} cat={cat} delay={i * 180 + 300} />
              ))}
              {allVisible && (
                <div style={{
                  marginTop: 12,
                  fontSize: 12,
                  color: '#4ade80',
                  fontFamily: 'var(--font-mono)',
                  animation: 'fadeIn 0.4s ease both',
                }}>
                  ✓ done. {onboardResult.categories?.length} categories configured.
                </div>
              )}
              {!allVisible && (
                <span style={{
                  animation: 'blink 1s step-end infinite',
                  color: '#3b82f6',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 13,
                }}>
                  █
                </span>
              )}
            </div>

            {allVisible && (
              <button
                onClick={() => setStep(5)}
                style={{ ...btnPrimary, animation: 'fadeUp 0.4s ease both' }}
              >
                looks good →
              </button>
            )}
          </div>
        )}

        {/* Step 5: connect tools */}
        {step === 5 && (
          <div style={{ animation: 'fadeUp 0.5s ease both' }}>
            <div style={{ marginBottom: 32 }}>
              <div style={{ fontSize: 22, fontWeight: 500, color: '#e2e8f0', marginBottom: 8 }}>
                connect your tools
              </div>
              <div style={{ fontSize: 13, color: '#64748b' }}>
                not required to start. you can configure these anytime in settings.
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 32 }}>
              {INTEGRATIONS.map(intg => (
                <div
                  key={intg.id}
                  style={{
                    padding: '14px 16px',
                    borderRadius: 10,
                    background: '#13161f',
                    border: '1px solid #1e2535',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 13, color: '#64748b' }}>{intg.icon}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 500, color: '#e2e8f0' }}>{intg.label}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>{intg.desc}</div>
                  <div style={{
                    fontSize: 11,
                    color: '#334155',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '3px 8px',
                    background: '#191d2b',
                    borderRadius: 99,
                    border: '1px solid #1e2535',
                  }}>
                    configure in settings
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <button onClick={() => setStep(4)} style={btnBack}>← back</button>
              <button onClick={() => setStep(6)} style={btnPrimary}>
                continue →
              </button>
            </div>
          </div>
        )}

        {/* Step 6: watching */}
        {step === 6 && (
          <div style={{ textAlign: 'center', animation: 'fadeUp 0.6s ease both' }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 32,
              padding: '6px 14px',
              background: 'rgba(74,222,128,0.08)',
              border: '1px solid rgba(74,222,128,0.2)',
              borderRadius: 99,
            }}>
              <div className="live-dot" />
              <span style={{ fontSize: 12, color: '#4ade80', letterSpacing: '0.05em' }}>live</span>
            </div>
            <div style={{
              fontSize: 36,
              fontWeight: 300,
              color: '#e2e8f0',
              letterSpacing: '-0.01em',
              marginBottom: 16,
              lineHeight: 1.1,
            }}>
              spill is watching.
            </div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 48 }}>
              monitoring {selectedSources.size} sources across {onboardResult?.categories?.length || 0} categories
            </div>
            <button
              onClick={() => router.push(`/${createdSlug}`)}
              style={{ ...btnPrimary, padding: '12px 32px', fontSize: 14 }}
            >
              open dashboard →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
