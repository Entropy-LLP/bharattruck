'use client'

/**
 * Payment settlement (ship surface) — the CLOSING step of the trip lifecycle.
 *
 * A COMPLETED trip is settled cash / UPI / direct and the booking flips
 * completed → paid (bt-payment-service POST /payments/settle). Escrow/Razorpay are
 * OUT of MVP — this records the real-world settlement, the "cash-recorded first" path.
 * This is the last thread of the North Star: one booking driven post → delivered →
 * PAID, entirely through the UI.
 *
 * Shown only to the SHIPPER (the payer, per the settle authorization) and only once
 * the trip is `completed` or `paid` — it renders nothing otherwise, so the surface
 * stays clean. The amount is LOCKED to the agreed price (final_price ?? quoted_price):
 * the server refuses a shipper self-discount, so the UI never offers one — it confirms
 * the figure and the shipper records how it was paid.
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Card, CardHead, ErrorNote, Loading } from '@/components/stat'
import { ApiError, getPaymentStatus, recordPayment } from '@/lib/api'
import { inr } from '@/lib/format'
import type { Booking, PaymentMode, PaymentStatus } from '@/lib/types'

const MODES: { value: PaymentMode; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'direct', label: 'Bank transfer' },
]

const modeLabel = (m: PaymentMode | null) => MODES.find((x) => x.value === m)?.label ?? m ?? '—'

/** What this trip is contractually worth — the same precedence the server settles on. */
const agreedPrice = (b: Booking) => b.final_price ?? b.quoted_price

export default function PaymentSection({ booking, onChanged }: { booking: Booking; onChanged?: () => void }) {
  const isShipper = booking.viewer?.relations?.includes('shipper') ?? false
  const relevant = booking.status === 'completed' || booking.status === 'paid'

  const [status, setStatus] = useState<PaymentStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<PaymentMode>('cash')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    getPaymentStatus(booking.id)
      .then(setStatus)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Could not load the payment status.'))
      .finally(() => setLoading(false))
  }, [booking.id])

  // Fetch only for the shipper on a delivered trip. booking.status is a dep so the
  // receipt re-pulls when the trip flips completed → paid after a settle elsewhere.
  useEffect(() => {
    if (isShipper && relevant) load()
    else setLoading(false)
  }, [isShipper, relevant, booking.status, load])

  // Not the payer, or nothing to settle yet → render nothing (keeps the surface clean).
  if (!isShipper || !relevant) return null

  const amount = agreedPrice(booking)

  async function submit() {
    setBusy(true)
    try {
      // The settle response already carries the payment + payout, so show the receipt
      // immediately; onChanged reloads the booking so the rest of the page sees `paid`.
      const res = await recordPayment(booking.id, amount, mode, reference.trim() || undefined)
      setStatus(res)
      toast.success('Payment recorded — trip marked paid')
      onChanged?.()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not record the payment.')
      setBusy(false)
    }
  }

  const paid = booking.status === 'paid'
  const payment = status?.payment
  const payout = status?.payout

  return (
    <Card className="mb-5">
      <CardHead title="Payment" sub={paid ? 'Settled' : 'Record the settlement to close this trip'} />
      <div className="p-4">
        {loading && <Loading label="Loading payment" />}
        {error && !loading && <ErrorNote message={error} />}

        {/* Paid — the receipt. */}
        {!loading && !error && paid && payment && (
          <div className="space-y-2.5">
            <Row label="Amount" value={inr(payment.amount)} strong />
            <Row label="Paid by" value={modeLabel(payment.mode)} />
            {payment.reference && <Row label="Reference" value={payment.reference} truncate />}
            {payout && (
              <div className="border-t border-gray-100 pt-2.5">
                <Row
                  label={`Payout to ${payout.payee_type === 'fleet_owner' ? 'fleet' : 'driver'}`}
                  value={inr(payout.amount)}
                  emerald
                />
              </div>
            )}
          </div>
        )}
        {!loading && !error && paid && !payment && (
          <p className="text-sm text-gray-500">This trip is marked paid.</p>
        )}

        {/* Completed — record the settlement. */}
        {!loading && !error && booking.status === 'completed' && (
          <div className="space-y-4">
            <Row label="Amount due" value={inr(amount)} strong />

            <div>
              <label className="block text-xs text-gray-400 uppercase tracking-wide mb-1.5">Paid by</label>
              <div className="grid grid-cols-3 gap-2">
                {MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setMode(m.value)}
                    className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                      mode === m.value
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="pay-ref" className="block text-xs text-gray-400 uppercase tracking-wide mb-1.5">
                Reference <span className="text-gray-300 normal-case">(optional)</span>
              </label>
              <input
                id="pay-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                maxLength={200}
                placeholder="UTR / txn id / note"
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <button
              onClick={submit}
              disabled={busy || amount <= 0}
              className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold py-2.5 active:scale-[0.98] transition-transform"
            >
              {busy ? 'Recording…' : `Record ${inr(amount)} paid`}
            </button>
          </div>
        )}
      </div>
    </Card>
  )
}

function Row({
  label, value, strong, emerald, truncate,
}: { label: string; value: string; strong?: boolean; emerald?: boolean; truncate?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-gray-500 shrink-0">{label}</span>
      <span
        className={`text-sm tabular-nums ${truncate ? 'truncate' : ''} ${
          emerald ? 'font-semibold text-emerald-700' : strong ? 'font-bold text-gray-900' : 'font-medium text-gray-900'
        }`}
      >
        {value}
      </span>
    </div>
  )
}
