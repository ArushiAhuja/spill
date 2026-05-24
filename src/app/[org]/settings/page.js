'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api'

const SOURCE_COLORS = {
  reddit: '#f87171',
  hackernews: '#3b82f6',
  google_news: '#4ade80',
  twitter: '#60a5fa',
  playstore: '#9b8ff7',
  appstore: '#34d399',
  youtube: '#f87171',
}

const ALL_SOURCES = [
  { id: 'reddit', label: 'Reddit', desc: 'posts, comments & discussions' },
  { id: 'hackernews', label: 'Hacker News', desc: 'show HN, ask HN, discussions' },
  { id: 'google_news', label: 'Google News', desc: 'news articles and press coverage' },
  { id: 'twitter', label: 'Twitter/X', desc: 'tweets and threads' },
  { id: 'playstore', label: 'Play Store', desc: 'app store reviews' },
  { id: 'appstore', label: 'App Store', desc: 'iOS app store reviews' },
  { id: 'youtube', label: 'YouTube', desc: 'comments', disabled: true },
]

function SourceCard({ slug, sourceInfo, sourceData, onUpdate }) {
  const [expanded, setExpanded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [localData, setLocalData] = useState(() => ({
    enabled: sourceData?.enabled || false,
    config: { ...(sourceData?.config || {}) },
    credentials: { ...(sourceData?.credentials || {}) },
  }))

  const color = SOURCE_COLORS[sourceInfo.id] || '#64748b'

  async function handleToggle(val) {
    const updated = { ...localData, enabled: val }
    setLocalData(updated)
    if (val) setExpanded(true)
    try {
      await api.updateSource(slug, sourceInfo.id, { enabled: val })
      onUpdate()
    } catch {
      setLocalData((prev) => ({ ...prev, enabled: !val }))
    }
  }

  async function handleSave() {
    setSaving(true)
    setSaveMsg('')
    try {
      await api.updateSource(slug, sourceInfo.id, {
        enabled: localData.enabled,
        config: localData.config,
        credentials: localData.credentials,
      })
      setSaveMsg('saved')
      onUpdate()
      setTimeout(() => setSaveMsg(''), 2000)
    } catch (err) {
      setSaveMsg(err.message || 'error saving')
    } finally {
      setSaving(false)
    }
  }

  function setConfigField(key, val) {
    setLocalData((prev) => ({
      ...prev,
      config: { ...prev.config, [key]: val },
    }))
  }

  function setCredField(key, val) {
    setLocalData((prev) => ({
      ...prev,
      credentials: { ...prev.credentials, [key]: val },
    }))
  }

  const queriesValue = Array.isArray(localData.config?.queries)
    ? localData.config.queries.join('\n')
    : localData.config?.queries || ''

  const rssValue = Array.isArray(localData.config?.rss_urls)
    ? localData.config.rss_urls.join('\n')
    : localData.config?.rss_urls || ''

  const appIdsValue = Array.isArray(localData.config?.app_ids)
    ? localData.config.app_ids.join('\n')
    : localData.config?.app_ids || ''

  const subredditsValue = Array.isArray(localData.config?.subreddits)
    ? localData.config.subreddits.join('\n')
    : localData.config?.subreddits || ''

  const customThreadsValue = Array.isArray(localData.config?.custom_threads)
    ? localData.config.custom_threads.join('\n')
    : localData.config?.custom_threads || ''

  const contextQueriesValue = Array.isArray(localData.config?.context_queries)
    ? localData.config.context_queries.join('\n')
    : localData.config?.context_queries || ''

  const autoSubreddits = Array.isArray(localData.config?.auto_subreddits)
    ? localData.config.auto_subreddits
    : []

  function removeAutoSubreddit(sr) {
    setLocalData(prev => ({
      ...prev,
      config: {
        ...prev.config,
        auto_subreddits: (prev.config.auto_subreddits || []).filter(s => s !== sr),
      },
    }))
  }

  const hasNoCreds = sourceInfo.id === 'hackernews' || sourceInfo.id === 'google_news' || sourceInfo.id === 'playstore' || sourceInfo.id === 'appstore'

  return (
    <div style={{
      border: '1px solid #1e2535',
      borderRadius: 10,
      marginBottom: 10,
      overflow: 'hidden',
      opacity: sourceInfo.disabled ? 0.45 : 1,
      transition: 'border-color 0.15s',
      ...(localData.enabled ? { borderColor: color + '44' } : {}),
    }}>
      {/* Header row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 16px',
      }}>
        <button
          onClick={() => !sourceInfo.disabled && setExpanded((v) => !v)}
          disabled={sourceInfo.disabled}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'none',
            border: 'none',
            cursor: sourceInfo.disabled ? 'default' : 'pointer',
            fontFamily: 'inherit',
            flex: 1,
            textAlign: 'left',
          }}
        >
          {/* colored dot */}
          <div style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: localData.enabled ? color : '#1e2535',
            flexShrink: 0,
            transition: 'background 0.2s',
          }} />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 500, color: '#e2e8f0' }}>{sourceInfo.label}</span>
              {sourceInfo.disabled && (
                <span style={{
                  fontSize: 10,
                  color: '#334155',
                  border: '1px solid #1e2535',
                  borderRadius: 99,
                  padding: '1px 7px',
                  letterSpacing: '0.05em',
                }}>
                  coming soon
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 1 }}>{sourceInfo.desc}</div>
          </div>
        </button>

        {/* Toggle */}
        <button
          onClick={() => !sourceInfo.disabled && handleToggle(!localData.enabled)}
          disabled={sourceInfo.disabled}
          style={{ background: 'none', border: 'none', padding: 0, cursor: sourceInfo.disabled ? 'not-allowed' : 'pointer' }}
        >
          <div className={`toggle-track ${localData.enabled ? 'on' : ''}`}>
            <div className="toggle-thumb" />
          </div>
        </button>
      </div>

      {/* Expanded content */}
      {localData.enabled && expanded && !sourceInfo.disabled && (
        <div style={{
          borderTop: '1px solid #1e2535',
          padding: '16px 16px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          background: '#13161f',
        }}>
          {/* Credential fields */}
          {sourceInfo.id === 'reddit' && (
            <>
              <div style={{
                fontSize: 11,
                color: '#94a3b8',
                background: 'rgba(148,163,184,0.07)',
                border: '1px solid rgba(148,163,184,0.2)',
                borderRadius: 8,
                padding: '8px 12px',
              }}>
                heads up: these credentials are stored unencrypted.
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>client id</div>
                <input
                  type="text"
                  value={localData.credentials?.client_id || ''}
                  onChange={(e) => setCredField('client_id', e.target.value)}
                  placeholder="Reddit client ID"
                />
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>client secret</div>
                <input
                  type="password"
                  value={localData.credentials?.client_secret || ''}
                  onChange={(e) => setCredField('client_secret', e.target.value)}
                  placeholder="••••••••"
                />
              </div>
            </>
          )}
          {sourceInfo.id === 'twitter' && (
            <>
              <div style={{
                fontSize: 11,
                color: '#94a3b8',
                background: 'rgba(148,163,184,0.07)',
                border: '1px solid rgba(148,163,184,0.2)',
                borderRadius: 8,
                padding: '8px 12px',
              }}>
                heads up: these credentials are stored unencrypted.
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>bearer token</div>
                <input
                  type="password"
                  value={localData.credentials?.bearer_token || ''}
                  onChange={(e) => setCredField('bearer_token', e.target.value)}
                  placeholder="••••••••"
                />
              </div>
            </>
          )}
          {hasNoCreds && (
            <div style={{ fontSize: 12, color: '#334155' }}>no credentials needed for this source.</div>
          )}

          {/* Config fields */}
          {sourceInfo.id !== 'playstore' && sourceInfo.id !== 'appstore' && sourceInfo.id !== 'youtube' && (
            <div>
              <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
                {sourceInfo.id === 'google_news' ? 'rss urls' : 'search queries'}
              </div>
              <textarea
                rows={4}
                value={sourceInfo.id === 'google_news' ? rssValue : queriesValue}
                onChange={(e) => {
                  const lines = e.target.value.split('\n')
                  if (sourceInfo.id === 'google_news') {
                    setConfigField('rss_urls', lines)
                  } else {
                    setConfigField('queries', lines)
                  }
                }}
                placeholder="one per line"
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
              />
            </div>
          )}
          {sourceInfo.id === 'reddit' && (
            <>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
                  subreddits <span style={{ textTransform: 'none', letterSpacing: 0, color: '#334155' }}>(one per line, no r/ prefix)</span>
                </div>
                <textarea
                  rows={4}
                  value={subredditsValue}
                  onChange={(e) => setConfigField('subreddits', e.target.value.split('\n').map(s => s.replace(/^r\//i, '').trim()).filter(Boolean))}
                  placeholder={'aviation\nIndia\nstartups'}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                />
              </div>

              <div>
                <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
                  topic queries <span style={{ textTransform: 'none', letterSpacing: 0, color: '#334155' }}>(industry searches without brand name — used within subreddits + AI context)</span>
                </div>
                <textarea
                  rows={5}
                  value={contextQueriesValue}
                  onChange={(e) => setConfigField('context_queries', e.target.value.split('\n').map(s => s.trim()).filter(Boolean))}
                  placeholder={'pilot training India cost\nDGCA CPL training India\naviation academy admission India\ncadet pilot program India review'}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                />
                <div style={{ fontSize: 11, color: '#334155', marginTop: 4 }}>
                  posts matching these topics are surfaced from configured subreddits. AI also uses these to evaluate borderline posts.
                </div>
              </div>

              <div>
                <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
                  custom thread urls <span style={{ textTransform: 'none', letterSpacing: 0, color: '#334155' }}>(subreddit or post links, one per line)</span>
                </div>
                <textarea
                  rows={3}
                  value={customThreadsValue}
                  onChange={(e) => setConfigField('custom_threads', e.target.value.split('\n').map(s => s.trim()).filter(Boolean))}
                  placeholder={'https://www.reddit.com/r/CadetPilotProgram/\nhttps://www.reddit.com/r/IndianAviation/comments/abc123/'}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                />
              </div>

              {autoSubreddits.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
                    auto-discovered <span style={{ textTransform: 'none', letterSpacing: 0, color: '#334155' }}>(found during setup)</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {autoSubreddits.map(sr => (
                      <div key={sr} style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '3px 9px',
                        borderRadius: 99,
                        background: 'rgba(248,113,113,0.1)',
                        border: '1px solid rgba(248,113,113,0.25)',
                        fontSize: 11.5,
                        color: '#fca5a5',
                      }}>
                        <span>r/{sr}</span>
                        <button
                          onClick={() => removeAutoSubreddit(sr)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, color: '#64748b', fontSize: 12 }}
                          title="remove"
                        >×</button>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: '#334155', marginTop: 6 }}>
                    these subreddits were automatically picked based on your setup queries. save to keep them active.
                  </div>
                </div>
              )}
            </>
          )}
          {sourceInfo.id === 'playstore' && (
            <div>
              <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>app ids</div>
              <textarea
                rows={3}
                value={appIdsValue}
                onChange={(e) => setConfigField('app_ids', e.target.value.split('\n').map(s => s.trim()).filter(Boolean))}
                placeholder="com.example.app (one per line)"
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
              />
            </div>
          )}
          {sourceInfo.id === 'appstore' && (
            <div>
              <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>app IDs (one per line)</div>
              <textarea
                rows={3}
                value={appIdsValue}
                onChange={(e) => setConfigField('app_ids', e.target.value.split('\n').map(s => s.trim()).filter(Boolean))}
                placeholder="123456789"
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
              />
            </div>
          )}

          {/* Save */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                fontSize: 12,
                padding: '6px 16px',
                background: saving ? '#1e2535' : '#3b82f6',
                color: saving ? '#334155' : '#0d0f1a',
                border: 'none',
                borderRadius: 8,
                fontFamily: 'inherit',
                fontWeight: 500,
                cursor: saving ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {saving ? 'saving...' : 'save'}
            </button>
            {saveMsg && (
              <span style={{ fontSize: 12, color: saveMsg === 'saved' ? '#4ade80' : '#f87171' }}>
                {saveMsg}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app-eight-theta-20.vercel.app'

function InviteSection({ slug }) {
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteMsg, setInviteMsg] = useState(null) // { text, ok }
  const [invitations, setInvitations] = useState([])
  const [loadingInvites, setLoadingInvites] = useState(true)
  const [resendingId, setResendingId] = useState(null)
  const [revokingId, setRevokingId] = useState(null)

  async function loadInvitations() {
    try {
      const data = await api.getInvitations(slug)
      setInvitations(data.invitations || [])
    } catch { /* non-critical */ } finally {
      setLoadingInvites(false)
    }
  }

  useEffect(() => { loadInvitations() }, [slug])

  async function handleInvite(e) {
    e.preventDefault()
    setInviting(true)
    setInviteMsg(null)
    try {
      const data = await api.createInvitation(slug, { email: inviteEmail, role: 'member' })
      setInviteEmail('')
      setInviteMsg({ text: data.warning || 'invite sent', ok: !data.warning })
      loadInvitations()
    } catch (err) {
      setInviteMsg({ text: err.message || 'failed to send invite', ok: false })
    } finally {
      setInviting(false)
      setTimeout(() => setInviteMsg(null), 5000)
    }
  }

  async function handleResend(id) {
    setResendingId(id)
    try {
      const data = await api.resendInvitation(slug, id)
      setInviteMsg({ text: data.warning || 'invite resent', ok: !data.warning })
      loadInvitations()
    } catch (err) {
      setInviteMsg({ text: err.message || 'failed to resend', ok: false })
    } finally {
      setResendingId(null)
      setTimeout(() => setInviteMsg(null), 4000)
    }
  }

  async function handleRevoke(id) {
    setRevokingId(id)
    try {
      await api.revokeInvitation(slug, id)
      setInvitations(prev => prev.filter(i => i.id !== id))
    } catch (err) {
      setInviteMsg({ text: err.message || 'failed to revoke', ok: false })
      setTimeout(() => setInviteMsg(null), 4000)
    } finally {
      setRevokingId(null)
    }
  }

  function timeLeft(expiresAt) {
    const ms = new Date(expiresAt) - Date.now()
    if (ms <= 0) return 'expired'
    const days = Math.floor(ms / 86400000)
    const hours = Math.floor((ms % 86400000) / 3600000)
    if (days > 0) return `${days}d left`
    return `${hours}h left`
  }

  return (
    <section style={{ marginBottom: 40 }}>
      <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 16, paddingBottom: 8, borderBottom: '1px solid #1e2535' }}>
        invite team
      </div>

      {/* invite form */}
      <form onSubmit={handleInvite} style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input
          type="email"
          value={inviteEmail}
          onChange={e => setInviteEmail(e.target.value)}
          placeholder="teammate@company.com"
          required
          style={{ flex: 1 }}
        />
        <button
          type="submit"
          disabled={inviting}
          style={{
            fontSize: 12.5, padding: '8px 18px',
            background: inviting ? '#1e2535' : '#3b82f6',
            color: inviting ? '#334155' : '#0d0f1a',
            border: 'none', borderRadius: 8, fontFamily: 'inherit',
            fontWeight: 500, cursor: inviting ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s', whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          {inviting ? 'sending...' : 'send invite'}
        </button>
      </form>

      {inviteMsg && (
        <div style={{
          fontSize: 12.5, marginBottom: 14,
          padding: '9px 13px', borderRadius: 8,
          color: inviteMsg.ok ? '#4ade80' : '#f59e0b',
          background: inviteMsg.ok ? 'rgba(74,222,128,0.08)' : 'rgba(245,158,11,0.08)',
          border: `1px solid ${inviteMsg.ok ? 'rgba(74,222,128,0.2)' : 'rgba(245,158,11,0.2)'}`,
        }}>
          {inviteMsg.text}
        </div>
      )}

      {/* pending invites list */}
      {!loadingInvites && invitations.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, color: '#334155', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            pending
          </div>
          {invitations.map(inv => {
            const expired = new Date(inv.expires_at) < new Date()
            return (
              <div key={inv.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', background: '#13161f',
                border: `1px solid ${expired ? 'rgba(245,158,11,0.2)' : '#1e2535'}`,
                borderRadius: 8, gap: 10,
              }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {inv.email}
                  </div>
                  <div style={{ fontSize: 11, color: '#334155', marginTop: 2 }}>
                    {expired ? (
                      <span style={{ color: '#f59e0b' }}>expired</span>
                    ) : (
                      <span>{timeLeft(inv.expires_at)}</span>
                    )}
                    {inv.invited_by_name && (
                      <span style={{ marginLeft: 8 }}>· by {inv.invited_by_name}</span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => handleResend(inv.id)}
                    disabled={resendingId === inv.id}
                    style={{
                      fontSize: 11.5, padding: '4px 10px',
                      background: 'transparent', color: resendingId === inv.id ? '#334155' : '#64748b',
                      border: '1px solid #1e2535', borderRadius: 6,
                      fontFamily: 'inherit', cursor: resendingId === inv.id ? 'not-allowed' : 'pointer',
                      transition: 'all 0.12s',
                    }}
                    onMouseEnter={e => { if (resendingId !== inv.id) { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.borderColor = '#243047' } }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#64748b'; e.currentTarget.style.borderColor = '#1e2535' }}
                  >
                    {resendingId === inv.id ? '...' : 'resend'}
                  </button>
                  <button
                    onClick={() => handleRevoke(inv.id)}
                    disabled={revokingId === inv.id}
                    style={{
                      fontSize: 11.5, padding: '4px 10px',
                      background: 'transparent', color: revokingId === inv.id ? '#334155' : '#475569',
                      border: '1px solid #1e2535', borderRadius: 6,
                      fontFamily: 'inherit', cursor: revokingId === inv.id ? 'not-allowed' : 'pointer',
                      transition: 'all 0.12s',
                    }}
                    onMouseEnter={e => { if (revokingId !== inv.id) { e.currentTarget.style.color = '#f87171'; e.currentTarget.style.borderColor = 'rgba(248,113,113,0.3)' } }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#475569'; e.currentTarget.style.borderColor = '#1e2535' }}
                  >
                    {revokingId === inv.id ? '...' : 'revoke'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {!loadingInvites && invitations.length === 0 && (
        <div style={{ fontSize: 12, color: '#334155' }}>no pending invitations.</div>
      )}
    </section>
  )
}

export default function SettingsPage({ params }) {
  const slug = params.org
  const router = useRouter()
  const [org, setOrg] = useState(null)
  const [sources, setSources] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [orgName, setOrgName] = useState('')
  const [orgWebsite, setOrgWebsite] = useState('')
  const [orgDescription, setOrgDescription] = useState('')
  const [orgCompetitors, setOrgCompetitors] = useState('')
  const [orgSaving, setOrgSaving] = useState(false)
  const [orgSaveMsg, setOrgSaveMsg] = useState('')

  const [industryMonitoring, setIndustryMonitoring] = useState(false)
  const [industryKeywords, setIndustryKeywords] = useState('')
  const [industrySaving, setIndustrySaving] = useState(false)
  const [industrySaveMsg, setIndustrySaveMsg] = useState('')

  const [digestEnabled, setDigestEnabled] = useState(false)
  const [digestFrequency, setDigestFrequency] = useState('daily')
  const [digestRecipients, setDigestRecipients] = useState('')
  const [digestGmailUser, setDigestGmailUser] = useState('')
  const [digestGmailPass, setDigestGmailPass] = useState('')
  const [digestSaving, setDigestSaving] = useState(false)
  const [digestSaveMsg, setDigestSaveMsg] = useState('')

  const [slackWebhook, setSlackWebhook] = useState('')
  const [slackSaving, setSlackSaving] = useState(false)
  const [slackSaveMsg, setSlackSaveMsg] = useState('')

  const [orgPartnerBrands, setOrgPartnerBrands] = useState('')
  const [incidentThreshold, setIncidentThreshold] = useState(5)
  const [sourceHealth, setSourceHealth] = useState([])
  const [digestTesting, setDigestTesting] = useState(false)
  const [digestTestMsg, setDigestTestMsg] = useState('')

  async function load() {
    try {
      const [orgData, srcData] = await Promise.all([
        api.getOrg(slug),
        api.getSources(slug),
      ])
      setOrg(orgData)
      setSources(srcData || [])
      setOrgName(orgData.name || '')
      setOrgWebsite(orgData.website || '')
      setOrgDescription(orgData.description || '')
      setOrgCompetitors((orgData.competitors || []).join(', '))
      setIndustryMonitoring(!!orgData.industry_monitoring)
      setIndustryKeywords((orgData.industry_keywords || []).join(', '))
      setDigestEnabled(!!orgData.digest_enabled)
      setDigestFrequency(orgData.digest_frequency || 'daily')
      setDigestRecipients((orgData.digest_recipients || []).join(', '))
      setDigestGmailUser(orgData.digest_gmail_user || '')
      setDigestGmailPass(orgData.digest_gmail_app_password || '')
      setSlackWebhook(orgData.slack_webhook_url || '')
      setOrgPartnerBrands((orgData.partner_brands || []).join(', '))
      setIncidentThreshold(orgData.incident_threshold || 5)
      try {
        const statusData = await api.getStatus(slug)
        setSourceHealth(statusData.sourceHealth || [])
      } catch { /* non-critical */ }
    } catch (err) {
      if (err.message === 'unauthorized') router.replace('/login')
      else setError(err.message || 'failed to load settings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  async function handleOrgSave(e) {
    e.preventDefault()
    setOrgSaving(true)
    setOrgSaveMsg('')
    try {
      const competitors = orgCompetitors.split(',').map(c => c.trim()).filter(Boolean)
      const partnerBrands = orgPartnerBrands.split(',').map(c => c.trim()).filter(Boolean)
      await api.updateOrg(slug, { name: orgName, website: orgWebsite, description: orgDescription, competitors, partner_brands: partnerBrands })
      setOrgSaveMsg('saved')
      setTimeout(() => setOrgSaveMsg(''), 2000)
    } catch (err) {
      setOrgSaveMsg(err.message || 'error saving')
    } finally {
      setOrgSaving(false)
    }
  }

  async function handleIndustrySave() {
    setIndustrySaving(true)
    setIndustrySaveMsg('')
    try {
      const kw = industryKeywords.split(',').map(k => k.trim()).filter(Boolean)
      await api.updateOrg(slug, { industry_monitoring: industryMonitoring, industry_keywords: kw })
      setIndustrySaveMsg('saved')
      setTimeout(() => setIndustrySaveMsg(''), 2000)
    } catch (err) {
      setIndustrySaveMsg(err.message || 'error saving')
    } finally {
      setIndustrySaving(false)
    }
  }

  async function handleDigestSave() {
    setDigestSaving(true)
    setDigestSaveMsg('')
    try {
      await api.updateOrg(slug, {
        digest_enabled: digestEnabled,
        digest_frequency: digestFrequency,
        digest_recipients: digestRecipients.split(/[\s,]+/).map(r => r.trim()).filter(Boolean),
        digest_gmail_user: digestGmailUser.trim() || null,
        digest_gmail_app_password: digestGmailPass.trim() || null,
      })
      setDigestSaveMsg('saved')
      setTimeout(() => setDigestSaveMsg(''), 2000)
    } catch (err) {
      setDigestSaveMsg(err.message || 'error saving')
    } finally {
      setDigestSaving(false)
    }
  }

  async function handleSlackSave() {
    setSlackSaving(true)
    setSlackSaveMsg('')
    try {
      await api.updateOrg(slug, { slack_webhook_url: slackWebhook.trim() || null })
      setSlackSaveMsg('saved')
      setTimeout(() => setSlackSaveMsg(''), 2000)
    } catch (err) {
      setSlackSaveMsg(err.message || 'error saving')
    } finally {
      setSlackSaving(false)
    }
  }

  function getSourceData(id) {
    return sources.find((s) => s.source === id)
  }

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', flexDirection: 'column', gap: 8,
      }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 5, height: 5, borderRadius: '50%', background: '#3b82f6',
              animation: `pulseDot 1.2s ${i * 0.18}s ease-in-out infinite`,
            }} />
          ))}
        </div>
        <div style={{ fontSize: 12, color: '#334155' }}>loading settings...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ fontSize: 13, color: '#f87171' }}>{error}</div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '40px 24px' }}>
      {/* Page header */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ fontSize: 18, fontWeight: 500, color: '#e2e8f0', marginBottom: 4 }}>settings</div>
        <div style={{ fontSize: 12.5, color: '#64748b' }}>{org?.name}</div>
      </div>

      {/* General section */}
      <section style={{ marginBottom: 40 }}>
        <div style={{
          fontSize: 11,
          color: '#64748b',
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          marginBottom: 16,
          paddingBottom: 8,
          borderBottom: '1px solid #1e2535',
        }}>
          general
        </div>
        <form onSubmit={handleOrgSave} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
              company name
            </div>
            <input
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
              website
            </div>
            <input
              type="text"
              value={orgWebsite}
              onChange={(e) => setOrgWebsite(e.target.value)}
              placeholder="https://yourcompany.com"
            />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
              description
            </div>
            <textarea
              rows={4}
              value={orgDescription}
              onChange={(e) => setOrgDescription(e.target.value)}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
              competitors <span style={{ textTransform: 'none', letterSpacing: 0, color: '#334155' }}>(comma-separated)</span>
            </div>
            <input
              type="text"
              value={orgCompetitors}
              onChange={(e) => setOrgCompetitors(e.target.value)}
              placeholder="Competitor A, Competitor B"
            />
            <div style={{ fontSize: 11, color: '#334155', marginTop: 4 }}>
              posts mentioning these names get flagged with a competitor badge in the feed
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
              partner brands <span style={{ textTransform: 'none', letterSpacing: 0, color: '#334155' }}>(comma-separated)</span>
            </div>
            <input
              type="text"
              value={orgPartnerBrands}
              onChange={(e) => setOrgPartnerBrands(e.target.value)}
              placeholder="IndiGo, Taj Hotels, Ola Cabs"
            />
            <div style={{ fontSize: 11, color: '#334155', marginTop: 4 }}>
              posts mentioning these names get a partner badge — different from competitors
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              type="submit"
              disabled={orgSaving}
              style={{
                fontSize: 12.5,
                padding: '8px 20px',
                background: orgSaving ? '#1e2535' : '#3b82f6',
                color: orgSaving ? '#334155' : '#0d0f1a',
                border: 'none',
                borderRadius: 8,
                fontFamily: 'inherit',
                fontWeight: 500,
                cursor: orgSaving ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {orgSaving ? 'saving...' : 'save changes'}
            </button>
            {orgSaveMsg && (
              <span style={{ fontSize: 12, color: orgSaveMsg === 'saved' ? '#4ade80' : '#f87171' }}>
                {orgSaveMsg}
              </span>
            )}
          </div>
        </form>
      </section>

      {/* Monitoring scope section */}
      <section style={{ marginBottom: 40 }}>
        <div style={{
          fontSize: 11, color: '#64748b', textTransform: 'uppercase',
          letterSpacing: '0.12em', marginBottom: 16, paddingBottom: 8,
          borderBottom: '1px solid #1e2535',
        }}>
          monitoring scope
        </div>

        <div style={{
          padding: '16px',
          borderRadius: 10,
          border: `1px solid ${industryMonitoring ? 'rgba(59,130,246,0.3)' : '#1e2535'}`,
          background: industryMonitoring ? 'rgba(59,130,246,0.04)' : '#13161f',
          transition: 'all 0.15s ease',
          marginBottom: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 500, color: '#e2e8f0', marginBottom: 3 }}>
                watch industry signals too
              </div>
              <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
                surface posts relevant to your industry even when your brand isn't directly mentioned
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIndustryMonitoring(v => !v)}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0, marginTop: 2 }}
            >
              <div className={`toggle-track ${industryMonitoring ? 'on' : ''}`}>
                <div className="toggle-thumb" />
              </div>
            </button>
          </div>

          {industryMonitoring && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
                keywords to watch <span style={{ color: '#334155', textTransform: 'none', letterSpacing: 0 }}>(comma-separated)</span>
              </div>
              <input
                type="text"
                value={industryKeywords}
                onChange={e => setIndustryKeywords(e.target.value)}
                placeholder="food delivery delay, driver cancelled, payment failed"
              />
              <div style={{ fontSize: 11, color: '#334155', marginTop: 5 }}>
                posts matching any of these surface even without your brand name
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={handleIndustrySave}
            disabled={industrySaving}
            style={{
              fontSize: 12.5, padding: '8px 20px',
              background: industrySaving ? '#1e2535' : '#3b82f6',
              color: industrySaving ? '#334155' : '#0d0f1a',
              border: 'none', borderRadius: 8, fontFamily: 'inherit',
              fontWeight: 500, cursor: industrySaving ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {industrySaving ? 'saving...' : 'save changes'}
          </button>
          {industrySaveMsg && (
            <span style={{ fontSize: 12, color: industrySaveMsg === 'saved' ? '#4ade80' : '#f87171' }}>
              {industrySaveMsg}
            </span>
          )}
        </div>
      </section>

      {/* Incident detection section */}
      <section style={{ marginBottom: 40 }}>
        <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 16, paddingBottom: 8, borderBottom: '1px solid #1e2535' }}>
          incident detection
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
              signal threshold to declare an incident
            </div>
            <input
              type="number"
              min={2}
              max={100}
              value={incidentThreshold}
              onChange={(e) => setIncidentThreshold(parseInt(e.target.value) || 5)}
              style={{ width: 100 }}
            />
            <div style={{ fontSize: 11, color: '#334155', marginTop: 4 }}>
              min escalated signals in 2 hours to trigger an incident. default 5. raise for high-volume orgs.
            </div>
          </div>
          <div>
            <button
              onClick={async () => {
                try {
                  await api.updateOrg(slug, { incident_threshold: incidentThreshold })
                  setOrgSaveMsg('saved')
                  setTimeout(() => setOrgSaveMsg(''), 2000)
                } catch (err) { setOrgSaveMsg(err.message || 'error') }
              }}
              style={{ fontSize: 12.5, padding: '8px 20px', background: '#3b82f6', color: '#0d0f1a', border: 'none', borderRadius: 8, fontFamily: 'inherit', fontWeight: 500, cursor: 'pointer' }}
            >
              save threshold
            </button>
          </div>
        </div>
      </section>

      {/* Executive digest section */}
      <section style={{ marginBottom: 40 }}>
        <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 16, paddingBottom: 8, borderBottom: '1px solid #1e2535' }}>
          executive digest
        </div>

        <div style={{ padding: 16, borderRadius: 10, border: `1px solid ${digestEnabled ? 'rgba(59,130,246,0.3)' : '#1e2535'}`, background: digestEnabled ? 'rgba(59,130,246,0.04)' : '#13161f', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 500, color: '#e2e8f0', marginBottom: 3 }}>send periodic digest emails</div>
              <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
                daily or weekly summary — signal counts, top escalations, category breakdown, incidents
              </div>
            </div>
            <button type="button" onClick={() => setDigestEnabled(v => !v)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0, marginTop: 2 }}>
              <div className={`toggle-track ${digestEnabled ? 'on' : ''}`}><div className="toggle-thumb" /></div>
            </button>
          </div>

          {digestEnabled && (
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>frequency</div>
                <div style={{ display: 'flex', gap: 2, padding: 3, background: '#0d0f1a', borderRadius: 8, border: '1px solid #1e2535', width: 'fit-content' }}>
                  {['daily', 'weekly'].map(f => (
                    <button key={f} type="button" onClick={() => setDigestFrequency(f)} style={{ fontSize: 12, padding: '5px 16px', borderRadius: 6, background: digestFrequency === f ? '#191d2b' : 'transparent', color: digestFrequency === f ? '#e2e8f0' : '#64748b', border: digestFrequency === f ? '1px solid #1e2535' : '1px solid transparent', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.12s' }}>
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>recipients <span style={{ textTransform: 'none', letterSpacing: 0, color: '#334155' }}>(comma-separated)</span></div>
                <input type="text" value={digestRecipients} onChange={e => setDigestRecipients(e.target.value)} placeholder="ceo@company.com, head-ops@company.com" />
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>gmail address <span style={{ textTransform: 'none', letterSpacing: 0, color: '#334155' }}>(sends from this account)</span></div>
                <input type="email" value={digestGmailUser} onChange={e => setDigestGmailUser(e.target.value)} placeholder="you@gmail.com" autoComplete="off" />
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>app password <span style={{ textTransform: 'none', letterSpacing: 0, color: '#334155' }}>(16-char google app password)</span></div>
                <input type="password" value={digestGmailPass} onChange={e => setDigestGmailPass(e.target.value)} placeholder="abcd efgh ijkl mnop" autoComplete="new-password" />
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button onClick={handleDigestSave} disabled={digestSaving} style={{ fontSize: 12.5, padding: '8px 20px', background: digestSaving ? '#1e2535' : '#3b82f6', color: digestSaving ? '#334155' : '#0d0f1a', border: 'none', borderRadius: 8, fontFamily: 'inherit', fontWeight: 500, cursor: digestSaving ? 'not-allowed' : 'pointer', transition: 'all 0.15s' }}>
            {digestSaving ? 'saving...' : 'save changes'}
          </button>
          {digestSaveMsg && <span style={{ fontSize: 12, color: digestSaveMsg === 'saved' ? '#4ade80' : '#f87171' }}>{digestSaveMsg}</span>}
          <button
            onClick={async () => {
              setDigestTesting(true)
              setDigestTestMsg('')
              try {
                await api.testDigest(slug)
                setDigestTestMsg('test sent')
              } catch (err) {
                setDigestTestMsg(err.message || 'failed')
              } finally {
                setDigestTesting(false)
                setTimeout(() => setDigestTestMsg(''), 3000)
              }
            }}
            disabled={digestTesting || !digestEnabled}
            title={!digestEnabled ? 'enable digest first' : 'send a test digest now'}
            style={{
              fontSize: 12, padding: '7px 14px',
              background: 'transparent', color: '#64748b',
              border: '1px solid #1e2535', borderRadius: 8,
              fontFamily: 'inherit', cursor: digestTesting || !digestEnabled ? 'not-allowed' : 'pointer',
              opacity: digestTesting || !digestEnabled ? 0.5 : 1, transition: 'all 0.15s',
            }}
          >
            {digestTesting ? 'sending…' : 'send test'}
          </button>
          {digestTestMsg && <span style={{ fontSize: 12, color: digestTestMsg === 'test sent' ? '#4ade80' : '#f87171' }}>{digestTestMsg}</span>}
        </div>
      </section>

      {/* Slack section */}
      <section style={{ marginBottom: 40 }}>
        <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 16, paddingBottom: 8, borderBottom: '1px solid #1e2535' }}>
          slack
        </div>
        <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 14, lineHeight: 1.6 }}>
          Add a global Slack webhook to receive spike alerts and anomaly notifications here.
          Per-rule Slack alerts are configured in the <span style={{ color: '#3b82f6' }}>Escalations</span> page.
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>global webhook url</div>
          <input type="text" value={slackWebhook} onChange={e => setSlackWebhook(e.target.value)} placeholder="https://hooks.slack.com/services/..." />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={handleSlackSave} disabled={slackSaving} style={{ fontSize: 12.5, padding: '8px 20px', background: slackSaving ? '#1e2535' : '#3b82f6', color: slackSaving ? '#334155' : '#0d0f1a', border: 'none', borderRadius: 8, fontFamily: 'inherit', fontWeight: 500, cursor: slackSaving ? 'not-allowed' : 'pointer', transition: 'all 0.15s' }}>
            {slackSaving ? 'saving...' : 'save changes'}
          </button>
          {slackSaveMsg && <span style={{ fontSize: 12, color: slackSaveMsg === 'saved' ? '#4ade80' : '#f87171' }}>{slackSaveMsg}</span>}
        </div>
      </section>

      {/* Source health section */}
      {sourceHealth.length > 0 && (
        <section style={{ marginBottom: 40 }}>
          <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 16, paddingBottom: 8, borderBottom: '1px solid #1e2535' }}>
            source health
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sourceHealth.map(s => {
              const isError = !!s.error
              const isStale = !s.lastFetchAt || (Date.now() - new Date(s.lastFetchAt).getTime()) > 30 * 60 * 1000
              const status = isError ? 'error' : isStale ? 'stale' : 'healthy'
              const color = status === 'healthy' ? '#4ade80' : status === 'stale' ? '#f59e0b' : '#f87171'
              return (
                <div key={s.source} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#13161f', borderRadius: 8, border: '1px solid #1e2535' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
                    <span style={{ fontSize: 13, color: '#e2e8f0' }}>{s.source}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {s.lastFetchAt ? (
                      <span style={{ fontSize: 11, color: '#64748b' }}>
                        {new Date(s.lastFetchAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: '#475569' }}>never fetched</span>
                    )}
                    {s.error && (
                      <div style={{ fontSize: 10.5, color: '#f87171', marginTop: 2 }}>{s.error.slice(0, 60)}</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Memory section */}
      <section style={{ marginBottom: 40 }}>
        <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 16, paddingBottom: 8, borderBottom: '1px solid #1e2535' }}>
          memory
        </div>
        <Link
          href={`/${slug}/settings/feedback`}
          style={{ textDecoration: 'none', display: 'block' }}
        >
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: '#13161f', border: '1px solid #1e2535', borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#243047'; e.currentTarget.style.background = '#191d2b' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#1e2535'; e.currentTarget.style.background = '#13161f' }}
          >
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 500, color: '#e2e8f0', marginBottom: 3 }}>feedback history</div>
              <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
                see every signal you've logged — what spill excludes, what it prioritises, and why.
              </div>
            </div>
            <span style={{ fontSize: 14, color: '#334155', flexShrink: 0, marginLeft: 16 }}>→</span>
          </div>
        </Link>
      </section>

      {/* Invite team section */}
      <InviteSection slug={slug} />

      {/* Sources section */}
      <section>
        <div style={{
          fontSize: 11,
          color: '#64748b',
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          marginBottom: 16,
          paddingBottom: 8,
          borderBottom: '1px solid #1e2535',
        }}>
          sources
        </div>
        {ALL_SOURCES.map((src) => (
          <SourceCard
            key={src.id}
            slug={slug}
            sourceInfo={src}
            sourceData={getSourceData(src.id)}
            onUpdate={load}
          />
        ))}
      </section>
    </div>
  )
}
