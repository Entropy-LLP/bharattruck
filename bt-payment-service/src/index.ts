import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { paymentRoutes } from './routes/payments.js'

const app = Fastify({
  logger: {
    transport: process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  },
})

async function bootstrap() {
  await app.register(cors, { origin: true })
  await app.register(paymentRoutes, { prefix: '/payments' })
  app.get('/health', () => ({ status: 'ok', service: 'bt-payment-service', ts: new Date().toISOString() }))
  await app.listen({ port: Number(process.env.PORT ?? 3004), host: '0.0.0.0' })
}

bootstrap().catch(err => { console.error(err); process.exit(1) })
