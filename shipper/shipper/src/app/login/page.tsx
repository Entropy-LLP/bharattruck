'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Script from 'next/script'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import {
  sendPhoneOtp,
  verifyPhoneOtp,
  googleSignIn,
  emailRegister,
  emailVerify,
  emailLogin,
  emailResendOtp,
  sendMagicLink,
  registerProfile,
  setToken,
  ApiError,
  type AuthUser,
} from '@/lib/api'

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''
const APP_ROLE = 'shipper'
const POST_LOGIN_PATH = '/dashboard'

// Shared control styles. `blue-*` is the app's accent token, tuned to the
// BharatTruck brand blue in globals.css.
const LABEL = 'block text-sm font-medium text-foreground/75 mb-2'
const FIELD =
  'w-full h-12 rounded-xl border border-border bg-secondary px-4 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-600/25'
const FIELD_OTP = `${FIELD} text-center text-lg font-mono tracking-[0.4em]`
const BTN_PRIMARY =
  'w-full h-12 rounded-xl bg-blue-600 text-sm font-semibold text-white transition hover:bg-blue-700 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-35'
const BTN_QUIET = 'w-full text-sm text-muted-foreground transition hover:text-foreground'
const BTN_LINK = 'w-full text-sm font-medium text-blue-600 transition hover:text-blue-500'
const HINT = 'text-sm leading-relaxed text-muted-foreground'

type Tab = 'phone' | 'google' | 'email' | 'magic-link'
type LoginHandler = (at: string, rt: string, u?: AuthUser) => void

const TABS: { id: Tab; label: string }[] = [
  { id: 'phone', label: 'Phone' },
  { id: 'google', label: 'Google' },
  { id: 'email', label: 'Email' },
  { id: 'magic-link', label: 'Magic Link' },
]

export default function LoginPage() {
  const [tab, setTab] = useState<Tab>('phone')
  const [devToken, setDevToken] = useState('')
  const { login, token, isReady } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (isReady && token) router.replace(POST_LOGIN_PATH)
  }, [isReady, token, router])

  const handleLogin: LoginHandler = (accessToken, refreshToken, user) => {
    login(accessToken, refreshToken, user)
    toast.success('Signed in!')
    router.push(POST_LOGIN_PATH)
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      {/* One soft accent wash behind the card — enough depth, no light show. */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[560px] -translate-x-1/2 rounded-full bg-blue-600/12 blur-[120px]" />

      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 shadow-lg shadow-blue-600/25">
            <svg className="h-7 w-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">BharatTruck</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Shipper Portal</p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-2xl shadow-black/40">
          {/* Segmented method picker — bigger tap targets, and the selected
              method stays obvious at a glance. */}
          <div className="mb-6 grid grid-cols-4 gap-1 rounded-xl bg-secondary p-1">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`rounded-lg px-1 py-2 text-[13px] font-medium transition ${
                  tab === t.id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'phone' && <PhoneOtpForm onLogin={handleLogin} />}
          {tab === 'google' && <GoogleSignInForm onLogin={handleLogin} />}
          {tab === 'email' && <EmailAuthForm onLogin={handleLogin} />}
          {tab === 'magic-link' && <MagicLinkForm />}

          <details className="group mt-6 border-t border-border pt-5">
            <summary className="cursor-pointer list-none select-none text-xs text-muted-foreground/80 transition hover:text-foreground/75">
              Developer sandbox access
            </summary>
            <div className="mt-4 space-y-3">
              <textarea
                value={devToken}
                onChange={e => setDevToken(e.target.value)}
                rows={2}
                className="w-full resize-none rounded-xl border border-border bg-secondary px-3 py-2.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-600/25"
                placeholder="Paste mock JWT, or use the button below"
              />
              <button
                onClick={() => handleLogin('mock-jwt-shipper-token', '')}
                className="h-10 w-full rounded-xl border border-border bg-secondary text-xs font-medium text-foreground/85 transition hover:border-blue-600/40 hover:text-foreground"
              >
                Instant mock shipper sign-in
              </button>
            </div>
          </details>
        </div>
      </div>
    </div>
  )
}

// ─── Phone OTP ──────────────────────────────────────────────────

function PhoneOtpForm({ onLogin }: { onLogin: LoginHandler }) {
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState<'phone' | 'otp' | 'register'>('phone')
  const [loading, setLoading] = useState(false)
  const [tokens, setTokens] = useState<{ access_token: string; refresh_token: string } | null>(null)
  const [name, setName] = useState('')

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await sendPhoneOtp(phone)
      toast.success('OTP sent! Check your phone (or server console in dev mode)')
      setStep('otp')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to send OTP')
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const data = await verifyPhoneOtp(phone, otp)
      if (data.is_new_user) {
        setTokens({ access_token: data.access_token, refresh_token: data.refresh_token })
        setStep('register')
      } else {
        onLogin(data.access_token, data.refresh_token, data.user)
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to verify OTP')
    } finally {
      setLoading(false)
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    if (!tokens) return
    setLoading(true)
    try {
      setToken(tokens.access_token)
      const data = await registerProfile({ full_name: name, role: APP_ROLE })
      onLogin(tokens.access_token, tokens.refresh_token, data.user)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to complete registration')
    } finally {
      setLoading(false)
    }
  }

  if (step === 'register') {
    return (
      <form onSubmit={handleRegister} className="space-y-5">
        <p className={HINT}>Welcome! Complete your profile to continue.</p>
        <div>
          <label className={LABEL}>Full name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            minLength={2}
            className={FIELD}
            placeholder="Enter your full name"
            autoFocus
          />
        </div>
        <button type="submit" disabled={loading || !name.trim()} className={BTN_PRIMARY}>
          {loading ? 'Saving…' : 'Complete registration'}
        </button>
      </form>
    )
  }

  if (step === 'otp') {
    return (
      <form onSubmit={handleVerifyOtp} className="space-y-5">
        <p className={HINT}>
          Enter the 6-digit code sent to <span className="font-medium text-foreground">+91 {phone}</span>
        </p>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={otp}
          onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
          className={FIELD_OTP}
          placeholder="000000"
          autoFocus
        />
        <button type="submit" disabled={loading || otp.length !== 6} className={BTN_PRIMARY}>
          {loading ? 'Verifying…' : 'Verify OTP'}
        </button>
        <button type="button" onClick={() => { setStep('phone'); setOtp('') }} className={BTN_QUIET}>
          Change number
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={handleSendOtp} className="space-y-5">
      <div>
        <label className={LABEL}>Phone number</label>
        {/* Country code sits inside the field so it reads as one control. */}
        <div className="flex h-12 items-center rounded-xl border border-border bg-secondary transition focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-600/25">
          <span className="select-none pl-4 text-sm text-muted-foreground">+91</span>
          <span className="mx-3 h-5 w-px bg-secondary" />
          <input
            type="tel"
            inputMode="numeric"
            maxLength={10}
            value={phone}
            onChange={e => setPhone(e.target.value.replace(/\D/g, ''))}
            className="h-full flex-1 rounded-r-xl bg-transparent pr-4 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none"
            placeholder="9876543210"
            autoFocus
          />
        </div>
      </div>
      <button type="submit" disabled={loading || phone.length !== 10} className={BTN_PRIMARY}>
        {loading ? 'Sending…' : 'Send OTP'}
      </button>
    </form>
  )
}

// ─── Google Sign-In ─────────────────────────────────────────────

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: Record<string, unknown>) => void
          renderButton: (el: HTMLElement, config: Record<string, unknown>) => void
        }
      }
    }
  }
}

function GoogleSignInForm({ onLogin }: { onLogin: LoginHandler }) {
  const buttonRef = useRef<HTMLDivElement>(null)
  const [gsiReady, setGsiReady] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleCredential = useCallback(
    async (response: { credential: string }) => {
      setLoading(true)
      try {
        const data = await googleSignIn(response.credential, APP_ROLE)
        onLogin(data.access_token, data.refresh_token, data.user)
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : 'Google sign-in failed')
      } finally {
        setLoading(false)
      }
    },
    [onLogin],
  )

  useEffect(() => {
    if (!gsiReady || !buttonRef.current || !window.google) return
    if (!GOOGLE_CLIENT_ID) return

    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleCredential,
    })
    window.google.accounts.id.renderButton(buttonRef.current, {
      theme: 'outline',
      size: 'large',
      width: buttonRef.current.offsetWidth,
      text: 'signin_with',
    })
  }, [gsiReady, handleCredential])

  if (!GOOGLE_CLIENT_ID) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-6 text-center">
        <p className="text-sm font-medium text-foreground/75">Google sign-in isn&apos;t configured</p>
        <p className="mt-1.5 text-xs text-muted-foreground/80">
          Set <code className="rounded bg-secondary px-1.5 py-0.5 font-mono">NEXT_PUBLIC_GOOGLE_CLIENT_ID</code> in .env.local
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4 py-1">
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={() => setGsiReady(true)}
      />
      <div ref={buttonRef} className="flex w-full justify-center" />
      {loading && <p className="text-center text-sm text-muted-foreground">Signing in…</p>}
      {!gsiReady && !loading && (
        <p className="text-center text-sm text-muted-foreground/80">Loading Google sign-in…</p>
      )}
    </div>
  )
}

// ─── Email / Password ───────────────────────────────────────────

function EmailAuthForm({ onLogin }: { onLogin: LoginHandler }) {
  const [mode, setMode] = useState<'login' | 'register' | 'verify'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const data = await emailLogin(email, password)
      onLogin(data.access_token, data.refresh_token, data.user)
    } catch (err) {
      if (err instanceof ApiError && err.message.toLowerCase().includes('not verified')) {
        toast.info('Email not verified. Enter the OTP sent to your email.')
        setMode('verify')
      } else {
        toast.error(err instanceof ApiError ? err.message : 'Login failed')
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await emailRegister(email, password, name, APP_ROLE)
      toast.success('Verification OTP sent to your email!')
      setMode('verify')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const data = await emailVerify(email, otp)
      onLogin(data.access_token, data.refresh_token, data.user)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleResend() {
    try {
      await emailResendOtp(email)
      toast.success('OTP resent!')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to resend')
    }
  }

  if (mode === 'verify') {
    return (
      <form onSubmit={handleVerify} className="space-y-5">
        <p className={HINT}>
          Enter the 6-digit code sent to <span className="font-medium text-foreground">{email}</span>
        </p>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={otp}
          onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
          className={FIELD_OTP}
          placeholder="000000"
          autoFocus
        />
        <button type="submit" disabled={loading || otp.length !== 6} className={BTN_PRIMARY}>
          {loading ? 'Verifying…' : 'Verify email'}
        </button>
        <button type="button" onClick={handleResend} className={BTN_LINK}>
          Resend OTP
        </button>
        <button type="button" onClick={() => { setMode('login'); setOtp('') }} className={BTN_QUIET}>
          Back to sign in
        </button>
      </form>
    )
  }

  if (mode === 'register') {
    return (
      <form onSubmit={handleRegister} className="space-y-5">
        <div>
          <label className={LABEL}>Full name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            minLength={2}
            className={FIELD}
            placeholder="Your name"
            autoFocus
          />
        </div>
        <div>
          <label className={LABEL}>Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            className={FIELD}
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label className={LABEL}>Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={8}
            className={FIELD}
            placeholder="At least 8 characters"
          />
        </div>
        <button type="submit" disabled={loading} className={BTN_PRIMARY}>
          {loading ? 'Creating account…' : 'Create account'}
        </button>
        <button type="button" onClick={() => setMode('login')} className={BTN_QUIET}>
          Already have an account? Sign in
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={handleLogin} className="space-y-5">
      <div>
        <label className={LABEL}>Email</label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          className={FIELD}
          placeholder="you@example.com"
          autoFocus
        />
      </div>
      <div>
        <label className={LABEL}>Password</label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          className={FIELD}
          placeholder="Your password"
        />
      </div>
      <button type="submit" disabled={loading} className={BTN_PRIMARY}>
        {loading ? 'Signing in…' : 'Sign in'}
      </button>
      <button type="button" onClick={() => setMode('register')} className={BTN_QUIET}>
        New here? Create an account
      </button>
    </form>
  )
}

// ─── Magic Link ─────────────────────────────────────────────────

function MagicLinkForm() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await sendMagicLink(email, APP_ROLE)
      setSent(true)
      toast.success('Magic link sent!')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to send')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="space-y-4 py-2 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-600/15 text-xl text-blue-600">
          &#9993;
        </div>
        <p className="text-sm text-foreground/85">
          Sign-in link sent to <span className="font-medium text-foreground">{email}</span>
        </p>
        <p className="text-xs text-muted-foreground/80">Check your email (or server console in dev mode)</p>
        <button onClick={() => { setSent(false); setEmail('') }} className={BTN_LINK}>
          Try a different email
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSend} className="space-y-5">
      <p className={HINT}>We&apos;ll email you a sign-in link — no password needed.</p>
      <div>
        <label className={LABEL}>Email</label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          className={FIELD}
          placeholder="you@example.com"
          autoFocus
        />
      </div>
      <button type="submit" disabled={loading || !email} className={BTN_PRIMARY}>
        {loading ? 'Sending…' : 'Send magic link'}
      </button>
    </form>
  )
}
