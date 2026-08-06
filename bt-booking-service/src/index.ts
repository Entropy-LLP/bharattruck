import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import authPlugin from './plugins/auth.js'
import internalAuthPlugin from './plugins/internal-auth.js'
import { bookingRoutes } from './routes/bookings.js'
import { quoteRoutes } from './routes/quotes.js'
import { locationRoutes } from './routes/location.js'
import { internalRoutes } from './routes/internal.js'
import { opsRoutes } from './routes/ops.js'
import { documentRoutes } from './routes/documents.js'
import { notificationRoutes } from './routes/notifications.js'
import { startDispatchLoop } from './lib/notifications/dispatcher.js'
import { mailer, smtpConfigured } from './lib/notifications/mailer.js'

const app = Fastify({
  logger: {
    transport: process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  },
})

async function bootstrap() {
  await app.register(cors, { origin: true })

  // Health check — no auth required.
  // Reports whether SMTP is live, because "email silently degraded to console logging"
  // is the exact failure this service has already shipped once (see
  // docs/tasks/feat-pod-email-smtp.md) and it is invisible without something like this.
  app.get('/health', () => ({
    status: 'ok',
    service: 'bt-booking-service',
    email: smtpConfigured() ? 'smtp' : 'console',
    ts: new Date().toISOString(),
  }))

  // Public, unauthenticated: unsubscribe links must work from a mail client.
  await app.register(notificationRoutes, { prefix: '/notifications' })

  // Auth-gated routes (user JWT)
  await app.register(async (authedApp) => {
    await authedApp.register(authPlugin)
    await authedApp.register(bookingRoutes, { prefix: '/bookings' })
    await authedApp.register(quoteRoutes, { prefix: '/bookings' })
    await authedApp.register(opsRoutes, { prefix: '/bookings' })
    // Freight documents (migration 0024) share the /bookings prefix so the edge
    // needs no new route: bt-gateway already forwards /bookings here.
    await authedApp.register(documentRoutes, { prefix: '/bookings' })
    await authedApp.register(locationRoutes, { prefix: '/location' })
  })

  // Internal service-to-service routes (shared-secret gated, not public)
  await app.register(async (internalApp) => {
    await internalApp.register(internalAuthPlugin)
    await internalApp.register(internalRoutes, { prefix: '/internal' })
  })

  // Optional in-process outbox drain. OFF unless NOTIFICATIONS_DISPATCH_INTERVAL_MS is
  // set, because on Cloud Run the container is frozen between requests (no CPU without
  // always-allocated), so a timer would not reliably fire and the outbox would fill up
  // silently. Production drains via Cloud Scheduler POSTing
  // /internal/notifications/dispatch; this is for local dev and always-on hosts.
  startDispatchLoop(mailer(), app.log)

  await app.listen({ port: Number(process.env.PORT ?? 3002), host: '0.0.0.0' })
}

bootstrap().catch(err => { console.error(err); process.exit(1) })
