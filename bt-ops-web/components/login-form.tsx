'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Zap, Loader2, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '@/lib/auth'

// The `accent` theme token is shadowed by the shadcn `@theme inline` block in
// globals.css, so the brand orange is referenced literally here.
const LABEL = 'block text-sm font-medium text-white/70 mb-2'
const FIELD =
  'w-full h-12 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-[#FF7A00] focus:ring-2 focus:ring-[#FF7A00]/25'

export function LoginForm() {
  const router = useRouter()
  const { user, loading, login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Already authed as ops/admin -> skip the login screen.
  useEffect(() => {
    if (!loading && user) router.replace('/ops/dashboard')
  }, [loading, user, router])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email.trim() || !password) {
      setError('Enter your email and password')
      return
    }
    setSubmitting(true)
    try {
      await login(email.trim(), password)
      router.replace('/ops/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#070A11] px-4 py-10">
      {/* One soft accent wash behind the card — enough depth, no light show. */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[560px] -translate-x-1/2 rounded-full bg-[#FF7A00]/12 blur-[120px]" />

      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#FF7A00] shadow-lg shadow-[#FF7A00]/25">
            <Zap size={26} className="text-white" fill="white" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">BharatTruck</h1>
          <p className="mt-1.5 text-sm text-white/45">Operations Console</p>
        </div>

        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6 shadow-2xl shadow-black/40">
          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            <div>
              <label htmlFor="email" className={LABEL}>
                Email address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                className={FIELD}
                placeholder="admin@bharattruck.in"
              />
            </div>

            <div>
              <label htmlFor="password" className={LABEL}>
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className={`${FIELD} pr-12`}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-white/35 transition hover:text-white/80"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2.5 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
                <p className="text-sm text-red-300">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FF7A00] text-sm font-semibold text-white transition hover:bg-[#EA6E00] active:scale-[0.99] disabled:pointer-events-none disabled:opacity-45"
            >
              {submitting && <Loader2 size={16} className="animate-spin" />}
              {submitting ? 'Authenticating…' : 'Sign in to console'}
            </button>
          </form>

          <p className="mt-6 border-t border-white/[0.06] pt-5 text-center text-xs text-white/30">
            Authorized staff only
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-white/20">BharatTruck Ops Console · v1.0</p>
      </div>
    </div>
  )
}
