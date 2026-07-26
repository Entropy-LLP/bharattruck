'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'

export default function IndexPage() {
  const router = useRouter()
  const { token, isReady } = useAuth()

  useEffect(() => {
    if (!isReady) return
    router.replace(token ? '/dashboard' : '/login')
  }, [isReady, token, router])

  return (
    <div className="h-full flex items-center justify-center">
      <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
