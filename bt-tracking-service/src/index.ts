import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import authPlugin from './plugins/auth.js'
import { trackingRoutes } from './routes/tracking.js'
import { TrackingError } from './lib/types.js'

const app = Fastify({
  logger: {
    transport:
      process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
})

async function bootstrap() {
  await app.register(cors, { origin: true })

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof TrackingError) {
      return reply.status(err.httpStatus).send({ success: false, error: err.message, code: err.code })
    }
    req.log.error(err)
    return reply.status(500).send({ success: false, error: 'Internal server error' })
  })

  // Health check — no auth required
  app.get('/health', () => ({ status: 'ok', service: 'bt-tracking-service', ts: new Date().toISOString() }))

  // Auth-gated routes
  await app.register(async (authedApp) => {
    await authedApp.register(authPlugin)
    await authedApp.register(trackingRoutes, { prefix: '/tracking' })
  })

  await app.listen({ port: Number(process.env.PORT ?? 3006), host: '0.0.0.0' })
}

bootstrap().catch((err) => {
  console.error(err)
  process.exit(1)
})
