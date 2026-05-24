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
  { text: 'reddit · delivery was 45 mins late and cold',        x: 5,  dur: 14, delay: 0,   opacity: 0.14 },
  { text: 'hn · show hn: we got hit by a viral complaint',      x: 20, dur: 11, delay: 3,   opacity: 0.12 },
  { text: 'twitter · @brand this is unacceptable',              x: 38, dur: 16, delay: 1.5, opacity: 0.15 },
  { text: 'news · startup faces backlash after product launch', x: 55, dur: 13, delay: 5,   opacity: 0.12 },
  { text: 'play store · 1★ app crashed lost my order',          x: 70, dur: 9,  delay: 2,   opacity: 0.14 },
  { text: 'reddit · is anyone else having issues today?',       x: 82, dur: 18, delay: 0.5, opacity: 0.13 },
  { text: 'hn · quiet internet day. suspicious.',               x: 14, dur: 12, delay: 7,   opacity: 0.12 },
  { text: 'twitter · why is nobody talking about this',         x: 60, dur: 15, delay: 4,   opacity: 0.14 },
]

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showForgot, setShowForgot] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('spill_token')
    if (token) router.replace('/orgs')
  }, [router])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await api.login({ email, password })
      setToken(data.token)
      setUser(data.user)
      router.push('/orgs')
    } catch (err) {
      setError(err.message || 'check your credentials and try again')
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
          welcome back.
        </div>
        <div style={{
          fontSize: 13,
          color: '#475569',
          marginBottom: 36,
          textAlign: 'center',
        }}>
          something&apos;s probably happening right now.
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
              email
            </div>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              autoFocus
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
                autoComplete="current-password"
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
            {loading ? 'signing in...' : 'sign in →'}
          </button>
        </form>

        <div style={{
          marginTop: 28,
          textAlign: 'center',
          fontSize: 12.5,
          color: '#334155',
        }}>
          no account?{' '}
          <Link href="/signup" style={{ color: '#3b82f6' }}>
            sign up
          </Link>
        </div>

        <button
          onClick={() => setShowForgot(f => !f)}
          style={{
            marginTop: 12,
            background: 'none',
            border: 'none',
            color: '#334155',
            fontSize: 12,
            cursor: 'pointer',
            fontFamily: 'inherit',
            padding: 0,
            transition: 'color 0.12s',
          }}
          onMouseEnter={e => e.currentTarget.style.color = '#64748b'}
          onMouseLeave={e => e.currentTarget.style.color = '#334155'}
        >
          forgot password?
        </button>

        {showForgot && (
          <div style={{
            marginTop: 12,
            padding: '12px 16px',
            background: '#13161f',
            border: '1px solid #1e2535',
            borderRadius: 10,
            fontSize: 12.5,
            color: '#64748b',
            textAlign: 'center',
            lineHeight: 1.6,
            maxWidth: 320,
          }}>
            password reset isn&apos;t self-serve yet.{' '}
            <span style={{ color: '#94a3b8' }}>email the workspace owner</span>
            {' '}or reach out to the person who invited you.
          </div>
        )}
      </div>
    </div>
  )
}
