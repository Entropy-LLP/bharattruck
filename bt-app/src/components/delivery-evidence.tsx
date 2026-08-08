'use client'

/**
 * Delivery evidence & assertion — the POD evidence-capture slice (Phase 3b of
 * docs/UNIFIED_APP_PLAN.md; migration 0025, ARCHITECTURE_UNIFIED_IDENTITY.md §6.3).
 *
 * This is the hardened POD layer that sits ALONGSIDE the receiver-OTP flow on the trip
 * screen. The OTP is the CONFIRMED tier — the receiver reads out a code and the driver
 * enters it. This card is:
 *
 *  - CAMERA EVIDENCE the driver captures at the drop regardless of the OTP: a photo taken
 *    with the device camera, hashed ON THE DEVICE (SHA-256 over the file's own bytes),
 *    geo-stamped with the fix at capture, and POSTed as metadata only. The bytes are never
 *    re-encoded (§5.4) — hashing the raw File is deliberate; a canvas round-trip would
 *    destroy the integrity anchor. Idempotent, so a retry on a flaky connection is a no-op.
 *
 *  - ASSERT DELIVERY: the no-confirmation branch. When the receiver cannot confirm (no
 *    smartphone, night drop, warehouse hand-off), the driver picks a typed reason and
 *    reports the delivery; the trip moves in_transit → delivery_asserted and ops closes
 *    it. The server REQUIRES at least one photo first, so the action is GATED on evidence
 *    existing — the driver is never handed a 400 for an empty assertion.
 *
 *  - DISCREPANCY: a compact shortage/damage note. The driver reports only the actual
 *    quantity (expected is server-held, §5.7); a captured photo backs it.
 *
 * Nothing here can blank the trip screen: a non-secure context, a denied camera, a denied
 * or unavailable GPS fix, and every failed POST each resolve to a clear message, never a
 * crash or an empty card.
 */

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Camera, MapPin } from 'lucide-react'

import { Card, CardHead } from '@/components/stat'
import {
  ApiError, assertDelivery, capturePodEvidence, getPodRecord, submitDiscrepancy,
} from '@/lib/api'
import { dateTime } from '@/lib/format'
import type {
  AssertReason, Booking, CaptureResult, DiscrepancyReason, EvidenceCaptureInput,
  GeofenceResult, PodEvidenceView,
} from '@/lib/types'

// The six typed assert reasons (pod_state.assert_reason), most-common first.
const ASSERT_REASONS: { value: AssertReason; label: string }[] = [
  { value: 'no_receiver_present', label: 'No receiver present at the drop' },
  { value: 'no_smartphone', label: 'Receiver has no smartphone' },
  { value: 'receiver_refused_confirm', label: 'Receiver refused to confirm' },
  { value: 'warehouse_handoff', label: 'Warehouse hand-off (loader, no code)' },
  { value: 'night_delivery', label: 'Night delivery' },
  { value: 'other', label: 'Other reason' },
]

// The five typed discrepancy reasons (pod_discrepancies.reason, §5.7).
const DISCREPANCY_REASONS: { value: DiscrepancyReason; label: string }[] = [
  { value: 'shortage', label: 'Shortage (fewer than expected)' },
  { value: 'damage', label: 'Damage' },
  { value: 'wrong_goods', label: 'Wrong goods' },
  { value: 'partial_acceptance', label: 'Partial acceptance' },
  { value: 'refusal', label: 'Receiver refused the goods' },
]

// On-device SHA-256 over the photo's OWN bytes — the integrity anchor the server stores
// verbatim and never recomputes (§5.4). Requires a secure context (guarded by the caller).
async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// One-shot fix at capture time (fresher than a watch fix for geofencing the photo).
// Resolves null rather than throwing so a denied/unavailable GPS never blocks a capture.
function getFix(): Promise<{ lat: number; lng: number; accuracy?: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? undefined }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 },
    )
  })
}

function formatDistance(m: number | null): string | null {
  if (m == null || !Number.isFinite(m)) return null
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`
}

function geofenceBadge(result: GeofenceResult, distanceM: number | null): { label: string; cls: string } {
  const dist = formatDistance(distanceM)
  if (result === 'inside') return { label: dist ? `At the drop · ${dist}` : 'At the drop', cls: 'bg-emerald-100 text-emerald-800' }
  if (result === 'outside') return { label: dist ? `${dist} from drop` : 'Away from drop', cls: 'bg-amber-100 text-amber-800' }
  return { label: 'Location not captured', cls: 'bg-gray-100 text-gray-600' }
}

// One display row, mapped from either a fresh capture (has a local thumbnail) or a
// ledger read (no bytes to preview — storage is WORM/inert, so only metadata comes back).
type EvidenceItem = {
  evidence_id: string
  captured_at_server: string
  geofence_result: GeofenceResult
  geofence_distance_m: number | null
  previewUrl?: string
}

function fromCapture(r: CaptureResult, previewUrl?: string): EvidenceItem {
  return {
    evidence_id: r.evidence_id,
    captured_at_server: r.captured_at_server,
    geofence_result: r.geofence_result,
    geofence_distance_m: r.geofence_distance_m,
    previewUrl,
  }
}

function fromView(v: PodEvidenceView): EvidenceItem {
  return {
    evidence_id: v.evidence_id,
    captured_at_server: v.captured_at_server,
    geofence_result: v.geofence_result,
    geofence_distance_m: v.geofence_distance_m,
  }
}

export default function DeliveryEvidence({
  booking, currentPos, onChanged,
}: {
  booking: Booking
  currentPos: { lat: number; lng: number } | null
  onChanged: () => void
}) {
  const asserted = booking.status === 'delivery_asserted'

  const fileRef = useRef<HTMLInputElement | null>(null)
  const previewsRef = useRef<string[]>([])

  const [evidence, setEvidence] = useState<EvidenceItem[]>([])
  const [capturing, setCapturing] = useState(false)

  const [showAssert, setShowAssert] = useState(false)
  const [assertReason, setAssertReason] = useState<AssertReason>('no_receiver_present')
  const [asserting, setAsserting] = useState(false)

  const [showDiscrepancy, setShowDiscrepancy] = useState(false)
  const [discReason, setDiscReason] = useState<DiscrepancyReason>('shortage')
  const [actualQty, setActualQty] = useState('')
  const [discUnit, setDiscUnit] = useState('')
  const [discErr, setDiscErr] = useState<string | null>(null)
  const [submittingDisc, setSubmittingDisc] = useState(false)
  const [discrepancyDone, setDiscrepancyDone] = useState(false)

  // Merge server rows in, preserving any session thumbnail we already hold. Newest first.
  const mergeEvidence = useCallback((serverRows: PodEvidenceView[]) => {
    setEvidence((prev) => {
      const byId = new Map(prev.map((e) => [e.evidence_id, e]))
      for (const row of serverRows) {
        const existing = byId.get(row.evidence_id)
        byId.set(row.evidence_id, { ...fromView(row), previewUrl: existing?.previewUrl })
      }
      return [...byId.values()].sort((a, b) => b.captured_at_server.localeCompare(a.captured_at_server))
    })
  }, [])

  // Load any already-captured evidence so a reload shows prior photos and an existing
  // discrepancy. Best-effort — capture still works if the ledger read fails.
  useEffect(() => {
    let cancelled = false
    getPodRecord(booking.id)
      .then((rec) => {
        if (cancelled) return
        mergeEvidence(rec.evidence)
        if (rec.discrepancy) setDiscrepancyDone(true)
      })
      .catch(() => { /* silent — the ledger read is a convenience, not the capture path */ })
    return () => { cancelled = true }
  }, [booking.id, mergeEvidence])

  // Release object URLs when the section unmounts (trip closes or we navigate away).
  useEffect(() => () => { previewsRef.current.forEach((u) => URL.revokeObjectURL(u)) }, [])

  async function onFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // let the driver re-take the same file if they need to
    if (!file) return
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      toast.error('Photo capture needs a secure (HTTPS) connection.')
      return
    }
    setCapturing(true)
    try {
      const buf = await file.arrayBuffer()
      const sha = await sha256Hex(buf)

      // Prefer a fresh one-shot fix; fall back to the trip's live position if GPS is slow
      // or denied here. Neither available → capture without coords (geofence = 'unknown').
      let pos: { lat: number; lng: number; accuracy?: number } | null = await getFix()
      if (!pos && currentPos) pos = { lat: currentPos.lat, lng: currentPos.lng }

      const body: EvidenceCaptureInput = {
        sha256_original: sha,
        capture_method: 'camera',
        captured_at_device: new Date().toISOString(),
        gps_source: 'browser',
        content_type: file.type || undefined,
      }
      if (pos) {
        body.lat = pos.lat
        body.lng = pos.lng
        if (pos.accuracy != null) body.gps_accuracy_m = pos.accuracy
      }

      const res = await capturePodEvidence(booking.id, body)
      const previewUrl = URL.createObjectURL(file)
      previewsRef.current.push(previewUrl)
      setEvidence((prev) => [fromCapture(res, previewUrl), ...prev.filter((x) => x.evidence_id !== res.evidence_id)])
      toast.success(res.created ? 'Delivery photo captured' : 'That photo was already captured')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not capture the photo. Please try again.')
    } finally {
      setCapturing(false)
    }
  }

  async function handleAssert() {
    setAsserting(true)
    try {
      await assertDelivery(booking.id, assertReason)
      toast.success('Delivery reported — our team confirms and closes the trip')
      onChanged() // status flips to delivery_asserted; the parent re-renders this in asserted mode
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not report the delivery')
      setAsserting(false)
    }
  }

  async function handleDiscrepancy(e: FormEvent) {
    e.preventDefault()
    const qty = Number(actualQty)
    if (actualQty.trim() === '' || !Number.isFinite(qty) || qty < 0) {
      setDiscErr('Enter the actual quantity received (0 or more).')
      return
    }
    if (evidence.length === 0) {
      setDiscErr('Capture a delivery photo first — a discrepancy needs one on record.')
      return
    }
    setSubmittingDisc(true)
    setDiscErr(null)
    try {
      await submitDiscrepancy(booking.id, {
        actual_quantity: qty,
        reason: discReason,
        quantity_unit: discUnit.trim() || undefined,
        evidence_id: evidence[0].evidence_id, // the most recent capture backs the note
      })
      toast.success('Discrepancy recorded')
      setShowDiscrepancy(false)
      setDiscrepancyDone(true)
      setActualQty('')
    } catch (err) {
      setDiscErr(err instanceof ApiError ? err.message : 'Could not record the discrepancy')
    } finally {
      setSubmittingDisc(false)
    }
  }

  const hasEvidence = evidence.length > 0

  return (
    <Card>
      <CardHead title="Delivery evidence" sub="Camera photos, hashed and geo-stamped at the drop" />
      <div className="p-5 space-y-4">
        {asserted && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
            <p className="text-sm font-semibold text-amber-800">Delivery reported — awaiting confirmation</p>
            <p className="text-xs text-amber-700 mt-0.5">
              You reported this delivery without a receiver-confirmed code. Our team reviews the evidence and closes the trip.
            </p>
          </div>
        )}

        {/* Capture */}
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onFileSelected}
            className="hidden"
            aria-hidden="true"
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={capturing}
            className="w-full h-12 rounded-xl bg-gray-900 hover:bg-gray-800 text-white font-semibold text-base transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {capturing ? (
              <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving photo…</>
            ) : (
              <><Camera className="w-5 h-5" /> {hasEvidence ? 'Take another photo' : 'Take delivery photo'}</>
            )}
          </button>
          <p className="mt-2 text-xs text-gray-500">
            Photograph the delivered goods (and the signed LR). Each photo is hashed and time-stamped on your phone — it can&apos;t be altered afterwards.
          </p>
        </div>

        {/* Evidence list */}
        {hasEvidence && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Captured ({evidence.length})</p>
            <ul className="space-y-2">
              {evidence.map((ev) => {
                const badge = geofenceBadge(ev.geofence_result, ev.geofence_distance_m)
                return (
                  <li key={ev.evidence_id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 p-2">
                    <div className="w-12 h-12 rounded-lg bg-gray-200 overflow-hidden shrink-0 flex items-center justify-center">
                      {ev.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- a local blob preview; next/image can't optimize an object URL and there is no remote asset (bytes go to WORM storage separately)
                        <img src={ev.previewUrl} alt="Delivery photo" className="w-full h-full object-cover" />
                      ) : (
                        <Camera className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-xs">
                        <MapPin className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                        <span className={`px-1.5 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.label}</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">{dateTime(ev.captured_at_server)}</p>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {discrepancyDone && (
          <p className="text-xs text-amber-700">A shortage/damage note is on record for this delivery.</p>
        )}

        {/* Secondary actions */}
        {(!asserted || !discrepancyDone) && (
          <div className="pt-3 space-y-3 border-t border-gray-100">
            {/* Assert — only while the trip is still in transit. */}
            {!asserted && (
              !showAssert ? (
                <button onClick={() => setShowAssert(true)} className="text-sm font-medium text-blue-700 hover:text-blue-800">
                  Receiver can&apos;t confirm the code?
                </button>
              ) : (
                <div className="rounded-xl border border-gray-200 p-3 space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Report delivery without a code</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Use this only when the receiver can&apos;t confirm. Capture at least one photo first; our team reviews and closes the trip.
                    </p>
                  </div>
                  <label className="block">
                    <span className="text-xs text-gray-500">Reason</span>
                    <select
                      value={assertReason}
                      onChange={(e) => setAssertReason(e.target.value as AssertReason)}
                      className="mt-1 w-full h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {ASSERT_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </label>
                  {!hasEvidence && <p className="text-xs text-amber-700">Capture a delivery photo above before reporting.</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowAssert(false)}
                      disabled={asserting}
                      className="flex-1 h-11 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 font-medium text-sm disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleAssert}
                      disabled={asserting || !hasEvidence}
                      className="flex-1 h-11 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {asserting && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                      {asserting ? 'Reporting…' : 'Report delivery'}
                    </button>
                  </div>
                </div>
              )
            )}

            {/* Discrepancy — available in transit and after an assertion. */}
            {!discrepancyDone && (
              !showDiscrepancy ? (
                <button onClick={() => setShowDiscrepancy(true)} className="text-sm font-medium text-gray-600 hover:text-gray-900">
                  Report shortage or damage
                </button>
              ) : (
                <form onSubmit={handleDiscrepancy} className="rounded-xl border border-gray-200 p-3 space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Report a problem with this delivery</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Backed by your captured photo. Enter what you actually received — we hold the expected quantity.
                    </p>
                  </div>
                  <label className="block">
                    <span className="text-xs text-gray-500">Problem</span>
                    <select
                      value={discReason}
                      onChange={(e) => setDiscReason(e.target.value as DiscrepancyReason)}
                      className="mt-1 w-full h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {DISCREPANCY_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </label>
                  <div className="flex gap-2">
                    <label className="flex-1">
                      <span className="text-xs text-gray-500">Actual quantity received</span>
                      <input
                        inputMode="decimal"
                        value={actualQty}
                        onChange={(e) => { setActualQty(e.target.value.replace(/[^\d.]/g, '')); setDiscErr(null) }}
                        placeholder="0"
                        className="mt-1 w-full h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </label>
                    <label className="w-28">
                      <span className="text-xs text-gray-500">Unit</span>
                      <input
                        value={discUnit}
                        onChange={(e) => setDiscUnit(e.target.value)}
                        placeholder="boxes"
                        className="mt-1 w-full h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </label>
                  </div>
                  {!hasEvidence && <p className="text-xs text-amber-700">Capture a delivery photo above before reporting a problem.</p>}
                  {discErr && <p className="text-xs text-red-600">{discErr}</p>}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setShowDiscrepancy(false); setDiscErr(null) }}
                      disabled={submittingDisc}
                      className="flex-1 h-11 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 font-medium text-sm disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submittingDisc || !hasEvidence}
                      className="flex-1 h-11 rounded-xl bg-gray-900 hover:bg-gray-800 text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {submittingDisc && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                      {submittingDisc ? 'Recording…' : 'Record'}
                    </button>
                  </div>
                </form>
              )
            )}
          </div>
        )}
      </div>
    </Card>
  )
}
