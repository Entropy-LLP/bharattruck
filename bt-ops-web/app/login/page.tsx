import type { Metadata } from 'next'
import { Zap } from 'lucide-react'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Login' }

export default function LoginPage() {
  return (
    <div className="min-h-screen dark:bg-[#09090B] bg-[#FAFAFA] flex items-center justify-center p-4">

      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
          w-[600px] h-[600px] rounded-full
          bg-[#F97316]/5 blur-[120px]" />
      </div>

      <div className="w-full max-w-sm relative">

        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <div className="w-14 h-14 rounded-2xl bg-[#F97316] flex items-center justify-center mb-5 shadow-lg shadow-[#F97316]/20">
            <Zap size={28} className="text-white" fill="white" />
          </div>
          <h1 className="text-2xl font-bold dark:text-white text-[#09090B] tracking-tight">
            BharatTruck
          </h1>
          <p className="text-sm dark:text-[#888] text-[#71717A] mt-1">
            Sign in to your portal
          </p>
        </div>

        {/* Card */}
        <div className="dark:bg-[#111111] bg-white rounded-2xl border dark:border-[#2A2A2A] border-[#E4E4E7] p-6 shadow-xl shadow-black/10">

          <form action="/ops/dashboard" method="get">
            <div className="space-y-4">

              <div>
                <label className="block text-sm font-medium dark:text-[#CCC] text-[#09090B] mb-1.5">
                  Email address
                </label>
                <input
                  type="email"
                  defaultValue="ops@bharattruck.in"
                  className="w-full px-4 py-3 rounded-xl text-sm
                    dark:bg-[#1A1A1A] bg-[#F4F4F5]
                    dark:border-[#2A2A2A] border-[#E4E4E7] border
                    dark:text-white text-[#09090B]
                    dark:placeholder-[#555] placeholder-[#A1A1AA]
                    focus:outline-none focus:border-[#F97316]
                    transition-colors"
                  placeholder="you@bharattruck.in"
                />
              </div>

              <div>
                <label className="block text-sm font-medium dark:text-[#CCC] text-[#09090B] mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  defaultValue="password"
                  className="w-full px-4 py-3 rounded-xl text-sm
                    dark:bg-[#1A1A1A] bg-[#F4F4F5]
                    dark:border-[#2A2A2A] border-[#E4E4E7] border
                    dark:text-white text-[#09090B]
                    focus:outline-none focus:border-[#F97316]
                    transition-colors"
                  placeholder="••••••••"
                />
              </div>

              <button
                type="submit"
                className="w-full py-3 rounded-xl font-semibold text-sm text-white
                  bg-[#F97316] hover:bg-[#EA6E00]
                  transition-all active:scale-[0.98] shadow-lg shadow-[#F97316]/20"
              >
                Sign in
              </button>

            </div>
          </form>

          <div className="mt-5 pt-5 dark:border-[#2A2A2A] border-[#E4E4E7] border-t">
            <p className="text-center text-xs dark:text-[#555] text-[#A1A1AA]">
              Fleet Operator?{' '}
              <Link href="/portal/dashboard"
                className="text-[#F97316] hover:underline font-medium">
                Fleet Portal →
              </Link>
            </p>
          </div>
        </div>

        <p className="text-center text-xs dark:text-[#555] text-[#A1A1AA] mt-6">
          BharatTruck Operations Console v1.0
        </p>
      </div>
    </div>
  )
}
