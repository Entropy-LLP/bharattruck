'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/lib/auth'

/**
 * Client-side auth boundary for every /ops route. Redirects unauthenticated or
 * non-ops/admin users to /login. (Authorization is also enforced server-side by
 * the services on every API call; this just gates the UI.)
 */
export function OpsGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [loading, user, router])

  if (loading || !user) {
    return (
      <div className="flex h-screen items-center justify-center dark:bg-[#09090B] bg-[#FAFAFA]">
        <Loader2 className="h-6 w-6 animate-spin text-[#F97316]" />
      </div>
    )
  }

  return <>{children}</>
}
