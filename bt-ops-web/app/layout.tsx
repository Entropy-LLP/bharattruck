import type { Metadata } from 'next'
import { Providers } from '@/components/providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'BharatTruck Admin',
  description: 'Operations & Admin Panel',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
