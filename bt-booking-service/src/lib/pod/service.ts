// ============================================================
// src/lib/pod/service.ts
//
// Responsibility: the POD hardening business logic that sits on top of the existing
// receiver-OTP flow — evidence capture, the geofence-gated OTP decision, structured
// discrepancy capture, and the delivery_asserted assertion. Authorization and the
// booking/driver identity resolution reuse the base repository (the same drivers.id-
// not-users.id contract getPodContext uses); the POD tables go through pod/repository.
//
// FOUNDER RULE, load-bearing here: "idempotency at each state, no first this then this
// unless that's how it works." So capture and discrepancy are idempotent on resubmit
// (the DB unique keys converge a retry onto the same row), and NO artificial ordering
// is imposed — the ONE real-world sequence enforced is that a delivery cannot be
// asserted before anything was photographed, because an assertion with no evidence is
// the exact hole this whole slice exists to close.
// ============================================================

import { z } from 'zod'
import type { AuthenticatedUser, BookingStatus, BookingWithProfiles } from '../types.js'
import { BookingError } from '../types.js'
import { assertValidTransition } from '../state.js'
import * as repo from '../repository.js'
import * as podRepo from './repository.js'
import { defaultEvidenceStorage, type EvidenceStorage } from './storage.js'
import { DROP_RADIUS_M, NEAR_DROP_M, geofenceVerdict, haversineMeters } from './geo.js'

type Logger = { warn(obj: unknown, msg: string): void }

// The claim clocks (§5.7). 180-day pre-suit notice runs from BOOKING; 7-day insurance
// intimation from DELIVERY. Named constants so the legal source is obvious at the math.
const CLAIM_NOTICE_DAYS = 180 // Carriage by Road Act s.16 — from date of booking
const INSURANCE_INTIMATION_DAYS = 7 // policy terms — from date of delivery
const DAY_MS = 24 * 60 * 60 * 1000

// -----------------------------------------------------------
// Request schemas. Camera-only is enforced HERE as well as at the DB CHECK — a
// gallery import must be refused before it ever reaches storage, with a message the
// driver app can show, not a raw constraint violation.
// -----------------------------------------------------------

const HEX64 = /^[0-9a-f]{64}$/

export const EvidenceCaptureSchema = z.object({
  // The on-device SHA-256, lowercase hex. Stored verbatim — the app's hash IS the
  // integrity anchor, never recomputed server-side (§5.4 rule 2).
  sha256_original: z.string().regex(HEX64, 'sha256_original must be 64 lowercase hex chars'),
  // 🔴 Camera-only. The enum has exactly one member so a gallery import cannot be
  // encoded at all; the field exists so the control is explicit and auditable.
  capture_method: z.literal('camera'),
  // Device clock as a CLAIM. Optional — a photo with no device time still captures,
  // it just carries no skew signal.
  captured_at_device: z.string().datetime().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  gps_accuracy_m: z.number().nonnegative().optional(),
  gps_source: z.string().optional(),
  mock_location_detected: z.boolean().optional(),
  device_id: z.string().optional(),
  os_version: z.string().optional(),
  app_version: z.string().optional(),
  lr_number: z.string().optional(),
  exif_raw: z.record(z.unknown()).optional(),
  content_type: z.string().optional(),
}).strict() // reject unknown keys — nothing about a capture is a free-for-all

export type EvidenceCaptureBody = z.infer<typeof EvidenceCaptureSchema>

export const DiscrepancySchema = z.object({
  // The driver reports ONLY the actual. There is deliberately no expected_quantity
  // here; .strict() below turns any attempt to send one into a 400. That is the anti-
  // pilferage control — the expected side is server-held (§5.7).
  actual_quantity: z.number().nonnegative(),
  reason: z.enum(['shortage', 'damage', 'wrong_goods', 'refusal', 'partial_acceptance']),
  quantity_unit: z.string().optional(),
  // The geofenced+timestamped photo. A pod_evidence id captured earlier on this trip.
  evidence_id: z.string().uuid().optional(),
}).strict()

export type DiscrepancyBody = z.infer<typeof DiscrepancySchema>

export const AssertDeliverySchema = z.object({
  assert_reason: z.enum([
    'no_smartphone', 'night_delivery', 'warehouse_handoff',
    'receiver_refused_confirm', 'no_receiver_present', 'other',
  ]),
}).strict()

export type AssertDeliveryBody = z.infer<typeof AssertDeliverySchema>

// -----------------------------------------------------------
// resolveAssignedDriver — the shared precondition for every driver-side POD action:
// the caller is a driver, the booking exists, and it is THIS driver's booking. Mirrors
// getPodContext exactly (assigned-driver-only, 404 to hide ids from non-owners), so the
// evidence/discrepancy/assert endpoints authorize identically to the OTP request.
// -----------------------------------------------------------

async function resolveAssignedDriver(
  bookingId: string,
  actor: AuthenticatedUser,
): Promise<{ booking: BookingWithProfiles; driverId: string }> {
  if (actor.role !== 'driver') {
    throw new BookingError('Only the assigned driver can perform this POD action', 'FORBIDDEN', 403)
  }
  const booking = await repo.getBookingById(bookingId)
  if (!booking) {
    throw new BookingError(`Booking ${bookingId} not found`, 'NOT_FOUND', 404)
  }
  const driverRow = await repo.getDriverByUserId(actor.userId)
  if (!driverRow) {
    throw new BookingError('Driver profile not found', 'NOT_FOUND', 404)
  }
  if (booking.driver_id !== driverRow.id) {
    throw new BookingError('You are not assigned to this booking', 'FORBIDDEN', 403)
  }
  return { booking, driverId: driverRow.id }
}

// -----------------------------------------------------------
// evaluateOtpGate — the geofence gate the OTP issuance hangs on (§5.5, D-14).
//
// It answers PASS / BLOCK / DEGRADE, never silently allowing a code to issue 40 km
// out and never hard-blocking a legitimate delivery where tracking simply was not
// running:
//   * live fix within the drop radius            → PASS
//   * live fix in the corroboration band AND a
//     'drop' geofence-enter already recorded      → PASS (dock-scale GPS drift)
//   * live fix beyond that                        → BLOCK (this is the 40 km hole)
//   * no live fix but a 'drop' enter on record    → PASS (arrived; no live fix to lean on)
//   * no signal at all                            → DEGRADE (allow, flagged weaker)
//
// Any read failure resolves toward DEGRADE, not an exception: the gate is an added
// control and must never convert a POD request that worked into a 500.
// -----------------------------------------------------------

export type OtpGateDecision = 'pass' | 'block' | 'degrade'

export type OtpGateResult = {
  decision: OtpGateDecision
  verdict: 'inside' | 'outside' | 'unknown'
  distance_m: number | null
  source: 'telemetry' | 'geofence_event' | 'none'
}

export async function evaluateOtpGate(
  booking: BookingWithProfiles,
  log?: Logger,
): Promise<OtpGateResult> {
  try {
    const telem = await podRepo.getTelemetryLastFix(booking.id)
    const haveDest = Number.isFinite(booking.dest_lat) && Number.isFinite(booking.dest_lng)

    if (telem && haveDest) {
      const d = haversineMeters(telem.lat, telem.lng, booking.dest_lat, booking.dest_lng)
      if (d <= DROP_RADIUS_M) {
        return { decision: 'pass', verdict: 'inside', distance_m: d, source: 'telemetry' }
      }
      if (d <= NEAR_DROP_M && (await podRepo.hasDropEnterEvent(booking.id))) {
        return { decision: 'pass', verdict: 'inside', distance_m: d, source: 'telemetry' }
      }
      // A live fix clearly away from the drop. Do not let a stale enter event override
      // it — issuing the code while the truck is demonstrably elsewhere is the fraud.
      return { decision: 'block', verdict: 'outside', distance_m: d, source: 'telemetry' }
    }

    if (await podRepo.hasDropEnterEvent(booking.id)) {
      return { decision: 'pass', verdict: 'inside', distance_m: null, source: 'geofence_event' }
    }

    return { decision: 'degrade', verdict: 'unknown', distance_m: null, source: 'none' }
  } catch (err) {
    // No signal we can trust → degrade, never fail the caller's POD request.
    log?.warn({ err, booking_id: booking.id }, 'OTP geofence gate read failed — degrading')
    return { decision: 'degrade', verdict: 'unknown', distance_m: null, source: 'none' }
  }
}

// -----------------------------------------------------------
// captureEvidence — a camera capture at the drop. Records metadata, hands the bytes to
// the (currently inert) WORM store, and audits. Idempotent on (booking, hash).
// -----------------------------------------------------------

const EVIDENCE_CAPTURABLE: BookingStatus[] = ['in_transit', 'delivery_asserted']

export type CaptureResult = {
  evidence_id: string
  booking_id: string
  sha256_original: string
  captured_at_server: string
  clock_skew_seconds: number | null
  geofence_result: string
  geofence_distance_m: number | null
  mock_location_detected: boolean
  storage_status: string
  created: boolean
}

export async function captureEvidence(
  bookingId: string,
  actor: AuthenticatedUser,
  body: EvidenceCaptureBody,
  log?: Logger,
  storage: EvidenceStorage = defaultEvidenceStorage(),
): Promise<CaptureResult> {
  const { booking, driverId } = await resolveAssignedDriver(bookingId, actor)

  if (!EVIDENCE_CAPTURABLE.includes(booking.status)) {
    throw new BookingError(
      `POD evidence can only be captured while the trip is in_transit (booking is '${booking.status}')`,
      'INVALID_TRANSITION',
      409,
    )
  }

  // Server time is authoritative; the device time is a claim; the gap is the signal.
  const serverNow = new Date()
  let skew: number | null = null
  if (body.captured_at_device) {
    const deviceMs = new Date(body.captured_at_device).getTime()
    if (Number.isFinite(deviceMs)) {
      // Signed: device ahead of the server is positive (matches the column comment).
      skew = Math.round((deviceMs - serverNow.getTime()) / 1000)
    }
  }

  // Geofence the capture against the Rule 46(o) delivery address.
  let distanceM: number | null = null
  if (
    body.lat !== undefined && body.lng !== undefined &&
    Number.isFinite(booking.dest_lat) && Number.isFinite(booking.dest_lng)
  ) {
    distanceM = haversineMeters(body.lat, body.lng, booking.dest_lat, booking.dest_lng)
  }
  const verdict = geofenceVerdict(distanceM)

  const { row, created } = await podRepo.insertEvidence({
    booking_id: bookingId,
    driver_id: driverId,
    sha256_original: body.sha256_original,
    capture_method: body.capture_method,
    captured_at_device: body.captured_at_device ?? null,
    clock_skew_seconds: skew,
    lat: body.lat ?? null,
    lng: body.lng ?? null,
    gps_accuracy_m: body.gps_accuracy_m ?? null,
    gps_source: body.gps_source ?? null,
    mock_location_detected: body.mock_location_detected ?? false,
    geofence_distance_m: distanceM,
    geofence_result: verdict,
    device_id: body.device_id ?? null,
    os_version: body.os_version ?? null,
    app_version: body.app_version ?? null,
    lr_number: body.lr_number ?? null,
    exif_raw: body.exif_raw ?? null,
  })

  // Only the FIRST insert reserves storage / audits a capture — a resubmit already did.
  if (created) {
    const stored = await storage.reserve(
      { bookingId, evidenceId: row.id, sha256Original: row.sha256_original, contentType: body.content_type ?? null },
      log,
    )
    await podRepo.updateEvidenceStorage(row.id, stored.status, stored.originalBytesUri)
    row.storage_status = stored.status
    await podRepo.appendAudit(
      {
        booking_id: bookingId,
        evidence_id: row.id,
        action: 'evidence_captured',
        actor_user_id: actor.userId,
        actor_role: actor.role,
        detail: {
          geofence_result: verdict,
          clock_skew_seconds: skew,
          mock_location_detected: body.mock_location_detected ?? false,
          storage_status: stored.status,
        },
      },
      log,
    )
  }

  return {
    evidence_id: row.id,
    booking_id: bookingId,
    sha256_original: row.sha256_original,
    captured_at_server: row.captured_at_server,
    clock_skew_seconds: skew,
    geofence_result: verdict,
    geofence_distance_m: distanceM,
    mock_location_detected: body.mock_location_detected ?? false,
    storage_status: row.storage_status,
    created,
  }
}

// -----------------------------------------------------------
// Claim clocks (§5.7). Pure — computes the two deadlines from the two anchor dates so
// the same maths is testable in isolation and shown identically in every response.
// -----------------------------------------------------------

export type ClaimClocks = {
  booking_date: string | null
  delivery_date: string | null
  claim_notice_deadline: string | null // 180 days from booking (pre-suit notice)
  insurance_intimation_deadline: string | null // 7 days from delivery
  claim_notice_days: number
  insurance_intimation_days: number
}

export function computeClaimClocks(bookingDateIso: string | null, deliveryDateIso: string | null): ClaimClocks {
  const plusDays = (iso: string | null, days: number): string | null => {
    if (!iso) return null
    const t = new Date(iso).getTime()
    if (!Number.isFinite(t)) return null
    return new Date(t + days * DAY_MS).toISOString()
  }
  return {
    booking_date: bookingDateIso,
    delivery_date: deliveryDateIso,
    claim_notice_deadline: plusDays(bookingDateIso, CLAIM_NOTICE_DAYS),
    insurance_intimation_deadline: plusDays(deliveryDateIso, INSURANCE_INTIMATION_DAYS),
    claim_notice_days: CLAIM_NOTICE_DAYS,
    insurance_intimation_days: INSURANCE_INTIMATION_DAYS,
  }
}

// -----------------------------------------------------------
// submitDiscrepancy — structured shortage/damage capture (§5.7). Idempotent on booking.
// -----------------------------------------------------------

const DISCREPANCY_LOGGABLE: BookingStatus[] = ['in_transit', 'delivery_asserted']

export type DiscrepancyResult = {
  discrepancy_id: string
  booking_id: string
  expected_quantity: number | null
  actual_quantity: number
  delta: number | null
  reason: string
  evidence_id: string | null
  driver_ack_at: string
  consignee_ack_at: string | null
  claim_clocks: ClaimClocks
  created: boolean
}

export async function submitDiscrepancy(
  bookingId: string,
  actor: AuthenticatedUser,
  body: DiscrepancyBody,
  log?: Logger,
): Promise<DiscrepancyResult> {
  const { booking, driverId } = await resolveAssignedDriver(bookingId, actor)

  if (!DISCREPANCY_LOGGABLE.includes(booking.status)) {
    throw new BookingError(
      `A discrepancy can only be logged while the trip is in_transit (booking is '${booking.status}')`,
      'INVALID_TRANSITION',
      409,
    )
  }

  // 🔴 EXPECTED IS SERVER-HELD. Read it off the booking, never off the wire (the schema
  // already refuses a client-sent expected_quantity). A NULL here means no server-held
  // count was ever set — the delta is then uncomputable and the record says so, which
  // is honest rather than inventing a baseline the driver could have shaped.
  const expected = booking.pod_expected_quantity ?? null
  const delta = expected === null ? null : body.actual_quantity - expected

  // Mandatory geofenced photo when the counts differ — and for damage regardless of
  // count, because damaged-but-complete cargo is a discrepancy a number cannot show.
  // delta === null (no server-held expected) is treated as "not reconciled" and also
  // requires the photo: a discrepancy claim with no image is the weak POD §5.5 warns of.
  const photoRequired = delta === null || delta !== 0 || body.reason === 'damage'
  let evidenceId: string | null = null
  if (photoRequired) {
    if (!body.evidence_id) {
      throw new BookingError(
        'A geofenced delivery photo is required for this discrepancy — capture evidence first',
        'VALIDATION_ERROR',
        400,
      )
    }
    const ev = await podRepo.getEvidenceById(body.evidence_id)
    if (!ev || ev.booking_id !== bookingId) {
      throw new BookingError('evidence_id does not reference a photo captured on this booking', 'VALIDATION_ERROR', 400)
    }
    evidenceId = ev.id
  }

  // Delivery is happening now (the driver is at the drop logging the note); the
  // insurance clock starts here. The booking date is the s.16 anchor.
  const nowIso = new Date().toISOString()
  const bookingDate = booking.created_at ? new Date(booking.created_at).toISOString() : null

  const { row, created } = await podRepo.insertDiscrepancy({
    booking_id: bookingId,
    expected_quantity: expected,
    actual_quantity: body.actual_quantity,
    delta,
    quantity_unit: body.quantity_unit ?? booking.pod_quantity_unit ?? null,
    reason: body.reason,
    evidence_id: evidenceId,
    driver_id: driverId,
    booking_date: bookingDate,
    delivery_date: nowIso,
  })

  if (created) {
    await podRepo.appendAudit(
      {
        booking_id: bookingId,
        evidence_id: evidenceId,
        action: 'discrepancy_logged',
        actor_user_id: actor.userId,
        actor_role: actor.role,
        detail: { reason: body.reason, expected_quantity: expected, actual_quantity: body.actual_quantity, delta },
      },
      log,
    )
  }

  return {
    discrepancy_id: row.id,
    booking_id: bookingId,
    expected_quantity: row.expected_quantity,
    actual_quantity: row.actual_quantity,
    delta: row.delta,
    reason: row.reason,
    evidence_id: row.evidence_id,
    driver_ack_at: row.driver_ack_at,
    consignee_ack_at: row.consignee_ack_at,
    claim_clocks: computeClaimClocks(row.booking_date, row.delivery_date),
    created,
  }
}

// -----------------------------------------------------------
// assertDelivery — the no-confirmation branch. Driver captured evidence, the receiver
// cannot confirm, so the trip moves in_transit → delivery_asserted (NOT completed) and
// pod_state records pod_strength='asserted'. Ops closes it later. Idempotent: asserting
// an already-asserted trip returns the existing state.
//
// THE ONE REAL SEQUENCE ENFORCED: at least one photo must already exist. Everything
// else is idempotent and orderless per the founder rule — but a delivery asserted with
// nothing captured is precisely the unprovable claim this slice exists to prevent.
// -----------------------------------------------------------

export type AssertResult = {
  booking_id: string
  status: BookingStatus
  pod_strength: 'asserted'
  assert_reason: string
  asserted_at: string | null
  created: boolean
}

export async function assertDelivery(
  bookingId: string,
  actor: AuthenticatedUser,
  body: AssertDeliveryBody,
  log?: Logger,
): Promise<AssertResult> {
  const { booking, driverId } = await resolveAssignedDriver(bookingId, actor)

  // Idempotent no-op: already asserted → return the existing record unchanged.
  if (booking.status === 'delivery_asserted') {
    const state = await podRepo.getPodState(bookingId)
    return {
      booking_id: bookingId,
      status: booking.status,
      pod_strength: 'asserted',
      assert_reason: state?.assert_reason ?? body.assert_reason,
      asserted_at: state?.asserted_at ?? null,
      created: false,
    }
  }

  // Inert without 0025: the delivery_asserted enum value and pod_state do not exist
  // there, so refuse cleanly with a 503 up front rather than letting the transition
  // fail deep in the repository as an opaque 500. (transitionBookingStatus wraps DB
  // errors as a bare Error, so the enum-missing code cannot be recovered downstream.)
  if (!(await podRepo.podFeatureAvailable(log))) {
    throw new BookingError(
      'Delivery assertion is not enabled on this environment yet — migration 0025 has not been applied',
      'UPSTREAM_ERROR',
      503,
    )
  }

  // Evidence-before-assertion is the real-world precondition.
  if (!(await podRepo.hasEvidence(bookingId))) {
    throw new BookingError(
      'Capture at least one delivery photo before asserting delivery — an assertion with no evidence cannot stand',
      'VALIDATION_ERROR',
      400,
    )
  }

  // Server-side state-machine guard (in_transit → delivery_asserted).
  assertValidTransition(booking.status, 'delivery_asserted')

  const updated = await repo.transitionBookingStatus(bookingId, driverId, booking.status, 'delivery_asserted')
  if (!updated) {
    throw new BookingError(
      "Booking could not be asserted — its status changed concurrently",
      'INVALID_TRANSITION',
      409,
    )
  }

  await podRepo.setAsserted(bookingId, driverId, body.assert_reason)
  await podRepo.appendAudit(
    {
      booking_id: bookingId,
      action: 'delivery_asserted',
      actor_user_id: actor.userId,
      actor_role: actor.role,
      detail: { assert_reason: body.assert_reason },
    },
    log,
  )

  return {
    booking_id: bookingId,
    status: 'delivery_asserted',
    pod_strength: 'asserted',
    assert_reason: body.assert_reason,
    asserted_at: new Date().toISOString(),
    created: true,
  }
}

// -----------------------------------------------------------
// setExpectedQuantity — the shipper/ops write path for the server-held expected count.
// Mirrors setReceiverEmail exactly: the OWNING shipper or ops, non-terminal bookings
// only, and DELIBERATELY NOT the driver — the driver reporting both the expected AND
// the actual is the pilferage hole (§5.7). Kept here so the "server-held" claim is
// backed by a real, driver-inaccessible write path.
// -----------------------------------------------------------

const EXPECTED_QTY_EDITABLE: BookingStatus[] = ['pending', 'negotiating', 'accepted', 'in_transit']

export async function setExpectedQuantity(
  bookingId: string,
  quantity: number,
  unit: string | null,
  actor: AuthenticatedUser,
): Promise<BookingWithProfiles> {
  const booking = await repo.getBookingById(bookingId)
  if (!booking) {
    throw new BookingError(`Booking ${bookingId} not found`, 'NOT_FOUND', 404)
  }

  if (actor.role === 'shipper') {
    if (booking.shipper_id !== actor.userId) {
      throw new BookingError('Forbidden', 'FORBIDDEN', 403)
    }
  } else if (actor.role !== 'admin') {
    throw new BookingError(
      'Only the shipper who owns this booking (or ops) can set the expected quantity — never the driver',
      'FORBIDDEN',
      403,
    )
  }

  if (!EXPECTED_QTY_EDITABLE.includes(booking.status)) {
    throw new BookingError(
      `The expected quantity cannot be changed on a '${booking.status}' booking`,
      'INVALID_TRANSITION',
      409,
    )
  }

  const updated = await podRepo.setExpectedQuantity(bookingId, quantity, unit, EXPECTED_QTY_EDITABLE)
  if (!updated) {
    throw new BookingError(
      'Booking could not be updated — its status changed concurrently',
      'INVALID_TRANSITION',
      409,
    )
  }
  return updated
}
