'use client'

/**
 * Shipper Settings — FB-04 GSTIN path.
 *
 * Backend: PATCH /auth/me/gstin (format matches users_gstin_format CHECK).
 * Posting a load hard-requires users.gstin (or fleet_owners.gstin). This page is
 * the shipper-app surface for entering it; mirrors the fleet console's GSTIN field
 * conventions without the rest of the fleet company profile.
 */

import { FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import Navbar from '@/components/Navbar'
import { ApiError, getMe, updateMyGstin } from '@/lib/api'

const GSTIN_LEN = 15
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{2}[0-9A-Z]$/

const INPUT =
  'w-full rounded-lg border border-border px-3 py-2 text-sm font-mono tracking-wide uppercase ' +
  'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'

function alnum(value: string, max: number): string {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, max)
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getMe()
      .then((res) => {
        if (cancelled) return
        const g = (res.user.gstin ?? '').toUpperCase()
        setValue(g)
        setSaved(g)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof ApiError ? e.message : 'Could not load your profile')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const dirty = value.trim().toUpperCase() !== saved.trim().toUpperCase()

  async function submit(e: FormEvent) {
    e.preventDefault()
    const draft = value.trim().toUpperCase()
    if (draft === '') {
      setError('Enter a 15-character GSTIN before posting a load.')
      return
    }
    if (!GSTIN_PATTERN.test(draft)) {
      setError('GSTIN must be 15 characters in the Indian format (e.g. 29ABCDE1234F1Z5).')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await updateMyGstin(draft)
      const next = (res.user.gstin ?? draft).toUpperCase()
      setSaved(next)
      setValue(next)
      toast.success('GSTIN saved')
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : 'Could not save GSTIN')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Navbar />
      <main className="max-w-xl mx-auto px-4 sm:px-6 py-6">
        <h1 className="text-xl font-bold text-foreground mb-2">Settings</h1>
        <p className="text-sm text-foreground/60 mb-6">
          Your GSTIN is required before you can post a load.
        </p>

        {loading ? (
          <p className="text-sm text-foreground/50">Loading…</p>
        ) : (
          <form onSubmit={submit} className="bg-card rounded-xl border border-border p-5 space-y-4">
            <div>
              <label htmlFor="gstin" className="block text-sm font-medium text-foreground/85 mb-1">
                GSTIN
              </label>
              <input
                id="gstin"
                type="text"
                autoComplete="off"
                value={value}
                onChange={(e) => setValue(alnum(e.target.value, GSTIN_LEN))}
                placeholder="29ABCDE1234F1Z5"
                className={INPUT}
              />
              <p className="mt-1 text-xs text-foreground/50">
                Exactly {GSTIN_LEN} characters. Same format as GST filings.
              </p>
            </div>

            {saved ? (
              <p className="text-xs text-emerald-600">
                On file: <span className="font-mono">{saved}</span>
              </p>
            ) : (
              <p className="text-xs text-amber-600">
                No GSTIN on file —{' '}
                <Link href="/bookings/new" className="underline">
                  New Booking
                </Link>{' '}
                will refuse until you save one.
              </p>
            )}

            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}

            <div className="flex items-center justify-between gap-3 pt-2">
              <p className="text-xs text-foreground/40">
                {dirty ? 'Unsaved changes' : 'Saved'}
              </p>
              <button
                type="submit"
                disabled={busy || !dirty}
                className="rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2"
              >
                {busy ? 'Saving…' : 'Save GSTIN'}
              </button>
            </div>
          </form>
        )}
      </main>
    </>
  )
}
