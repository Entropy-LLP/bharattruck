'use client'

// Public receiver POD page — the page the consignee opens from the
// emailed OTP. It is PUBLIC (no auth/JWT): the receiver has no account.
// It deliberately does NOT use the authed api client (which attaches a
// Bearer and hard-redirects to /login on 401); it hits the gateway with
// a raw fetch. On a verified OTP, booking-service internally flips the
// trip in_transit → completed (out-of-band from the driver).
//
// FOLLOW-UP: this page shows no shipment context (route / shipper / cargo)
// beyond the delivery code. Rendering that safely on a public page needs a
// public-read decision (which booking fields a code-holder may see, and a
// public-read endpoint to serve them) — deferred, not added here.

import { useState, use } from 'react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'

type Phase = 'entry' | 'confirmed'

// BharatTruck wordmark for the public receiver page — the consignee has no
// app context, so brand it clearly so the email link looks trustworthy.
function BrandHeader() {
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      <span className="text-lg font-extrabold tracking-tight text-gray-900">
        Bharat<span className="text-emerald-600">Truck</span>
      </span>
    </div>
  )
}

export default function ReceiverPodPage({
  params,
}: {
  params: Promise<{ bookingId: string }>
}) {
  const { bookingId } = use(params)
  const [otp, setOtp] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('entry')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (otp.length !== 6) {
      setError('Enter the 6-digit code from your email')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/cargo/pod/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id: bookingId, otp }),
      })

      let json: { success?: boolean; error?: string; code?: string } | null = null
      try {
        json = await res.json()
      } catch {
        json = null
      }

      if (json?.success) {
        setPhase('confirmed')
        return
      }

      // The verify-otp envelope carries only `error` + `code` (no numeric
      // attempts-remaining counter). Surface the server message verbatim.
      setError(json?.error || 'Could not verify the code — please try again')
    } catch {
      setError('Network error — please check your connection and try again')
    } finally {
      setSubmitting(false)
    }
  }

  if (phase === 'confirmed') {
    return (
      <main className="min-h-dvh flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
          <BrandHeader />
          <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-emerald-800 mb-1">Delivery confirmed</h1>
          <p className="text-sm text-gray-500">
            Thank you. The delivery has been recorded — you can close this page.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-dvh flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
        <BrandHeader />
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-gray-900 mb-1">Confirm your delivery</h1>
          <p className="text-sm text-gray-500">
            Enter the delivery code from your email to confirm you received this shipment.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={otp}
            onChange={(e) => {
              setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))
              if (error) setError(null)
            }}
            placeholder="••••••"
            autoFocus
            className="w-full h-14 rounded-xl border border-gray-300 px-4 text-center text-2xl font-bold tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
          />

          {error && (
            <p className="text-sm text-red-600 text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting || otp.length !== 6}
            className="w-full h-12 rounded-xl bg-emerald-600 text-white font-semibold text-base disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
          >
            {submitting ? (
              <span className="h-5 w-5 rounded-full border-2 border-white border-t-transparent animate-spin" />
            ) : (
              'Confirm delivery'
            )}
          </button>
        </form>

        <p className="text-xs text-gray-400 text-center mt-4">
          Didn&apos;t get a code? Ask the driver to resend.
        </p>
      </div>
    </main>
  )
}
