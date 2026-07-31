'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { setReceiverEmail } from '@/lib/api'
import type { Booking } from '@/lib/types'

/**
 * The consignee inbox the delivery code is emailed to, with an inline editor.
 *
 * This exists because a booking with no receiver email is a trip that CANNOT be
 * completed: the driver's proof-of-delivery request has no address to send the
 * one-time code to, so the trip sticks in `in_transit` and the payout it gates
 * never happens. The driver app already tells the driver "the shipper must add
 * one" — this is where the shipper actually does it.
 *
 * Deliberately loud when it is missing on a live trip (accepted / in_transit):
 * at that point a truck is already moving toward a delivery that cannot be
 * confirmed, and the shipper is the only person who can unblock it. On a pending
 * booking the same gap is not yet urgent, so it stays a quiet prompt.
 */
export default function ReceiverEmailSection({
  booking,
  onSaved,
}: {
  booking: Booking
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(booking.receiver_email ?? '')
  const [saving, setSaving] = useState(false)

  // The server refuses the edit on a terminal booking (the delivery is already
  // proven, or there is nothing left to deliver), so do not offer it.
  const editable = (['pending', 'negotiating', 'accepted', 'in_transit'] as const).includes(
    booking.status as 'pending' | 'negotiating' | 'accepted' | 'in_transit'
  )
  const missing = !booking.receiver_email
  const blocking = missing && (booking.status === 'accepted' || booking.status === 'in_transit')

  async function save() {
    const email = value.trim()
    if (!email) {
      toast.error('Enter the receiver’s email address')
      return
    }
    setSaving(true)
    try {
      await setReceiverEmail(booking.id, email)
      toast.success('Receiver email saved — your driver can now send the delivery code')
      setEditing(false)
      onSaved()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not save the receiver email')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className={`mt-4 pt-4 border-t ${
        blocking
          ? '-mx-5 -mb-4 px-5 pb-4 bg-amber-500/10 border-amber-500/40'
          : 'border-border/60'
      }`}
    >
      <p className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wide mb-1">
        Delivery code goes to
      </p>

      {editing ? (
        <div className="flex flex-col sm:flex-row gap-2 mt-2">
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save() }}
            placeholder="consignee@example.com"
            disabled={saving}
            aria-label="Receiver email address"
            className="flex-1 h-10 px-3 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
          />
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => { setEditing(false); setValue(booking.receiver_email ?? '') }}
              disabled={saving}
              className="h-10 px-4 rounded-lg border border-border text-sm text-muted-foreground disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {booking.receiver_email ? (
              <p className="text-sm text-foreground/85 break-all">{booking.receiver_email}</p>
            ) : (
              <p className={`text-sm ${blocking ? 'text-amber-200' : 'text-muted-foreground'}`}>
                {blocking
                  ? 'Not set — your driver cannot confirm delivery without it, and payment is not released until they do.'
                  : 'Not set. Add it before the trip reaches the drop.'}
              </p>
            )}
          </div>
          {editable && (
            <button
              onClick={() => setEditing(true)}
              className={`shrink-0 h-8 px-3 rounded-lg text-xs font-medium ${
                missing
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border text-muted-foreground'
              }`}
            >
              {missing ? 'Add email' : 'Edit'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
