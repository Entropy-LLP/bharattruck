import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import authPlugin from './plugins/auth.js'
import internalAuthPlugin from './plugins/internal-auth.js'
import { bookingRoutes } from './routes/bookings.js'
import { quoteRoutes } from './routes/quotes.js'
import { locationRoutes } from './routes/location.js'
import { internalRoutes } from './routes/internal.js'

const app = Fastify({
  logger: {
    transport: process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  },
})

async function bootstrap() {
  await app.register(cors, { origin: true })

  // Health check — no auth required
  app.get('/health', () => ({ status: 'ok', service: 'bt-booking-service', ts: new Date().toISOString() }))

  // Auth-gated routes (user JWT)
  await app.register(async (authedApp) => {
    await authedApp.register(authPlugin)
    await authedApp.register(bookingRoutes, { prefix: '/bookings' })
    await authedApp.register(quoteRoutes, { prefix: '/bookings' })
    await authedApp.register(locationRoutes, { prefix: '/location' })
  })

  // Internal service-to-service routes (shared-secret gated, not public)
  await app.register(async (internalApp) => {
    await internalApp.register(internalAuthPlugin)
    await internalApp.register(internalRoutes, { prefix: '/internal' })
  })

  await app.listen({ port: Number(process.env.PORT ?? 3002), host: '0.0.0.0' })
}

bootstrap().catch(err => { console.error(err); process.exit(1) })
