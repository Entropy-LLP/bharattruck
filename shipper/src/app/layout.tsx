import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Toaster } from 'sonner'
import { AuthProvider } from '@/lib/auth'
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
  title: 'BharatTruck Shipper',
  description: 'Shipper dashboard for BharatTruck logistics platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Dark-only by design, matching the driver app: there is no theme switcher,
    // so the class is pinned rather than toggled. Without it the `:root` light
    // palette wins and pages that use tokens render light while pages that
    // hardcode dark colours stay dark — which is how this app got a dark
    // dashboard next to a white new-booking form.
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </head>
      <body className="h-full bg-background text-foreground">
        <AuthProvider>
          {children}
          <Toaster position="top-center" richColors closeButton />
        </AuthProvider>
      </body>
    </html>
  )
}
