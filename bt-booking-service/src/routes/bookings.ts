import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { BookingError, CreateBookingBodySchema } from '../lib/types.js'
import * as svc from '../lib/service.js'
import * as pod from '../lib/pod/service.js'

const UuidParamSchema = z.object({ id: z.string().uuid('id must be a valid UUID') })

// The consignee inbox the POD delivery code is sent to. Trimmed before validating
// so a pasted address with trailing whitespace is accepted rather than rejected as
// malformed — this is typed on a phone, often at the drop point, under time pressure.
const ReceiverEmailBodySchema = z.object({
  receiver_email: z.string().trim().email('receiver_email must be a valid email address'),
})

// The server-held expected quantity a shipper/ops sets (never the driver, §5.7).
const ExpectedQuantityBodySchema = z.object({
  expected_quantity: z.number().nonnegative('expected_quantity must be >= 0'),
  unit: z.string().trim().min(1).optional(),
})

function handleError(reply: FastifyReply, err: unknown) {
  if (err instanceof BookingError) {
    return reply.status(err.httpStatus).send({ success: false, error: err.message, code: err.code })
  }
  reply.log.error(err, 'Unhandled error in booking routes')
  return reply.status(500).send({ success: false, error: 'Internal server error' })
}

function parseId(reply: FastifyReply, params: unknown): string | null {
  const parsed = UuidParamSchema.safeParse(params)
  if (!parsed.success) {
    reply.status(400).send({
      success: false,
      error: parsed.error.errors[0].message,
      code: 'VALIDATION_ERROR',
    })
    return null
  }
  return parsed.data.id
}

export async function bookingRoutes(app: FastifyInstance) {

  // POST /bookings — shipper creates a booking intent (status=pending)
  app.post('/', async (req, reply) => {
    const parsed = CreateBookingBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: parsed.error.errors[0].message,
        code: 'VALIDATION_ERROR',
      })
    }
    try {
      // pricing client left to its default; req.log lets the saga's compensation
      // path surface an orphaned booking if the compensating delete ever fails.
      const booking = await svc.createBooking(parsed.data, req.user, undefined, req.log)
      return reply.status(201).send({ success: true, data: booking })
    } catch (err) {
      return handleError(reply, err)
    }
  })

  // GET /bookings/:id — get booking with driver profile joined
  app.get('/:id', async (req, reply) => {
    const id = parseId(reply, req.params)
    if (!id) return
    try {
      const booking = await svc.getBooking(id, req.user)
      return reply.send({ success: true, data: booking })
    } catch (err) {
      return handleError(reply, err)
    }
  })

  // GET /bookings/:id/pod-context — assigned driver fetches POD context
  // (status + consignee receiver_email + geofence gate result) to request a receiver OTP.
  app.get('/:id/pod-context', async (req, reply) => {
    const id = parseId(reply, req.params)
    if (!id) return
    try {
      const ctx = await svc.getPodContext(id, req.user, req.log)
      return reply.send({ success: true, data: ctx })
    } catch (err) {
      return handleError(reply, err)
    }
  })

  // GET /bookings/:id/pod — the POD ledger for one trip: proof strength, the evidence
  // list, the discrepancy and its claim clocks.
  //
  // The read that makes the ledger useful — 'confirmed' (receiver OTP) vs 'asserted'
  // (evidence only) is invisible from bookings.status alone, and ops must see which one
  // they are closing. Relation-gated (D-27), not role-gated: shipper / carrier /
  // assigned driver / claimed consignee / ops. Forensic fields — the WORM storage
  // handle, EXIF, device fingerprint, fraud signals — are narrower still (see
  // POD_FORENSIC_RELATIONS). Every read writes an evidence_access audit line.
  app.get('/:id/pod', async (req, reply) => {
    const id = parseId(reply, req.params)
    if (!id) return
    try {
      const record = await pod.getPodRecord(id, req.user, req.log)
      return reply.send({ success: true, data: record })
    } catch (err) {
      return handleError(reply, err)
    }
  })

  // POST /bookings/:id/pod-evidence — assigned driver records a camera capture.
  //
  // Camera-only, on-device SHA-256 (stored verbatim), server-authoritative time. The
  // bytes go straight to WORM object storage via the driver app's signed PUT; this only
  // records metadata (§5.4). Idempotent on (booking, hash) — a retry is a no-op.
  app.post('/:id/pod-evidence', async (req, reply) => {
    const id = parseId(reply, req.params)
    if (!id) return
    const body = pod.EvidenceCaptureSchema.safeParse(req.body)
    if (!body.success) {
      return reply.status(400).send({ success: false, error: body.error.errors[0].message, code: 'VALIDATION_ERROR' })
    }
    try {
      const result = await pod.captureEvidence(id, req.user, body.data, req.log)
      return reply.status(result.created ? 201 : 200).send({ success: true, data: result })
    } catch (err) {
      return handleError(reply, err)
    }
  })

  // POST /bookings/:id/discrepancy — assigned driver logs a shortage/damage note.
  //
  // Expected is SERVER-HELD (read off the booking, not the body — the schema refuses a
  // client-sent expected_quantity); a photo is mandatory when counts differ; the driver
  // is put on record and the two claim clocks (180-day booking / 7-day delivery) are
  // surfaced. Idempotent on the booking.
  app.post('/:id/discrepancy', async (req, reply) => {
    const id = parseId(reply, req.params)
    if (!id) return
    const body = pod.DiscrepancySchema.safeParse(req.body)
    if (!body.success) {
      return reply.status(400).send({ success: false, error: body.error.errors[0].message, code: 'VALIDATION_ERROR' })
    }
    try {
      const result = await pod.submitDiscrepancy(id, req.user, body.data, req.log)
      return reply.status(result.created ? 201 : 200).send({ success: true, data: result })
    } catch (err) {
      return handleError(reply, err)
    }
  })

  // POST /bookings/:id/assert-delivery — the no-confirmation branch.
  //
  // Receiver cannot confirm (no smartphone, night drop, warehouse hand-off). Driver has
  // captured evidence; the trip moves in_transit → delivery_asserted (NOT completed) with
  // pod_strength='asserted', and ops closes it later. Requires evidence to already exist.
  app.post('/:id/assert-delivery', async (req, reply) => {
    const id = parseId(reply, req.params)
    if (!id) return
    const body = pod.AssertDeliverySchema.safeParse(req.body)
    if (!body.success) {
      return reply.status(400).send({ success: false, error: body.error.errors[0].message, code: 'VALIDATION_ERROR' })
    }
    try {
      const result = await pod.assertDelivery(id, req.user, body.data, req.log)
      return reply.status(result.created ? 201 : 200).send({ success: true, data: result })
    } catch (err) {
      return handleError(reply, err)
    }
  })

  // PATCH /bookings/:id/expected-quantity — shipper (or ops) sets the server-held
  // expected delivery count the discrepancy flow reconciles against. Mirrors
  // receiver-email: owning shipper or ops only, DELIBERATELY NOT the driver (§5.7).
  app.patch('/:id/expected-quantity', async (req, reply) => {
    const id = parseId(reply, req.params)
    if (!id) return
    const body = ExpectedQuantityBodySchema.safeParse(req.body)
    if (!body.success) {
      return reply.status(400).send({ success: false, error: body.error.errors[0].message, code: 'VALIDATION_ERROR' })
    }
    try {
      const booking = await pod.setExpectedQuantity(id, body.data.expected_quantity, body.data.unit ?? null, req.user)
      return reply.send({ success: true, data: booking })
    } catch (err) {
      return handleError(reply, err)
    }
  })

  // GET /bookings — shipper: own bookings | driver: pending bookings | admin: all
  app.get('/', async (req, reply) => {
    try {
      const bookings = await svc.listBookings(req.user)
      return reply.send({ success: true, data: bookings })
    } catch (err) {
      return handleError(reply, err)
    }
  })

  // PATCH /bookings/:id/receiver-email — shipper (or ops) sets the consignee inbox
  //
  // The unblocking route for a trip whose booking has no receiver_email: without
  // one the driver's POD request has nowhere to send the delivery code, so the
  // trip can never reach 'completed'. Separate from a general booking PATCH on
  // purpose — every other field on a live booking is either price-locked or
  // state-machine-driven, and this is the only one a shipper may safely change
  // mid-trip.
  app.patch('/:id/receiver-email', async (req, reply) => {
    const id = parseId(reply, req.params)
    if (!id) return
    const body = ReceiverEmailBodySchema.safeParse(req.body)
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: body.error.errors[0].message,
        code: 'VALIDATION_ERROR',
      })
    }
    try {
      const booking = await svc.setReceiverEmail(id, body.data.receiver_email, req.user)
      return reply.send({ success: true, data: booking })
    } catch (err) {
      return handleError(reply, err)
    }
  })

  // PATCH /bookings/:id/accept — driver accepts a pending booking
  app.patch('/:id/accept', async (req, reply) => {
    const id = parseId(reply, req.params)
    if (!id) return
    try {
      const booking = await svc.acceptBooking(id, req.user, req.log)
      return reply.send({ success: true, data: booking })
    } catch (err) {
      return handleError(reply, err)
    }
  })

  // PATCH /bookings/:id/direct-attach — the shipper moves their OWN load with
  // their OWN fleet or truck (D-10), skipping the auction.
  //
  // No body: the carrier is the caller's own resolved persona, and letting a
  // request name it would turn this into "assign the load to whoever I say",
  // which is ops' reassign route, not this one. Sits alongside /accept because it
  // is the same edge of the state machine (pending|negotiating → accepted) —
  // only the party performing it, and the award path recorded, differ.
  app.patch('/:id/direct-attach', async (req, reply) => {
    const id = parseId(reply, req.params)
    if (!id) return
    try {
      const booking = await svc.directAttachBooking(id, req.user, req.log)
      return reply.send({ success: true, data: booking })
    } catch (err) {
      return handleError(reply, err)
    }
  })

  // PATCH /bookings/:id/start — assigned driver moves accepted → in_transit
  app.patch('/:id/start', async (req, reply) => {
    const id = parseId(reply, req.params)
    if (!id) return
    try {
      const booking = await svc.startBooking(id, req.user, req.log)
      return reply.send({ success: true, data: booking })
    } catch (err) {
      return handleError(reply, err)
    }
  })

  // NOTE: there is deliberately NO driver-facing PATCH /bookings/:id/complete.
  // Completion (in_transit → completed) is closed ONLY by the receiver-OTP POD
  // path (internal /bookings/:id/complete-pod → completeBookingViaPod) or an ops
  // force-complete. A driver cannot self-complete a trip.

  // PATCH /bookings/:id/cancel — cancel from pending or accepted
  app.patch('/:id/cancel', async (req, reply) => {
    const id = parseId(reply, req.params)
    if (!id) return
    try {
      const booking = await svc.cancelBooking(id, req.user, req.log)
      return reply.send({ success: true, data: booking })
    } catch (err) {
      return handleError(reply, err)
    }
  })
}
