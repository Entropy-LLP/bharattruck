import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Toaster } from 'sonner'
import { AuthProvider } from '@/lib/auth'
import { RegisterSW } from '@/components/register-sw'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'BharatTruck Driver',
  description: 'Driver app for BharatTruck logistics platform',
  // Next auto-links /manifest.webmanifest from app/manifest.ts; declare it
  // explicitly too so the PWA is unambiguously installable.
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'BT Driver' },
}

export const viewport: Viewport = {
  themeColor: '#070A11',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Dark-only by design: the login screen and the whole driver shell share one
    // palette, and the app is read in a truck cab (often at night). There is no
    // theme switcher, so the class is pinned rather than toggled.
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="h-full bg-background text-foreground">
        <AuthProvider>
          {children}
          <Toaster position="top-center" richColors closeButton />
        </AuthProvider>
        <RegisterSW />
      </body>
    </html>
  )
}
