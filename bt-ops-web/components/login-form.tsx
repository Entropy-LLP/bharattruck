'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Zap, Loader2 } from 'lucide-react'
import { useAuth } from '@/lib/auth'

export function LoginForm() {
  const router = useRouter()
  const { user, loading, login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
    <div className="min-h-screen dark:bg-[#09090B] bg-[#FAFAFA] flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
          w-[600px] h-[600px] rounded-full bg-[#F97316]/5 blur-[120px]" />
      </div>

      <div className="w-full max-w-sm relative">
        <div className="flex flex-col items-center mb-10">
          <div className="w-14 h-14 rounded-2xl bg-[#F97316] flex items-center justify-center mb-5 shadow-lg shadow-[#F97316]/20">
            <Zap size={28} className="text-white" fill="white" />
          </div>
          <h1 className="text-2xl font-bold dark:text-white text-[#09090B] tracking-tight">
            BharatTruck
          </h1>
          <p className="text-sm dark:text-[#888] text-[#71717A] mt-1">
            Operations Console — sign in
          </p>
        </div>

        <div className="dark:bg-[#111111] bg-white rounded-2xl border dark:border-[#2A2A2A] border-[#E4E4E7] p-6 shadow-xl shadow-black/10">
          <form onSubmit={handleSubmit} noValidate>
            <div className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium dark:text-[#CCC] text-[#09090B] mb-1.5">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  className="w-full px-4 py-3 rounded-xl text-sm
                    dark:bg-[#1A1A1A] bg-[#F4F4F5] dark:border-[#2A2A2A] border-[#E4E4E7] border
                    dark:text-white text-[#09090B] dark:placeholder-[#555] placeholder-[#A1A1AA]
                    focus:outline-none focus:border-[#F97316] transition-colors"
                  placeholder="you@bharattruck.in"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium dark:text-[#CCC] text-[#09090B] mb-1.5">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="w-full px-4 py-3 rounded-xl text-sm
                    dark:bg-[#1A1A1A] bg-[#F4F4F5] dark:border-[#2A2A2A] border-[#E4E4E7] border
                    dark:text-white text-[#09090B]
                    focus:outline-none focus:border-[#F97316] transition-colors"
                  placeholder="••••••••"
                />
              </div>

              {error && (
                <p className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 rounded-xl font-semibold text-sm text-white
                  bg-[#F97316] hover:bg-[#EA6E00] transition-all active:scale-[0.98]
                  shadow-lg shadow-[#F97316]/20 disabled:opacity-60 disabled:cursor-not-allowed
                  flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 size={15} className="animate-spin" />}
                {submitting ? 'Signing in…' : 'Sign in'}
              </button>
            </div>
          </form>

          <p className="mt-5 pt-5 dark:border-[#2A2A2A] border-[#E4E4E7] border-t text-center text-xs dark:text-[#555] text-[#A1A1AA]">
            Authorized operations staff only
          </p>
        </div>

        <p className="text-center text-xs dark:text-[#555] text-[#A1A1AA] mt-6">
          BharatTruck Operations Console v1.0
        </p>
      </div>
    </div>
  )
}
