'use client'

import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { toast } from 'sonner'

export default function Navbar() {
  const router = useRouter()
  const pathname = usePathname()
  const { logout } = useAuth()

  function handleLogout() {
    logout()
    toast.success('Logged out')
    router.push('/login')
  }

  const isActive = (path: string) =>
    pathname === path || pathname.startsWith(path + '/')

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-1">
            <Link href="/dashboard" className="font-bold text-lg text-gray-900 mr-4">
              BharatTruck
            </Link>
            <Link
              href="/dashboard"
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive('/dashboard')
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              My Bookings
            </Link>
            <Link
              href="/bookings/new"
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                pathname === '/bookings/new'
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              New Booking
            </Link>
          </div>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Logout
          </button>
        </div>
      </div>
    </nav>
  )
}
