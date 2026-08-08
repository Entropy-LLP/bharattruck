'use client'

/**
 * Password-reset landing (D-34). The single-use, 30-min reset link bt-auth-service emails
 * lands here as /auth/reset?token=… — outside the (app) auth gate, so a signed-out user can
 * complete it. The token is read from the URL client-side (no useSearchParams Suspense dance).
 *
 * NOTE: the emailed link only lands here if bt-auth-service's PASSWORD_RESET_URL points at
 * this app's origin. That is a backend env, set per deployment.
 */

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { Building2 } from 'lucide-react'
import { ApiError, resetPassword } from '@/lib/api'

const INPUT = 'w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500'

export default function ResetPasswordPage() {
  const [token, setToken] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => { setToken(new URLSearchParams(window.location.search).get('token')) }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault(); setError(null)
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError('The two passwords do not match.'); return }
    if (!token) { setError('This reset link is missing its token — request a new one.'); return }
    setBusy(true)
    try { await resetPassword(token, password); setDone(true) }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not reset the password'); setBusy(false) }
  }

  return (
    <div className="min-h-full flex items-center justify-center px-4 py-12 bg-gray-50">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center mb-3">
            <Building2 className="w-6 h-6 text-white" strokeWidth={2.2} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Set a new password</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-6 space-y-4">
          {done ? (
            <div className="text-center space-y-3">
              <p className="text-sm text-gray-700">Your password has been reset.</p>
              <Link href="/login" className="block w-full rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2.5">Sign in</Link>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label htmlFor="pw" className="block text-xs text-gray-400 uppercase tracking-wide mb-1.5">New password</label>
                <input id="pw" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={e => { setPassword(e.target.value); setError(null) }} className={INPUT} placeholder="At least 8 characters" />
              </div>
              <div>
                <label htmlFor="pw2" className="block text-xs text-gray-400 uppercase tracking-wide mb-1.5">Confirm password</label>
                <input id="pw2" type="password" required autoComplete="new-password" value={confirm} onChange={e => { setConfirm(e.target.value); setError(null) }} className={INPUT} placeholder="Re-enter it" />
              </div>
              {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">{error}</div>}
              <button type="submit" disabled={busy} className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold py-2.5 active:scale-[0.98] transition-transform">
                {busy ? 'Saving…' : 'Reset password'}
              </button>
            </form>
          )}
        </div>

        <p className="text-xs text-gray-400 text-center mt-4"><Link href="/login" className="hover:text-gray-600">Back to sign in</Link></p>
      </div>
    </div>
  )
}
