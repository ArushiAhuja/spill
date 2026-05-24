'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api'
import { setToken, setUser } from '@/lib/auth'

function EyeIcon({ open }) {
  return open ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  )
}

const BG_CARDS = [
  { text: 'reddit · is anyone else having issues today?',        x: 8,  dur: 13, delay: 0,   opacity: 0.14 },
  { text: 'hn · show hn: tracking brand mentions at scale',      x: 22, dur: 16, delay: 2,   opacity: 0.12 },
  { text: 'twitter · @brand this is unacceptable',               x: 40, dur: 11, delay: 4,   opacity: 0.15 },
  { text: 'news · backlash spreading across social platforms',   x: 58, dur: 14, delay: 1,   opacity: 0.12 },
  { text: 'play store · 2★ customer support never replied',      x: 72, dur: 9,  delay: 3,   opacity: 0.14 },
  { text: 'reddit · caught this before it became a headline',    x: 84, dur: 17, delay: 0.5, opacity: 0.13 },
  { text: 'hn · the ops team left the dashboard open all day',   x: 12, dur: 12, delay: 6,   opacity: 0.12 },
  { text: 'twitter · 3 of my friends had the same bad experience',x: 50, dur: 15, delay: 5,  opacity: 0.14 },
]

export default function SignupPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('spill_token')
    if (token) router.replace('/orgs')
  }, [router])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await api.signup({ name, email, password })
      setToken(data.token)
      setUser(data.user)
      router.push('/onboarding')
    } catch (err) {
      setError(err.message || 'something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#080a12',
      position: 'relative',
      overflow: 'hidden',
      padding: '24px',
    }}>
      {/* floating background cards */}
      {BG_CARDS.map((card, i) => (
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
          zIndex: 0,
        }}>
          {card.text}
        </div>
      ))}

      {/* background radial glow */}
      <div style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 500,
        height: 400,
        background: 'radial-gradient(ellipse 500px 400px at 50% 50%, rgba(59,130,246,0.05) 0%, transparent 70%)',
        pointerEvents: 'none',
        zIndex: 0,
      }} />

      {/* form content */}
      <div style={{
        position: 'relative',
        zIndex: 10,
        width: '100%',
        maxWidth: 360,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}>
        {/* wordmark */}
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '1.4rem',
          fontWeight: 300,
          letterSpacing: '0.3em',
          color: '#94a3b8',
          marginBottom: 48,
          textAlign: 'center',
        }}>
          spill
        </div>

        {/* headline */}
        <div style={{
          fontSize: '2rem',
          fontWeight: 300,
          color: '#e2e8f0',
          marginBottom: 8,
          letterSpacing: '-0.01em',
          textAlign: 'center',
          width: '100%',
        }}>
          start watching.
        </div>
        <div style={{
          fontSize: 13,
          color: '#475569',
          marginBottom: 36,
          textAlign: 'center',
        }}>
          the internet is moving fast. catch up.
        </div>

        {/* form */}
        <form
          onSubmit={handleSubmit}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            width: '100%',
          }}
        >
          <div>
            <div style={{
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
              color: '#475569',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginBottom: 6,
            }}>
              name
            </div>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="your name"
              required
              autoFocus
              autoComplete="name"
            />
          </div>

          <div>
            <div style={{
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
              color: '#475569',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginBottom: 6,
            }}>
              email
            </div>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              autoComplete="email"
            />
          </div>

          <div>
            <div style={{
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
              color: '#475569',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginBottom: 6,
            }}>
              password
            </div>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                autoComplete="new-password"
                minLength={8}
                style={{ paddingRight: 40 }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(p => !p)}
                tabIndex={-1}
                style={{
                  position: 'absolute',
                  right: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#475569',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'color 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.color = '#94a3b8'}
                onMouseLeave={e => e.currentTarget.style.color = '#475569'}
              >
                <EyeIcon open={showPassword} />
              </button>
            </div>
          </div>

          {error && (
            <div style={{
              fontSize: 12.5,
              color: '#f87171',
              padding: '10px 14px',
              background: 'rgba(248,113,113,0.08)',
              borderRadius: 8,
              border: '1px solid rgba(248,113,113,0.2)',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 8,
              width: '100%',
              padding: '12px 20px',
              background: loading ? '#1e2535' : '#3b82f6',
              color: loading ? '#334155' : '#fff',
              border: 'none',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 500,
              fontFamily: 'inherit',
              transition: 'all 0.15s ease',
              cursor: loading ? 'not-allowed' : 'pointer',
              letterSpacing: '0.01em',
            }}
          >
            {loading ? 'creating account...' : 'create account →'}
          </button>
        </form>

        <div style={{
          marginTop: 28,
          textAlign: 'center',
          fontSize: 12.5,
          color: '#334155',
        }}>
          already have an account?{' '}
          <Link href="/login" style={{ color: '#3b82f6' }}>
            sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
