import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { BookingError } from '../lib/types.js'
import * as svc from '../lib/service.js'
import { emitTripCompleted } from '../lib/payment-emit.js'
import * as notify from '../lib/notifications/emit.js'
import { dispatchOnce } from '../lib/notifications/dispatcher.js'
import { mailer } from '../lib/notifications/mailer.js'

const UuidParamSchema = z.object({ id: z.string().uuid('id must be a valid UUID') })

// Optional settlement detail from bt-payment-service. Every field is optional so an
// older payment-service that posts no body at all keeps working exactly as before —
// markBookingPaid falls back to the booking's own price for the receipt.
const MarkPaidBodySchema = z.object({
  amount:        z.number().positive().optional(),
  method:        z.string().optional(),
  payment_id:    z.string().optional(),
  payout_status: z.string().optional(),
}).optional()

// Cross-service notification triggers. bt-fleet-service and bt-auth-service own these
// domain events but have no dispatcher of their own, so they post the event here and
// this service resolves the audience and queues it.
const NotifyBodySchema = z.discriminatedUnion('event', [
  z.object({
    event:          z.literal('fleet_invite'),
    invite_id:      z.string().uuid(),
    driver_id:      z.string().uuid(),
    fleet_owner_id: z.string().uuid(),
  }),
  z.object({
    event:          z.literal('fleet_invite_answered'),
    invite_id:      z.string().uuid(),
    driver_id:      z.string().uuid(),
    fleet_owner_id: z.string().uuid(),
    response:       z.enum(['accepted', 'declined']),
  }),
  z.object({
    event:      z.literal('password_changed'),
    user_id:    z.string().uuid(),
    changed_at: z.string().optional(),
  }),
])

function handleError(reply: FastifyReply, err: unknown) {
  if (err instanceof BookingError) {
    return reply.status(err.httpStatus).send({ success: false, error: err.message, code: err.code })
  }
  reply.log.error(err, 'Unhandled error in internal routes')
  return reply.status(500).send({ success: false, error: 'Internal server error' })
}

// -----------------------------------------------------------
// internalRoutes — service-to-service routes (internal-secret gated).
// Mounted under /internal; NOT exposed through the public gateway.
// -----------------------------------------------------------

export async function internalRoutes(app: FastifyInstance) {

  // POST /internal/bookings/:id/complete-pod
  // Called by bt-cargo-ledger after a receiver OTP is verified.
  // Drives in_transit → completed through the shared state machine.
  app.post('/bookings/:id/complete-pod', async (req, reply) => {
    const parsed = UuidParamSchema.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.errors[0].message, code: 'VALIDATION_ERROR' })
    }
    try {
      const booking = await svc.completeBookingViaPod(parsed.data.id, req.log)
      emitTripCompleted(booking, req.log)  // best-effort payout-saga trigger
      return reply.send({ success: true, data: booking })
    } catch (err) {
      return handleError(reply, err)
    }
  })

  // POST /internal/bookings/:id/mark-paid
  // Called by bt-payment-service after a cash/direct settlement is
  // recorded. Drives completed → paid through the shared state machine.
  app.post('/bookings/:id/mark-paid', async (req, reply) => {
    const parsed = UuidParamSchema.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.errors[0].message, code: 'VALIDATION_ERROR' })
    }
    const body = MarkPaidBodySchema.safeParse(req.body ?? undefined)
    if (!body.success) {
      return reply.status(400).send({ success: false, error: body.error.errors[0].message, code: 'VALIDATION_ERROR' })
    }
    try {
      const booking = await svc.markBookingPaid(
        parsed.data.id,
        {
          amount:       body.data?.amount ?? null,
          method:       body.data?.method ?? null,
          paymentId:    body.data?.payment_id ?? null,
          payoutStatus: body.data?.payout_status ?? null,
        },
        req.log,
      )
      return reply.send({ success: true, data: booking })
    } catch (err) {
      return handleError(reply, err)
    }
  })

  // POST /internal/notifications
  // Queue a notification for a domain event owned by another service.
  //
  // The audience resolution (drivers.id -> users.id -> email, fleet owner vs driver)
  // lives here rather than being reimplemented per service. Always 202: a caller must
  // never have its own operation fail because a notification could not be queued.
  app.post('/notifications', async (req, reply) => {
    const parsed = NotifyBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.errors[0].message, code: 'VALIDATION_ERROR' })
    }
    const e = parsed.data
    if (e.event === 'fleet_invite') {
      await notify.emitFleetInvite(
        { inviteId: e.invite_id, driverId: e.driver_id, fleetOwnerId: e.fleet_owner_id },
        req.log,
      )
    } else if (e.event === 'fleet_invite_answered') {
      await notify.emitFleetInviteAnswered(
        {
          inviteId: e.invite_id, driverId: e.driver_id,
          fleetOwnerId: e.fleet_owner_id, response: e.response,
        },
        req.log,
      )
    } else {
      await notify.emitPasswordChanged({ userId: e.user_id, changedAt: e.changed_at }, req.log)
    }
    return reply.status(202).send({ success: true })
  })

  // POST /internal/notifications/dispatch
  // Drain the outbox. THIS IS THE SUPPORTED PRODUCTION TRIGGER: Cloud Run freezes the
  // container between requests unless CPU-always-allocated is set, so an in-process
  // timer does not reliably fire — a request does. Point Cloud Scheduler at this every
  // minute (see docs/BIBLE.md §7.1).
  //
  // Safe to call concurrently: the dispatcher claims each row with a compare-and-swap,
  // so an overlapping tick finds nothing to do rather than sending duplicates.
  app.post('/notifications/dispatch', async (req, reply) => {
    try {
      const result = await dispatchOnce(mailer(), 25, req.log)
      return reply.send({ success: true, data: result })
    } catch (err) {
      req.log.error(err, 'notification dispatch failed')
      return reply.status(500).send({ success: false, error: 'Dispatch failed' })
    }
  })
}
