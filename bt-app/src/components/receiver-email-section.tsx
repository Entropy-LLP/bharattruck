'use client'

/**
 * The consignee inbox the receiver-OTP delivery code is emailed to, with an inline
 * editor. Ported from shipper/src/components/ReceiverEmailSection.tsx into bt-app's
 * light house style.
 *
 * WHY IT MATTERS: a booking with no receiver email is a trip that cannot be closed
 * by the receiver-OTP POD — the driver's proof-of-delivery request has nowhere to
 * send the code, so the trip sticks in in_transit and the payout it gates never
 * happens. This is where the shipper sets or corrects it. Deliberately LOUD when it
 * is missing on a live trip (accepted / in_transit); a quiet prompt otherwise.
 */

import { useState } from 'react'
import { toast } from 'sonner'
import { setReceiverEmail } from '@/lib/api'
import type { Booking } from '@/lib/types'

export function ReceiverEmailSection({ booking, onSaved }: { booking: Booking; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(booking.receiver_email ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // The server refuses the edit on a terminal booking, so do not offer it there.
  const editable = ['pending', 'negotiating', 'accepted', 'in_transit'].includes(booking.status)
  const missing = !booking.receiver_email
  const blocking = missing && (booking.status === 'accepted' || booking.status === 'in_transit')

  async function save() {
    const email = value.trim()
    if (!email) { setErr('Enter the receiver’s email address.'); return }
    setSaving(true)
    setErr(null)
    try {
      await setReceiverEmail(booking.id, email)
      toast.success('Receiver email saved — your driver can now send the delivery code')
      setEditing(false)
      onSaved()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Could not save the receiver email.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`mt-4 pt-4 border-t ${blocking ? '-mx-5 -mb-5 px-5 pb-5 bg-amber-50 border-amber-200' : 'border-gray-100'}`}>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Delivery code goes to</p>

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
            className="flex-1 h-10 px-3 rounded-xl border border-gray-200 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
          />
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="h-10 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => { setEditing(false); setValue(booking.receiver_email ?? ''); setErr(null) }}
              disabled={saving}
              className="h-10 px-4 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {booking.receiver_email ? (
              <p className="text-sm text-gray-800 break-all">{booking.receiver_email}</p>
            ) : (
              <p className={`text-sm ${blocking ? 'text-amber-800' : 'text-gray-500'}`}>
                {blocking
                  ? 'Not set — your driver cannot confirm delivery without it, and payment is not released until they do.'
                  : 'Not set. Add it before the trip reaches the drop.'}
              </p>
            )}
          </div>
          {editable && (
            <button
              onClick={() => setEditing(true)}
              className={`shrink-0 h-8 px-3 rounded-xl text-xs font-medium ${
                missing ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {missing ? 'Add email' : 'Edit'}
            </button>
          )}
        </div>
      )}

      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
    </div>
  )
}
