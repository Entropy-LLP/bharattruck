'use client'

/**
 * The ONE front door (D-36). Every persona signs in here and lands on the same Home feed;
 * capabilities decide what they see. This page carries the full auth surface (D-32/D-34):
 *   - sign in (email + password)
 *   - create an account, declaring a PRIMARY PERSONA (shipper / driver / fleet owner) — the
 *     front door that shapes onboarding, and gates nothing — then verify a 6-digit email code
 *   - forgot password (single-origin, single-use, expiring reset link → /auth/reset)
 *   - Continue with Google (shown only when a Google client id is configured)
 */

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, ArrowLeft } from 'lucide-react'
import {
  ApiError, loginWithEmail, registerWithEmail, verifyEmailOtp, resendEmailOtp,
  forgotPassword, googleSignIn, type PrimaryPersona,
} from '@/lib/api'
import { useAuth } from '@/lib/auth'
import type { AuthUser } from '@/lib/types'

type Mode = 'signin' | 'register' | 'verify' | 'forgot'

const PERSONAS: { value: PrimaryPersona; label: string; hint: string }[] = [
  { value: 'shipper', label: 'I ship goods', hint: 'Post loads, track deliveries' },
  { value: 'driver', label: 'I drive a truck', hint: 'Find work, run trips' },
  { value: 'fleet_owner', label: 'I run a fleet', hint: 'Trucks, drivers, bids' },
]

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID

const INPUT = 'w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-shadow'
const LABEL = 'block text-xs text-gray-400 uppercase tracking-wide mb-1.5'

export default function LoginPage() {
  const router = useRouter()
  const { login } = useAuth()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [persona, setPersona] = useState<PrimaryPersona>('shipper')
  const [otp, setOtp] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const finishLogin = useCallback((d: { access_token: string; refresh_token: string; user?: AuthUser }) => {
    login(d.access_token, d.refresh_token, d.user)
    router.replace('/home')
  }, [login, router])

  function go(next: Mode) { setMode(next); setError(null); setNotice(null) }

  async function doSignin(e: FormEvent) {
    e.preventDefault(); setError(null); setBusy(true)
    try { finishLogin(await loginWithEmail(email.trim(), password)) }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not sign in'); setBusy(false) }
  }

  async function doRegister(e: FormEvent) {
    e.preventDefault(); setError(null); setBusy(true)
    try {
      await registerWithEmail(email.trim(), password, fullName.trim(), persona)
      setNotice(`We sent a 6-digit code to ${email.trim()}.`)
      setMode('verify'); setBusy(false)
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not create the account'); setBusy(false) }
  }

  async function doVerify(e: FormEvent) {
    e.preventDefault(); setError(null); setBusy(true)
    try {
      await verifyEmailOtp(email.trim(), otp.trim())
      // verify may or may not return tokens; log in with the password we still hold, either way.
      finishLogin(await loginWithEmail(email.trim(), password))
    } catch (err) { setError(err instanceof ApiError ? err.message : 'That code did not work — check it or resend.'); setBusy(false) }
  }

  async function doResend() {
    setError(null)
    try { await resendEmailOtp(email.trim()); setNotice('A new code has been sent.') }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not resend the code') }
  }

  async function doForgot(e: FormEvent) {
    e.preventDefault(); setError(null); setBusy(true)
    try { await forgotPassword(email.trim()); setNotice('If an account exists for that email, a reset link is on its way.'); setBusy(false) }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not send the reset link'); setBusy(false) }
  }

  // Google Identity Services — rendered only when a client id is configured (else the
  // button is a dead end, since bt-auth-service's /auth/google needs GOOGLE_CLIENT_ID too).
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || (mode !== 'signin' && mode !== 'register')) return
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'; script.async = true; script.defer = true
    script.onload = () => {
      const g = (window as unknown as { google?: { accounts?: { id?: { initialize: (o: unknown) => void; renderButton: (el: HTMLElement, o: unknown) => void } } } }).google
      if (!g?.accounts?.id) return
      g.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (resp: { credential: string }) => {
          try { finishLogin(await googleSignIn(resp.credential, persona)) }
          catch (err) { setError(err instanceof ApiError ? err.message : 'Google sign-in failed') }
        },
      })
      const el = document.getElementById('google-btn')
      if (el) g.accounts.id.renderButton(el, { theme: 'outline', size: 'large', width: 320, text: 'continue_with' })
    }
    document.body.appendChild(script)
    return () => { script.remove() }
  }, [mode, persona, finishLogin])

  const title = mode === 'register' ? 'Create your account'
    : mode === 'verify' ? 'Verify your email'
      : mode === 'forgot' ? 'Reset your password' : 'BharatTruck'

  return (
    <div className="min-h-full flex items-center justify-center px-4 py-12 bg-gray-50">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center mb-3">
            <Building2 className="w-6 h-6 text-white" strokeWidth={2.2} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          {mode === 'signin' && <p className="text-sm text-gray-500 mt-1">One login for every load and every truck</p>}
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-6 space-y-4">
          {(mode === 'register' || mode === 'verify' || mode === 'forgot') && (
            <button onClick={() => go('signin')} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 -mt-1">
              <ArrowLeft className="w-4 h-4" /> Back to sign in
            </button>
          )}

          {/* ── SIGN IN ── */}
          {mode === 'signin' && (
            <form onSubmit={doSignin} className="space-y-4">
              <Field id="email" label="Email"><input id="email" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className={INPUT} placeholder="you@company.in" /></Field>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="password" className="text-xs text-gray-400 uppercase tracking-wide">Password</label>
                  <button type="button" onClick={() => go('forgot')} className="text-xs font-medium text-blue-600 hover:text-blue-700">Forgot?</button>
                </div>
                <input id="password" type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className={INPUT} placeholder="••••••••" />
              </div>
              <Alerts error={error} notice={notice} />
              <Submit busy={busy} label="Sign in" busyLabel="Signing in…" />
              {GOOGLE_CLIENT_ID && <><Divider /><div id="google-btn" className="flex justify-center" /></>}
              <p className="text-sm text-gray-500 text-center pt-1">
                New here? <button type="button" onClick={() => go('register')} className="font-semibold text-blue-600 hover:text-blue-700">Create an account</button>
              </p>
            </form>
          )}

          {/* ── REGISTER ── */}
          {mode === 'register' && (
            <form onSubmit={doRegister} className="space-y-4">
              <div>
                <span className={LABEL}>I am a…</span>
                <div className="grid grid-cols-1 gap-2">
                  {PERSONAS.map(p => (
                    <button key={p.value} type="button" onClick={() => setPersona(p.value)}
                      className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${persona === p.value ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                      <span className="block text-sm font-medium text-gray-900">{p.label}</span>
                      <span className="block text-xs text-gray-500">{p.hint}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-gray-400">This shapes where you start — it never limits what you can do.</p>
              </div>
              <Field id="full_name" label="Full name"><input id="full_name" type="text" required autoComplete="name" value={fullName} onChange={e => setFullName(e.target.value)} className={INPUT} placeholder="Rajesh Kumar" /></Field>
              <Field id="r-email" label="Email"><input id="r-email" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className={INPUT} placeholder="you@company.in" /></Field>
              <Field id="r-password" label="Password"><input id="r-password" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} className={INPUT} placeholder="At least 8 characters" /></Field>
              <Alerts error={error} notice={notice} />
              <Submit busy={busy} label="Create account" busyLabel="Creating…" />
              {GOOGLE_CLIENT_ID && <><Divider /><div id="google-btn" className="flex justify-center" /></>}
            </form>
          )}

          {/* ── VERIFY EMAIL OTP ── */}
          {mode === 'verify' && (
            <form onSubmit={doVerify} className="space-y-4">
              <p className="text-sm text-gray-600">Enter the 6-digit code we sent to <span className="font-medium text-gray-900 break-all">{email}</span>.</p>
              <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={otp}
                onChange={e => { setOtp(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(null) }}
                className={`${INPUT} text-center text-lg font-semibold tracking-[0.4em]`} placeholder="000000" />
              <Alerts error={error} notice={notice} />
              <Submit busy={busy} label="Verify & continue" busyLabel="Verifying…" disabled={otp.length !== 6} />
              <p className="text-sm text-gray-500 text-center">
                Didn&apos;t get it? <button type="button" onClick={doResend} className="font-semibold text-blue-600 hover:text-blue-700">Resend code</button>
              </p>
            </form>
          )}

          {/* ── FORGOT ── */}
          {mode === 'forgot' && (
            <form onSubmit={doForgot} className="space-y-4">
              <p className="text-sm text-gray-600">Enter your email and we&apos;ll send a link to reset your password.</p>
              <Field id="f-email" label="Email"><input id="f-email" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className={INPUT} placeholder="you@company.in" /></Field>
              <Alerts error={error} notice={notice} />
              <Submit busy={busy} label="Send reset link" busyLabel="Sending…" />
            </form>
          )}
        </div>

        <p className="text-xs text-gray-400 text-center mt-4">Shippers, drivers and fleet owners — one BharatTruck account.</p>
      </div>
    </div>
  )
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <div><label htmlFor={id} className={LABEL}>{label}</label>{children}</div>
}
function Alerts({ error, notice }: { error: string | null; notice: string | null }) {
  return (
    <>
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">{error}</div>}
      {notice && !error && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">{notice}</div>}
    </>
  )
}
function Submit({ busy, label, busyLabel, disabled }: { busy: boolean; label: string; busyLabel: string; disabled?: boolean }) {
  return (
    <button type="submit" disabled={busy || disabled}
      className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold py-2.5 active:scale-[0.98] transition-transform">
      {busy ? busyLabel : label}
    </button>
  )
}
function Divider() {
  return <div className="flex items-center gap-3 py-0.5"><span className="h-px flex-1 bg-gray-100" /><span className="text-xs text-gray-400">or</span><span className="h-px flex-1 bg-gray-100" /></div>
}
