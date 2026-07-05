import type { FastifyInstance, FastifyReply, FastifyPluginOptions } from 'fastify'
import { z } from 'zod'
import { PaymentError } from '../lib/errors.js'
import { settle, type PaymentDeps } from '../lib/payment-service.js'
import { defaultBookingClient } from '../lib/booking-client.js'
import { defaultPaymentStore } from '../lib/payment-store.js'

// NOTE: the previous Razorpay/escrow handlers here (order/webhook/release)
// were fabricated stubs (`rzp_stub_order_id`, TODO Sprint 7). Escrow is OUT
// of the MVP (cash-recorded/direct first), so they are removed in favour of
// the real settlement flow below. Escrow returns as a later upgrade.

const SettleBody = z.object({
  booking_id: z.string().uuid(),
  amount:     z.number().positive(),
  mode:       z.enum(['cash', 'upi', 'direct']),
  reference:  z.string().max(200).optional(),
})

type PaymentRouteOptions = FastifyPluginOptions & { deps?: PaymentDeps }

function handleError(reply: FastifyReply, err: unknown) {
  if (err instanceof PaymentError) {
    return reply.status(err.httpStatus).send({ success: false, error: err.message, code: err.code })
  }
  reply.log.error(err, 'Unhandled error in payment routes')
  return reply.status(500).send({ success: false, error: 'Internal server error' })
}

// -----------------------------------------------------------
// paymentRoutes — JWT-gated cash-recorded settlement (P1 #11).
// Deps default to real wiring; tests register with injected deps.
// -----------------------------------------------------------

export async function paymentRoutes(app: FastifyInstance, opts: PaymentRouteOptions) {
  const deps: PaymentDeps = opts.deps ?? {
    booking: defaultBookingClient(),
    store:   defaultPaymentStore(),
    logger:  app.log,
  }

  // POST /payments/settle — ops/admin or paying shipper records a
  // cash/UPI/direct settlement for a completed trip; booking → paid.
  app.post('/settle', async (req, reply) => {
    const body = SettleBody.safeParse(req.body)
    if (!body.success) {
      return reply.status(400).send({ success: false, error: body.error.errors[0].message, code: 'VALIDATION_ERROR' })
    }
    try {
      const data = await settle(
        { bookingId: body.data.booking_id, amount: body.data.amount, mode: body.data.mode, reference: body.data.reference ?? null },
        req.user,
        req.headers.authorization!,
        deps,
      )
      return reply.send({ success: true, data })
    } catch (err) {
      return handleError(reply, err)
    }
  })

  // GET /payments/status/:booking_id — ops/admin or shipper-owner reads
  // the recorded payment + payout for a booking.
  app.get('/status/:booking_id', async (req, reply) => {
    const params = z.object({ booking_id: z.string().uuid() }).safeParse(req.params)
    if (!params.success) {
      return reply.status(400).send({ success: false, error: params.error.errors[0].message, code: 'VALIDATION_ERROR' })
    }
    const bookingId = params.data.booking_id
    try {
      if (req.user.role !== 'admin' && req.user.role !== 'shipper') {
        throw new PaymentError('Not authorized to view settlement', 'FORBIDDEN', 403)
      }
      // Delegate ownership authz to booking-service (shipper must own it).
      await deps.booking.getBooking(bookingId, req.headers.authorization!)
      const payment = await deps.store.getPayment(bookingId)
      const payout = await deps.store.getPayout(bookingId)
      return reply.send({ success: true, data: { booking_id: bookingId, payment, payout } })
    } catch (err) {
      return handleError(reply, err)
    }
  })
}
