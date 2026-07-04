'use client'

import { useState } from 'react'
import Spinner from './Spinner'

export default function CounterModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (amount: number, message?: string) => Promise<void>
  onClose: () => void
}) {
  const [amount, setAmount] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const num = parseFloat(amount)
    if (!num || num <= 0) return

    setSubmitting(true)
    try {
      await onSubmit(num, message || undefined)
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Counter Offer</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="counter-amount" className="block text-sm font-medium text-gray-700 mb-1">
              Amount ({'\u20B9'})
            </label>
            <input
              id="counter-amount"
              type="number"
              min="1"
              step="any"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter your counter amount"
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="counter-message" className="block text-sm font-medium text-gray-700 mb-1">
              Message (optional)
            </label>
            <input
              id="counter-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. Can you do it for this price?"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting && <Spinner className="h-4 w-4 border-white border-t-transparent" />}
              Send Counter
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
