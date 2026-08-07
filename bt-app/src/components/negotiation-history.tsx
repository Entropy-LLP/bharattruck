'use client'

/**
 * The price thread for one bid — every offer and counter, oldest first. Ported from
 * shipper/src/components/NegotiationHistory.tsx into bt-app's light style, reusing
 * this app's existing getBidHistory (GET /bookings/:id/quotes/:qid/history).
 *
 * The carrier side of a negotiation is a fleet owner as often as a driver now, so an
 * unknown role falls back to the neutral "Carrier" rather than naming the wrong party.
 */

import { useEffect, useRef, useState } from 'react'
import { ApiError, getBidHistory } from '@/lib/api'
import type { NegotiationEntry } from '@/lib/types'

const ACTOR_LABEL: Record<NegotiationEntry['actor_role'], string> = {
  shipper: 'You',
  driver: 'Driver',
  fleet_owner: 'Fleet operator',
}

export function NegotiationHistory({ bookingId, quoteId }: { bookingId: string; quoteId: string }) {
  const [entries, setEntries] = useState<NegotiationEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    getBidHistory(bookingId, quoteId)
      .then((e) => { if (!cancelled) setEntries(e) })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load the negotiation history.')
      })
    return () => { cancelled = true }
  }, [bookingId, quoteId])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [entries])

  if (error) return <p className="text-xs text-red-600 py-2">{error}</p>
  if (!entries) return <p className="text-xs text-gray-400 py-2">Loading negotiation history…</p>
  if (entries.length === 0) return <p className="text-xs text-gray-500 py-2">No negotiation history yet.</p>

  return (
    <div ref={scrollRef} className="max-h-64 overflow-y-auto space-y-3 py-2 px-1">
      {entries.map((entry) => {
        const isShipper = entry.actor_role === 'shipper'
        return (
          <div key={entry.id} className={`flex ${isShipper ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[75%] rounded-xl px-4 py-2.5 ${
                isShipper ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-gray-100 text-gray-900 rounded-bl-sm'
              }`}
            >
              <p className="text-xs font-medium opacity-75 mb-0.5">{ACTOR_LABEL[entry.actor_role] ?? 'Carrier'}</p>
              <p className="text-sm font-semibold tabular-nums">₹{entry.amount.toLocaleString('en-IN')}</p>
              {entry.message && <p className="text-sm mt-1 opacity-90">{entry.message}</p>}
              <p className={`text-[10px] mt-1 ${isShipper ? 'text-blue-200' : 'text-gray-500'}`}>
                {new Date(entry.created_at).toLocaleString('en-IN', {
                  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                })}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
