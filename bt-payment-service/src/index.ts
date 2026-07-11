import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import authPlugin from './plugins/auth.js'
import internalAuthPlugin from './plugins/internal-auth.js'
import { paymentRoutes } from './routes/payments.js'
import { internalPaymentRoutes } from './routes/internal.js'

const app = Fastify({
  logger: {
    transport: process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  },
})

const PAYMENT_GATEWAY_URL = process.env.PAYMENT_GATEWAY_URL ?? 'http://localhost:8000'

async function bootstrap() {
  await app.register(cors, { origin: true })

  // Health check — combines Fastify liveness and uvicorn health if gateway mode is active
  app.get('/health', async () => {
    let gatewayStatus = 'offline'
    let healthDetails = {}

    try {
      const res = await fetch(`${PAYMENT_GATEWAY_URL}/health`)
      if (res.ok) {
        const body = await res.json() as any
        gatewayStatus = body.status || 'healthy'
        healthDetails = body
      }
    } catch (err) {
      // Gateway is offline, handle gracefully for liveness check
    }

    return {
      status: 'ok',
      service: 'bt-payment-service',
      ts: new Date().toISOString(),
      gateway: {
        status: gatewayStatus,
        details: healthDetails,
      }
    }
  })

  // Public Razorpay Webhook forwarder (no JWT auth required; signature validation done by uvicorn)
  app.post('/webhooks/razorpay', async (req, reply) => {
    try {
      const res = await fetch(`${PAYMENT_GATEWAY_URL}/webhooks/razorpay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Razorpay-Signature': req.headers['x-razorpay-signature'] as string || '',
        },
        body: JSON.stringify(req.body),
      })

      const text = await res.text()
      let data: any
      try {
        data = JSON.parse(text)
      } catch (err) {
        data = text
      }

      return reply.status(res.status).send(data)
    } catch (err) {
      return reply.status(502).send({ success: false, error: 'Payment gateway backend offline' })
    }
  })

  // JWT-gated money endpoints (P1 #11)
  await app.register(async (authedApp) => {
    await authedApp.register(authPlugin)

    const useGateway = process.env.PAYMENT_MODE === 'gateway' || process.env.PAYMENT_MODE === 'razorpay'

    if (useGateway) {
      // 1. Gateway Proxy Routes for Payments
      authedApp.post('/payments/create-order', async (req, reply) => {
        try {
          const res = await fetch(`${PAYMENT_GATEWAY_URL}/payments/create-order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body),
          })
          const data = await res.json()
          return reply.status(res.status).send(data)
        } catch (err) {
          return reply.status(502).send({ success: false, error: 'Payment gateway backend offline' })
        }
      })

      authedApp.get('/payments/:paymentId', async (req, reply) => {
        const { paymentId } = req.params as { paymentId: string }
        try {
          const res = await fetch(`${PAYMENT_GATEWAY_URL}/payments/${paymentId}`)
          const data = await res.json()
          return reply.status(res.status).send(data)
        } catch (err) {
          return reply.status(502).send({ success: false, error: 'Payment gateway backend offline' })
        }
      })

      authedApp.get('/payments/booking/:bookingId', async (req, reply) => {
        const { bookingId } = req.params as { bookingId: string }
        try {
          const res = await fetch(`${PAYMENT_GATEWAY_URL}/payments/booking/${bookingId}`)
          const data = await res.json()
          return reply.status(res.status).send(data)
        } catch (err) {
          return reply.status(502).send({ success: false, error: 'Payment gateway backend offline' })
        }
      })

      // Mapped legacy endpoints for compatibility in gateway mode
      authedApp.post('/payments/settle', async (req, reply) => {
        return reply.status(400).send({
          success: false,
          error: 'Direct settlement is disabled when PAYMENT_MODE is set to gateway. Payments must be processed through the escrow order/capture flow.',
          code: 'GATEWAY_MODE_ACTIVE'
        })
      })

      authedApp.get('/payments/status/:booking_id', async (req, reply) => {
        const { booking_id } = req.params as { booking_id: string }
        try {
          const res = await fetch(`${PAYMENT_GATEWAY_URL}/payments/booking/${booking_id}`)
          const data = await res.json()
          return reply.send({ success: true, data: { booking_id, transactions: data } })
        } catch (err) {
          return reply.status(502).send({ success: false, error: 'Payment gateway backend offline' })
        }
      })

      // 2. Gateway Proxy Routes for Proof of Delivery (POD)
      authedApp.post('/pod/upload', async (req, reply) => {
        try {
          const res = await fetch(`${PAYMENT_GATEWAY_URL}/pod/upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body),
          })
          const data = await res.json()
          return reply.status(res.status).send(data)
        } catch (err) {
          return reply.status(502).send({ success: false, error: 'Payment gateway backend offline' })
        }
      })

      authedApp.post('/pod/:podId/verify', async (req, reply) => {
        const { podId } = req.params as { podId: string }
        try {
          const res = await fetch(`${PAYMENT_GATEWAY_URL}/pod/${podId}/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body),
          })
          const data = await res.json()
          return reply.status(res.status).send(data)
        } catch (err) {
          return reply.status(502).send({ success: false, error: 'Payment gateway backend offline' })
        }
      })

      authedApp.post('/pod/:podId/reject', async (req, reply) => {
        const { podId } = req.params as { podId: string }
        try {
          const res = await fetch(`${PAYMENT_GATEWAY_URL}/pod/${podId}/reject`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body),
          })
          const data = await res.json()
          return reply.status(res.status).send(data)
        } catch (err) {
          return reply.status(502).send({ success: false, error: 'Payment gateway backend offline' })
        }
      })

      authedApp.get('/pod/booking/:bookingId', async (req, reply) => {
        const { bookingId } = req.params as { bookingId: string }
        try {
          const res = await fetch(`${PAYMENT_GATEWAY_URL}/pod/booking/${bookingId}`)
          const data = await res.json()
          return reply.status(res.status).send(data)
        } catch (err) {
          return reply.status(502).send({ success: false, error: 'Payment gateway backend offline' })
        }
      })

      // 3. Gateway Proxy Routes for Escrow holds and releases
      authedApp.get('/escrow/payment/:paymentId', async (req, reply) => {
        const { paymentId } = req.params as { paymentId: string }
        try {
          const res = await fetch(`${PAYMENT_GATEWAY_URL}/escrow/payment/${paymentId}`)
          const data = await res.json()
          return reply.status(res.status).send(data)
        } catch (err) {
          return reply.status(502).send({ success: false, error: 'Payment gateway backend offline' })
        }
      })

      authedApp.post('/escrow/payment/:paymentId/release', async (req, reply) => {
        const { paymentId } = req.params as { paymentId: string }
        try {
          const res = await fetch(`${PAYMENT_GATEWAY_URL}/escrow/payment/${paymentId}/release`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body),
          })
          const data = await res.json()
          return reply.status(res.status).send(data)
        } catch (err) {
          return reply.status(502).send({ success: false, error: 'Payment gateway backend offline' })
        }
      })
    } else {
      // Fallback to static cash-recorded payment routes
      await authedApp.register(paymentRoutes, { prefix: '/payments' })
    }
  })

  // Internal service-to-service routes (shared-secret gated, not public)
  await app.register(async (internalApp) => {
    await internalApp.register(internalAuthPlugin)
    await internalApp.register(internalPaymentRoutes, { prefix: '/internal' })
  })

  await app.listen({ port: Number(process.env.PORT ?? 3004), host: '0.0.0.0' })
}

bootstrap().catch(err => {
  console.error(err)
  process.exit(1)
})
