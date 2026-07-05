import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import authPlugin from './plugins/auth.js'
import { QuoteBody, computeQuote } from './lib/pricing.js'

const app = Fastify({
  logger: {
    transport: process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  },
})

async function bootstrap() {
  await app.register(cors, { origin: true })

  // Health check — no auth required
  app.get('/health', () => ({ status: 'ok', service: 'bt-pricing-service', version: 'v1-static+cto-breakdown', ts: new Date().toISOString() }))

  // JWT-gated pricing (P1 #11)
  await app.register(async (authed) => {
    await authed.register(authPlugin)

    // POST /quote — commercial split + CTO deterministic cost-breakdown anchor
    authed.post('/quote', async (req, reply) => {
      const body = QuoteBody.safeParse(req.body)
      if (!body.success) {
        return reply.status(400).send({ success: false, error: body.error.errors[0].message, code: 'VALIDATION_ERROR' })
      }
      return reply.send({ success: true, data: computeQuote(body.data) })
    })
  })

  await app.listen({ port: Number(process.env.PORT ?? 3003), host: '0.0.0.0' })
}

bootstrap().catch(err => { console.error(err); process.exit(1) })
