'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { getQuoteHistory } from '@/lib/api'
import type { NegotiationEntry } from '@/lib/types'
import Spinner from './Spinner'

export default function NegotiationHistory({
  bookingId,
  quoteId,
}: {
  bookingId: string
  quoteId: string
}) {
  const [entries, setEntries] = useState<NegotiationEntry[]>([])
  const [loading, setLoading] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getQuoteHistory(bookingId, quoteId)
      .then(setEntries)
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false))
  }, [bookingId, quoteId])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries])

  if (loading) {
    return (
      <div className="flex justify-center py-4">
        <Spinner />
      </div>
    )
  }

  if (entries.length === 0) {
    return <p className="text-sm text-gray-400 py-2">No negotiation history yet.</p>
  }

  return (
    <div ref={scrollRef} className="max-h-64 overflow-y-auto space-y-3 py-2 px-1">
      {entries.map((entry) => {
        const isShipper = entry.actor_role === 'shipper'
        return (
          <div
            key={entry.id}
            className={`flex ${isShipper ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[75%] rounded-xl px-4 py-2.5 ${
                isShipper
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : 'bg-gray-100 text-gray-900 rounded-bl-sm'
              }`}
            >
              <p className="text-xs font-medium opacity-75 mb-0.5">
                {isShipper ? 'You' : 'Driver'}
              </p>
              <p className="text-sm font-semibold">
                {'\u20B9'}{entry.amount.toLocaleString('en-IN')}
              </p>
              {entry.message && (
                <p className="text-sm mt-1 opacity-90">{entry.message}</p>
              )}
              <p
                className={`text-[10px] mt-1 ${
                  isShipper ? 'text-blue-200' : 'text-gray-400'
                }`}
              >
                {new Date(entry.created_at).toLocaleString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
