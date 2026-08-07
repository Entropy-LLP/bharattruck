'use client'

/**
 * Counter-offer modal for the shipper. Ported from shipper/src/components/
 * CounterModal.tsx into bt-app's light style — a dependency-free overlay, closed on
 * backdrop click or Escape.
 */

import { useEffect, useState } from 'react'

export function CounterModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (amount: number, message?: string) => Promise<void>
  onClose: () => void
}) {
  const [amount, setAmount] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const num = parseFloat(amount)
    if (!num || num <= 0) { setError('Enter a valid counter amount.'); return }
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(num, message.trim() || undefined)
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not send the counter offer.')
      setSubmitting(false)
    }
  }

  const input = 'w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Counter offer</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="counter-amount" className="text-xs text-gray-400 uppercase tracking-wide">Amount (₹)</label>
            <input
              id="counter-amount"
              type="number"
              min="1"
              step="any"
              required
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Your counter amount"
              className={`mt-1.5 ${input} tabular-nums`}
            />
          </div>
          <div>
            <label htmlFor="counter-message" className="text-xs text-gray-400 uppercase tracking-wide">Message (optional)</label>
            <input
              id="counter-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="e.g. Can you do it for this price?"
              className={`mt-1.5 ${input}`}
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 text-sm border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Sending…' : 'Send counter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
