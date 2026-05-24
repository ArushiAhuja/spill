'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function AuthGuard({ children }) {
  const router = useRouter()
  useEffect(() => {
    if (!localStorage.getItem('spill_token')) router.replace('/login')
  }, [router])
  return children
}
