import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import authPlugin from './plugins/auth.js'
import { bookingRoutes } from './routes/bookings.js'
import { quoteRoutes } from './routes/quotes.js'
import { locationRoutes } from './routes/location.js'

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

  // Auth-gated routes
  await app.register(async (authedApp) => {
    await authedApp.register(authPlugin)
    await authedApp.register(bookingRoutes, { prefix: '/bookings' })
    await authedApp.register(quoteRoutes, { prefix: '/bookings' })
    await authedApp.register(locationRoutes, { prefix: '/location' })
  })

  await app.listen({ port: Number(process.env.PORT ?? 3002), host: '0.0.0.0' })
}

bootstrap().catch(err => { console.error(err); process.exit(1) })
