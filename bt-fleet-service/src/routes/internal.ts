import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { rollUpTripEconomics } from '../lib/economics.js'
import { parseOrThrow } from '../lib/types.js'

// -----------------------------------------------------------
// internalFleetRoutes — service-to-service (internal-secret gated, NOT
// gateway-exposed). Mounted under `/internal`.
//
// bt-payment-service fires the roll-up on completed->paid. It is intentionally a
// separate call rather than a DB trigger so the P&L model can change without a
// migration, and it is idempotent on booking_id so an at-least-once delivery (the
// outbox pattern the payout saga already uses) is safe.
// -----------------------------------------------------------

const BookingIdParam = z.object({
  bookingId: z.string().uuid('bookingId must be a valid UUID'),
})

export async function internalFleetRoutes(app: FastifyInstance) {
  // POST /internal/trip-economics/:bookingId
  app.post('/trip-economics/:bookingId', async (req, reply) => {
    const params = parseOrThrow(BookingIdParam, req.params)
    const result = await rollUpTripEconomics(params.bookingId)

    // A solo-driver trip has no asset to attribute cost to. That is a normal,
    // expected outcome of a hook that fires for every paid booking — reporting it
    // as success-with-skipped keeps the caller's retry logic from spinning on it.
    return reply.send({ success: true, data: result })
  })
}
