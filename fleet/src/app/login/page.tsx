'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2 } from 'lucide-react'
import { loginWithEmail, getMe, setToken, setRefreshToken, clearToken, clearRefreshToken, ApiError } from '@/lib/api'
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
      // Persist tokens before /auth/me so the capability check can authenticate.
      setToken(data.access_token)
      if (data.refresh_token) setRefreshToken(data.refresh_token)

      // De-roled (FB-11): gate on operate / fleet profile, not JWT role.
      // A distributor whose primary_persona is still 'shipper' but who owns a fleet
      // must be able to open this console.
      const me = await getMe().catch(() => null)
      const caps = me?.personas
      const canOperate =
        !!caps?.fleet_owner_id ||
        !!caps?.capabilities?.includes('operate') ||
        data.user.role === 'fleet_owner'
      if (!canOperate) {
        clearToken()
        clearRefreshToken()
        setError(
          data.user.role === 'driver'
            ? 'This is the fleet-owner console. Drivers should use the driver app.'
            : 'This account has no fleet profile — register a fleet first, or use the shipper app.',
        )
        setBusy(false)
        return
      }
      login(data.access_token, data.refresh_token, data.user)
      router.replace('/dashboard')
    } catch (err) {
      clearToken()
      clearRefreshToken()
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
          <h1 className="text-2xl font-bold text-gray-900">Fleet Console</h1>
          <p className="text-sm text-gray-500 mt-1">BharatTruck</p>
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
          Fleet owners only. Drivers use the BharatTruck driver app.
        </p>
      </div>
    </div>
  )
}
