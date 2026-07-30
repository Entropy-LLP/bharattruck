'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { forgotPassword, ApiError } from '@/lib/api'
import { AuthShell, LABEL, FIELD, BTN_PRIMARY, HINT } from '@/lib/auth-ui'

/**
 * Step 1 of password reset: ask for the address, then show the same
 * confirmation whatever the answer.
 *
 * The server deliberately returns one generic message whether or not an account
 * exists — it will not confirm an address is registered, and it silently
 * absorbs its own hourly cap rather than reporting it. This screen must not
 * undo that: no "no account found", no "too many attempts", and the success
 * copy is phrased conditionally ("if an account exists").
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      // callback_url is left to the server, which picks the right app's reset
      // URL from the account's role — a driver who typed their address into the
      // shipper app should still be sent to the driver app.
      await forgotPassword(email.trim())
      setSent(true)
    } catch (err) {
      // A transport failure is the only thing worth surfacing; the endpoint
      // itself does not fail for unknown addresses.
      toast.error(err instanceof ApiError ? err.message : 'Could not send the reset link')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <AuthShell title="Check your email">
        <div className="space-y-5">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/12 border border-emerald-500/25">
            <svg className="h-6 w-6 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <p className={HINT}>
            If an account exists for{' '}
            <span className="font-medium text-foreground">{email.trim()}</span>, we have sent it a
            link to set a new password. The link expires shortly and can only be used once.
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground/80">
            Nothing arrived? Check your spam folder. Accounts that sign in with a phone OTP, Google
            or a magic link have no password to reset — use that method instead.
          </p>
          <button
            type="button"
            onClick={() => { setSent(false); setEmail('') }}
            className={BTN_PRIMARY}
          >
            Use a different email
          </button>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Reset your password">
      <form onSubmit={handleSubmit} className="space-y-5">
        <p className={HINT}>
          Enter the email address on your account and we will send you a link to set a new password.
        </p>

        <div>
          <label htmlFor="email" className={LABEL}>Email address</label>
          <input
            id="email"
            type="email"
            required
            autoFocus
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className={FIELD}
            placeholder="you@company.com"
          />
        </div>

        <button type="submit" disabled={loading || !email.trim()} className={BTN_PRIMARY}>
          {loading ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
    </AuthShell>
  )
}
