import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const CreateOrderBody = z.object({
  booking_id: z.string().uuid(),
  amount: z.number().positive(),   // in INR
  shipper_id: z.string().uuid(),
})

export async function paymentRoutes(app: FastifyInstance) {

  // POST /payments/order — create Razorpay order (shipper pays into escrow)
  app.post('/order', async (req, reply) => {
    const body = CreateOrderBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.errors[0].message })
    // TODO Sprint 7: create Razorpay order, store in Supabase, return order_id + key_id to client
    return reply.status(201).send({
      success: true,
      data: {
        order_id: 'rzp_stub_order_id',
        amount: body.data.amount * 100,  // Razorpay uses paise
        currency: 'INR',
        note: 'Razorpay integration — Sprint 7',
      },
    })
  })

  // POST /payments/webhook — Razorpay webhook (payment confirmed → hold in escrow)
  app.post('/webhook', async (req, reply) => {
    // TODO Sprint 7: verify Razorpay signature, update payment status in Supabase
    app.log.info({ body: req.body }, 'Razorpay webhook received')
    return reply.send({ success: true })
  })

  // POST /payments/release — release escrow to driver (called after delivery confirmed)
  app.post('/release', async (req, reply) => {
    const { booking_id } = (req.body as any) ?? {}
    // TODO Sprint 7: verify delivery status, initiate Razorpay payout to driver bank account
    return reply.send({ success: true, data: { booking_id, status: 'payout_initiated', note: 'Sprint 7' } })
  })

  // GET /payments/status/:booking_id
  app.get('/status/:booking_id', async (req, reply) => {
    const { booking_id } = req.params as { booking_id: string }
    // TODO: fetch from Supabase
    return reply.send({ success: true, data: { booking_id, status: 'stub' } })
  })
}
