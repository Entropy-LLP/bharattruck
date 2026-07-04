import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { shipmentRoutes } from './routes/shipments.js'

const app = Fastify({
  logger: {
    transport: process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  },
})

async function bootstrap() {
  await app.register(cors, { origin: true })
  await app.register(shipmentRoutes, { prefix: '/shipments' })
  app.get('/health', () => ({
    status: 'ok',
    service: 'bt-cargo-ledger',
    blockchain_enabled: process.env.BLOCKCHAIN_ENABLED === 'true',
    ts: new Date().toISOString(),
  }))
  await app.listen({ port: Number(process.env.PORT ?? 3005), host: '0.0.0.0' })
}

bootstrap().catch(err => { console.error(err); process.exit(1) })
