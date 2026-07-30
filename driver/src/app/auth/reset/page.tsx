'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { resetPassword, ApiError } from '@/lib/api'
import { AuthShell, LABEL, FIELD, BTN_PRIMARY, BTN_LINK, HINT } from '@/lib/auth-ui'

/**
 * Step 2 of password reset. Mounted at `/auth/reset` because that is the path
 * bt-auth-service builds its emailed link against (DRIVER_RESET_PASSWORD_URL,
 * falling back to `<origin>/auth/reset`) — moving this route breaks every link
 * already in someone's inbox.
 *
 * Token is read from `window.location.search` in an effect rather than via
 * `useSearchParams`, matching `auth/callback` — it keeps the route statically
 * renderable and out of a Suspense boundary. It is also deliberately never put
 * into React state that renders: a reset token in the DOM is a token in a
 * screenshot.
 */

const MIN_PASSWORD = 8

export default function ResetPasswordPage() {
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('token'))
    setReady(true)
  }, [])

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD
  const mismatch = confirm.length > 0 && password !== confirm
  const canSubmit =
    !loading && password.length >= MIN_PASSWORD && password === confirm

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token || !canSubmit) return

    setLoading(true)
    try {
      await resetPassword(token, password)
      setDone(true)
      // Every existing session was revoked server-side, so there is nothing to
      // carry over — send them back through the front door.
      setTimeout(() => router.replace('/login'), 2500)
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined
      if (code === 'INVALID_RESET_TOKEN') {
        // Terminal for this link: single-use and short-lived, so retrying the
        // same form cannot succeed. Drop back to requesting a fresh one.
        setToken(null)
        return
      }
      toast.error(err instanceof ApiError ? err.message : 'Could not reset your password')
    } finally {
      setLoading(false)
    }
  }

  // Wait for the effect before judging the token, otherwise the first paint
  // always accuses a perfectly good link of being invalid.
  if (!ready) {
    return (
      <AuthShell title="Reset your password">
        <div className="flex justify-center py-6">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </AuthShell>
    )
  }

  if (!token) {
    return (
      <AuthShell title="Link expired">
        <div className="space-y-5">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/12 border border-amber-500/25">
            <svg className="h-6 w-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.71-3.03l-6.93-11a2 2 0 00-3.42 0l-6.93 11A2 2 0 005.07 19z" />
            </svg>
          </div>
          <p className={HINT}>
            This reset link is invalid, has already been used, or has expired. Reset links work
            once and only for a short time.
          </p>
          <button type="button" onClick={() => router.push('/auth/forgot')} className={BTN_PRIMARY}>
            Request a new link
          </button>
        </div>
      </AuthShell>
    )
  }

  if (done) {
    return (
      <AuthShell title="Password updated">
        <div className="space-y-5">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/12 border border-emerald-500/25">
            <svg className="h-6 w-6 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className={HINT}>
            Your password has been changed and you have been signed out everywhere else. Taking you
            to sign in…
          </p>
          <button type="button" onClick={() => router.replace('/login')} className={BTN_PRIMARY}>
            Sign in now
          </button>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={handleSubmit} className="space-y-5">
        <p className={HINT}>
          Pick something you have not used here before. Signing in again elsewhere will need the new
          password.
        </p>

        <div>
          <label htmlFor="password" className={LABEL}>New password</label>
          <input
            id="password"
            type={show ? 'text' : 'password'}
            required
            autoFocus
            autoComplete="new-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className={FIELD}
            placeholder={`At least ${MIN_PASSWORD} characters`}
            aria-describedby="password-help"
          />
          <p
            id="password-help"
            className={`mt-2 text-xs ${tooShort ? 'text-red-500' : 'text-muted-foreground/80'}`}
          >
            {tooShort
              ? `Use at least ${MIN_PASSWORD} characters`
              : `Minimum ${MIN_PASSWORD} characters`}
          </p>
        </div>

        <div>
          <label htmlFor="confirm" className={LABEL}>Confirm new password</label>
          <input
            id="confirm"
            type={show ? 'text' : 'password'}
            required
            autoComplete="new-password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            className={FIELD}
            placeholder="Re-enter the password"
            aria-describedby={mismatch ? 'confirm-error' : undefined}
          />
          {mismatch && (
            <p id="confirm-error" className="mt-2 text-xs text-red-500">
              Passwords do not match
            </p>
          )}
        </div>

        <button type="button" onClick={() => setShow(s => !s)} className={BTN_LINK}>
          {show ? 'Hide passwords' : 'Show passwords'}
        </button>

        <button type="submit" disabled={!canSubmit} className={BTN_PRIMARY}>
          {loading ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </AuthShell>
  )
}
