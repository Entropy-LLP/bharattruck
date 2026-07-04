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
const APP_ROLE = 'driver'
const POST_LOGIN_PATH = '/available'

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
    <div className="flex items-center justify-center min-h-screen px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <div className="text-center mb-6">
            <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10m10 0h-3m3 0h4a1 1 0 001-1v-5a1 1 0 00-.8-.97l-3.2-.64A1 1 0 0013 9.37V16" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">BharatTruck</h1>
            <p className="text-gray-500 text-sm mt-1">Driver App</p>
          </div>

          <div className="flex border-b border-gray-200 mb-5">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 pb-2.5 text-sm font-medium border-b-2 transition-colors ${
                  tab === t.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-400 hover:text-gray-600'
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

          <details className="mt-5 border-t border-gray-100 pt-4">
            <summary className="text-xs text-gray-400 cursor-pointer select-none">
              Dev: Paste JWT directly
            </summary>
            <div className="mt-3 space-y-3">
              <textarea
                value={devToken}
                onChange={e => setDevToken(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder="Paste JWT token..."
              />
              <button
                onClick={() => {
                  if (devToken.trim()) {
                    handleLogin(devToken.trim(), '')
                  }
                }}
                disabled={!devToken.trim()}
                className="w-full h-9 bg-gray-800 text-white rounded-lg text-xs font-medium disabled:opacity-40"
              >
                Use Token
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
      <form onSubmit={handleRegister} className="space-y-4">
        <p className="text-sm text-gray-600">Welcome! Complete your profile to continue.</p>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            minLength={2}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter your full name"
            autoFocus
          />
        </div>
        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="w-full h-11 bg-blue-600 text-white rounded-lg font-medium text-sm disabled:opacity-40"
        >
          {loading ? 'Saving...' : 'Complete Registration'}
        </button>
      </form>
    )
  }

  if (step === 'otp') {
    return (
      <form onSubmit={handleVerifyOtp} className="space-y-4">
        <p className="text-sm text-gray-600">
          Enter the 6-digit code sent to <strong>+91 {phone}</strong>
        </p>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={otp}
          onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-center text-lg font-mono tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="000000"
          autoFocus
        />
        <button
          type="submit"
          disabled={loading || otp.length !== 6}
          className="w-full h-11 bg-blue-600 text-white rounded-lg font-medium text-sm disabled:opacity-40"
        >
          {loading ? 'Verifying...' : 'Verify OTP'}
        </button>
        <button
          type="button"
          onClick={() => { setStep('phone'); setOtp('') }}
          className="w-full text-sm text-gray-500 hover:text-gray-700"
        >
          Change number
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={handleSendOtp} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
        <div className="flex">
          <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-gray-300 bg-gray-50 text-sm text-gray-500">
            +91
          </span>
          <input
            type="tel"
            inputMode="numeric"
            maxLength={10}
            value={phone}
            onChange={e => setPhone(e.target.value.replace(/\D/g, ''))}
            className="flex-1 rounded-r-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="9876543210"
            autoFocus
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={loading || phone.length !== 10}
        className="w-full h-11 bg-blue-600 text-white rounded-lg font-medium text-sm disabled:opacity-40"
      >
        {loading ? 'Sending...' : 'Send OTP'}
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
      <div className="py-6 text-center">
        <p className="text-sm text-gray-500">
          Google Sign-In not configured.
        </p>
        <p className="text-xs text-gray-400 mt-1">
          Set <code className="bg-gray-100 px-1 rounded">NEXT_PUBLIC_GOOGLE_CLIENT_ID</code> in .env.local
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4 py-2">
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={() => setGsiReady(true)}
      />
      <div ref={buttonRef} className="w-full flex justify-center" />
      {loading && <p className="text-sm text-gray-500 text-center">Signing in...</p>}
      {!gsiReady && !loading && (
        <p className="text-sm text-gray-400 text-center">Loading Google Sign-In...</p>
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
      <form onSubmit={handleVerify} className="space-y-4">
        <p className="text-sm text-gray-600">
          Enter the 6-digit code sent to <strong>{email}</strong>
        </p>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={otp}
          onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-center text-lg font-mono tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="000000"
          autoFocus
        />
        <button
          type="submit"
          disabled={loading || otp.length !== 6}
          className="w-full h-11 bg-blue-600 text-white rounded-lg font-medium text-sm disabled:opacity-40"
        >
          {loading ? 'Verifying...' : 'Verify Email'}
        </button>
        <button type="button" onClick={handleResend} className="w-full text-sm text-blue-600 hover:text-blue-700">
          Resend OTP
        </button>
        <button
          type="button"
          onClick={() => { setMode('login'); setOtp('') }}
          className="w-full text-sm text-gray-500 hover:text-gray-700"
        >
          Back to login
        </button>
      </form>
    )
  }

  if (mode === 'register') {
    return (
      <form onSubmit={handleRegister} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            minLength={2}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Your name"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={8}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Min 8 characters"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full h-11 bg-blue-600 text-white rounded-lg font-medium text-sm disabled:opacity-40"
        >
          {loading ? 'Creating account...' : 'Create Account'}
        </button>
        <button
          type="button"
          onClick={() => setMode('login')}
          className="w-full text-sm text-gray-500 hover:text-gray-700"
        >
          Already have an account? Sign in
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={handleLogin} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="you@example.com"
          autoFocus
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Your password"
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full h-11 bg-blue-600 text-white rounded-lg font-medium text-sm disabled:opacity-40"
      >
        {loading ? 'Signing in...' : 'Sign In'}
      </button>
      <button
        type="button"
        onClick={() => setMode('register')}
        className="w-full text-sm text-gray-500 hover:text-gray-700"
      >
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
      <div className="text-center py-4 space-y-3">
        <p className="text-3xl">&#9993;</p>
        <p className="text-sm text-gray-700">
          Sign-in link sent to <strong>{email}</strong>
        </p>
        <p className="text-xs text-gray-400">
          Check your email (or server console in dev mode)
        </p>
        <button
          onClick={() => { setSent(false); setEmail('') }}
          className="text-sm text-blue-600 hover:text-blue-700"
        >
          Try a different email
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSend} className="space-y-4">
      <p className="text-sm text-gray-600">
        We&apos;ll send you a sign-in link -- no password needed.
      </p>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="you@example.com"
          autoFocus
        />
      </div>
      <button
        type="submit"
        disabled={loading || !email}
        className="w-full h-11 bg-blue-600 text-white rounded-lg font-medium text-sm disabled:opacity-40"
      >
        {loading ? 'Sending...' : 'Send Magic Link'}
      </button>
    </form>
  )
}
