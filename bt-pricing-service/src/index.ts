import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { z } from 'zod'

const app = Fastify({
  logger: {
    transport: process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  },
})

// v1: static rates. v2 (Sprint 17): replace with Python FastAPI ML model
const RATE_PER_KM: Record<string, number> = { mini_truck: 12, lcv: 15, hcv: 22, trailer: 35 }
const LOAD_MULT: Record<string, number>   = { general: 1.0, fragile: 1.2, perishable: 1.15, hazardous: 1.5, heavy_machinery: 1.3 }
const PLATFORM_RATE = 0.10

const QuoteBody = z.object({
  distance_km:  z.number().positive(),
  vehicle_type: z.enum(['mini_truck', 'lcv', 'hcv', 'trailer']),
  load_type:    z.enum(['general', 'fragile', 'perishable', 'hazardous', 'heavy_machinery']),
  weight_kg:    z.number().positive(),
})

async function bootstrap() {
  await app.register(cors, { origin: true })

  app.get('/health', () => ({ status: 'ok', service: 'bt-pricing-service', version: 'v1-static', ts: new Date().toISOString() }))

  app.post('/quote', async (req, reply) => {
    const body = QuoteBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.errors[0].message })
    const { distance_km, vehicle_type, load_type, weight_kg } = body.data

    const base        = Math.ceil(distance_km * (RATE_PER_KM[vehicle_type] ?? 15) * (LOAD_MULT[load_type] ?? 1.0))
    const wt_surcharge = weight_kg > 5000 ? Math.ceil((weight_kg - 5000) / 1000) * 500 : 0
    const total        = base + wt_surcharge
    const platform_fee = Math.ceil(total * PLATFORM_RATE)

    return reply.send({
      success: true,
      data: {
        base_price: base,
        weight_surcharge: wt_surcharge,
        total_price: total,
        platform_fee,
        shipper_pays: total,
        driver_receives: total - platform_fee,
        currency: 'INR',
        version: 'v1-static',
      },
    })
  })

  await app.listen({ port: Number(process.env.PORT ?? 3003), host: '0.0.0.0' })
}

bootstrap().catch(err => { console.error(err); process.exit(1) })
