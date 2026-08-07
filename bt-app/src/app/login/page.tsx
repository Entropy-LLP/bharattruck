'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2 } from 'lucide-react'
import { loginWithEmail, ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'

export default function LoginPage() {
  const router = useRouter()
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const data = await loginWithEmail(email.trim(), password)
      // No role gate: bt-app is the ONE front door for every persona (D-36). Whatever
      // this human may do is decided by their capabilities, and the shell reveals only
      // those surfaces — a shipper, a driver, a fleet owner and a distributor all sign
      // in here and land on the same Home feed.
      login(data.access_token, data.refresh_token, data.user)
      router.replace('/home')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in')
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center px-4 py-12 bg-gray-50">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center mb-3">
            <Building2 className="w-6 h-6 text-white" strokeWidth={2.2} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">BharatTruck</h1>
          <p className="text-sm text-gray-500 mt-1">One login for every load and every truck</p>
        </div>

        <form onSubmit={onSubmit} className="bg-white rounded-2xl shadow-lg p-6 space-y-4">
          <div>
            <label htmlFor="email" className="block text-xs text-gray-400 uppercase tracking-wide mb-1.5">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
              placeholder="you@company.in"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-xs text-gray-400 uppercase tracking-wide mb-1.5">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold py-2.5 active:scale-[0.98] transition-transform"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-xs text-gray-400 text-center mt-4">
          Shippers, drivers and fleet owners — one BharatTruck account.
        </p>
      </div>
    </div>
  )
}
