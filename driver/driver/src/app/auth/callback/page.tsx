'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { verifyMagicLink, ApiError } from '@/lib/api'

export default function AuthCallbackPage() {
  const router = useRouter()
  const { login } = useAuth()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    if (!token) {
      setError('No token found in URL')
      return
    }

    verifyMagicLink(token)
      .then(data => {
        login(data.access_token, data.refresh_token, data.user)
        toast.success('Signed in!')
        router.replace('/available')
      })
      .catch(err => {
        setError(err instanceof ApiError ? err.message : 'Failed to verify magic link')
      })
  }, [router, login])

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen px-4">
        <div className="text-center">
          <p className="text-red-600 font-medium mb-4">{error}</p>
          <a href="/login" className="text-sm text-blue-600 hover:text-blue-700">
            Back to login
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto" />
        <p className="text-sm text-gray-500 mt-4">Verifying...</p>
      </div>
    </div>
  )
}
