'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'

export default function OrgsPage() {
  const router = useRouter()

  useEffect(() => {
    const token = localStorage.getItem('spill_token')
    if (!token) {
      router.replace('/login')
      return
    }

    async function fetchOrgs() {
      try {
        const orgs = await api.getOrgs()
        if (!orgs || orgs.length === 0) {
          router.replace('/onboarding')
        } else {
          router.replace(`/${orgs[0].slug}`)
        }
      } catch (err) {
        if (err.message === 'unauthorized') {
          router.replace('/login')
        } else {
          router.replace('/onboarding')
        }
      }
    }

    fetchOrgs()
  }, [router])

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0d0f1a',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: 12,
    }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 5, height: 5, borderRadius: '50%', background: '#3b82f6',
            animation: `pulseDot 1.2s ${i * 0.18}s ease-in-out infinite`,
          }} />
        ))}
      </div>
      <div style={{ fontSize: 12, color: '#334155' }}>loading...</div>
    </div>
  )
}
