'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'

export default function Home() {
  const router = useRouter()
  const { token, isReady } = useAuth()

  useEffect(() => {
    if (!isReady) return
    router.replace(token ? '/available' : '/login')
  }, [token, isReady, router])

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
    </div>
  )
}
