'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

function setToken(t) {
  if (typeof window !== 'undefined') localStorage.setItem('spill_token', t)
}
function setUser(u) {
  if (typeof window !== 'undefined') localStorage.setItem('spill_user', JSON.stringify(u))
}

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

export default function AcceptInvitePage({ params }) {
  const router = useRouter()
  const { token } = params

  const [state, setState] = useState('loading') // loading | ready | expired | revoked | accepted | error
  const [invite, setInvite] = useState(null)

  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function verify() {
      try {
        const res = await fetch(`/api/invite/${token}`)
        const data = await res.json()
        if (!res.ok) {
          setState('error')
          setError(data.error || 'invitation not found')
          return
        }
        if (data.accepted) {
          setState('accepted')
          setInvite(data)
          return
        }
        if (data.revoked) {
          setState('revoked')
          return
        }
        if (data.expired) {
          setState('expired')
          setInvite(data)
          return
        }
        setInvite(data)
        setState('ready')
      } catch {
        setState('error')
        setError('could not load invitation')
      }
    }
    verify()
  }, [token])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const body = invite.userExists ? { password } : { name, password }
      const res = await fetch(`/api/invite/${token}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'something went wrong')
        return
      }
      setToken(data.token)
      setUser(data.user)
      router.replace(`/${data.org.slug}`)
    } catch {
      setError('something went wrong — please try again')
    } finally {
      setSubmitting(false)
    }
  }

  const inputLabel = {
    fontSize: 10,
    fontFamily: 'var(--font-mono)',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    marginBottom: 6,
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#080a12',
      padding: '24px',
    }}>
      {/* background glow */}
      <div style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 500, height: 400,
        background: 'radial-gradient(ellipse 500px 400px at 50% 50%, rgba(59,130,246,0.05) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      <div style={{
        position: 'relative', zIndex: 10,
        width: '100%', maxWidth: 360,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
      }}>
        {/* wordmark */}
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '1.4rem', fontWeight: 300,
          letterSpacing: '0.3em', color: '#94a3b8',
          marginBottom: 48, textAlign: 'center',
        }}>
          spill
        </div>

        {state === 'loading' && (
          <div style={{ display: 'flex', gap: 5 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                width: 5, height: 5, borderRadius: '50%', background: '#3b82f6',
                animation: `pulseDot 1.2s ${i * 0.18}s ease-in-out infinite`,
              }} />
            ))}
          </div>
        )}

        {state === 'expired' && (
          <div style={{ textAlign: 'center', width: '100%' }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 300, color: '#e2e8f0', marginBottom: 8 }}>
              invite expired.
            </div>
            <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.7 }}>
              this invite is no longer valid.
              {invite?.org?.name && (
                <> ask someone from <span style={{ color: '#94a3b8' }}>{invite.org.name}</span> to send a new one.</>
              )}
            </div>
          </div>
        )}

        {state === 'revoked' && (
          <div style={{ textAlign: 'center', width: '100%' }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 300, color: '#e2e8f0', marginBottom: 8 }}>
              invite revoked.
            </div>
            <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.7 }}>
              this invitation was cancelled. reach out to whoever invited you for a new link.
            </div>
          </div>
        )}

        {state === 'accepted' && (
          <div style={{ textAlign: 'center', width: '100%' }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 300, color: '#e2e8f0', marginBottom: 8 }}>
              already joined.
            </div>
            <div style={{ fontSize: 13, color: '#475569', marginBottom: 28, lineHeight: 1.7 }}>
              this invite has already been accepted.
            </div>
            <button
              onClick={() => router.replace(invite?.org?.slug ? `/${invite.org.slug}` : '/orgs')}
              style={{
                width: '100%', padding: '12px 20px',
                background: '#3b82f6', color: '#fff',
                border: 'none', borderRadius: 10,
                fontSize: 14, fontWeight: 500, fontFamily: 'inherit',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              go to workspace →
            </button>
          </div>
        )}

        {state === 'error' && (
          <div style={{ textAlign: 'center', width: '100%' }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 300, color: '#e2e8f0', marginBottom: 8 }}>
              not found.
            </div>
            <div style={{ fontSize: 13, color: '#f87171', lineHeight: 1.7 }}>
              {error || 'this invitation link is invalid.'}
            </div>
          </div>
        )}

        {state === 'ready' && invite && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 32, width: '100%' }}>
              <div style={{ fontSize: 13, color: '#475569', marginBottom: 6 }}>
                {invite.inviter?.name || invite.inviter?.email || 'someone'} invited you to
              </div>
              <div style={{ fontSize: '1.8rem', fontWeight: 300, color: '#e2e8f0', marginBottom: 4, letterSpacing: '-0.01em' }}>
                {invite.org.name}
              </div>
              <div style={{ fontSize: 12, color: '#334155' }}>
                the internet is already talking.
              </div>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '100%' }}>
              {/* email display (read-only) */}
              <div>
                <div style={inputLabel}>joining as</div>
                <div style={{
                  padding: '10px 14px',
                  background: '#0d0f1a',
                  border: '1px solid #1e2535',
                  borderRadius: 8,
                  fontSize: 13,
                  color: '#64748b',
                  fontFamily: 'var(--font-mono)',
                }}>
                  {invite.email}
                </div>
              </div>

              {/* name field — only for new users */}
              {!invite.userExists && (
                <div>
                  <div style={inputLabel}>your name</div>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Jane Smith"
                    required
                    autoFocus
                    autoComplete="name"
                  />
                </div>
              )}

              <div>
                <div style={inputLabel}>
                  {invite.userExists ? 'your password' : 'choose a password'}
                </div>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    autoFocus={invite.userExists}
                    autoComplete={invite.userExists ? 'current-password' : 'new-password'}
                    style={{ paddingRight: 40 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(p => !p)}
                    tabIndex={-1}
                    style={{
                      position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: '#475569', padding: 0, display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <EyeIcon open={showPassword} />
                  </button>
                </div>
                {!invite.userExists && (
                  <div style={{ fontSize: 11, color: '#334155', marginTop: 4 }}>
                    at least 8 characters
                  </div>
                )}
              </div>

              {error && (
                <div style={{
                  fontSize: 12.5, color: '#f87171',
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
                disabled={submitting}
                style={{
                  marginTop: 8, width: '100%', padding: '12px 20px',
                  background: submitting ? '#1e2535' : '#3b82f6',
                  color: submitting ? '#334155' : '#fff',
                  border: 'none', borderRadius: 10,
                  fontSize: 14, fontWeight: 500, fontFamily: 'inherit',
                  transition: 'all 0.15s ease',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                }}
              >
                {submitting
                  ? 'joining...'
                  : invite.userExists
                    ? 'sign in & join →'
                    : 'create account & join →'
                }
              </button>
            </form>

            {invite.userExists && (
              <div style={{ marginTop: 20, fontSize: 12, color: '#334155', textAlign: 'center' }}>
                signing in as <span style={{ color: '#64748b' }}>{invite.email}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
