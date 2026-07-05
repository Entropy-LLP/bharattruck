import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { BookingError } from '../lib/types.js'
import * as svc from '../lib/service.js'
import { emitTripCompleted } from '../lib/payment-emit.js'

const UuidParamSchema = z.object({ id: z.string().uuid('id must be a valid UUID') })

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
      const booking = await svc.completeBookingViaPod(parsed.data.id)
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
    try {
      const booking = await svc.markBookingPaid(parsed.data.id)
      return reply.send({ success: true, data: booking })
    } catch (err) {
      return handleError(reply, err)
    }
  })
}
