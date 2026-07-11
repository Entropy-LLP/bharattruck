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

const PYTHON_SERVICE_URL = process.env.PRICING_ENGINE_URL ?? 'http://localhost:8090'

// Vehicle type mapping to Python ML categories
const VEHICLE_MAP: Record<string, string> = {
  mini_truck: 'SCV Cargo',
  lcv: 'LCV (4-7T)',
  hcv: 'HCV Cargo 25-31T',
  trailer: 'HCV Cargo 49-55T',
}

// Load type mapping to Python ML handling options
const LOAD_MAP: Record<string, string[]> = {
  general: [],
  fragile: ['fragile'],
  perishable: ['reefer'],
  hazardous: ['hazmat'],
  heavy_machinery: ['odc'],
}

async function bootstrap() {
  await app.register(cors, { origin: true })

  // Health check — combines both Fastify and uvicorn health if ML pricing mode is active
  app.get('/health', async () => {
    let engineStatus = 'offline'
    let version = 'v1-static+cto-breakdown'
    
    try {
      const res = await fetch(`${PYTHON_SERVICE_URL}/health`)
      if (res.ok) {
        const body = await res.json() as any
        engineStatus = body.status
        version = `v2-ml-${body.version || 'unknown'}`
      }
    } catch (err) {
      // Python engine is unreachable, handle gracefully for health check
    }

    return {
      status: 'ok',
      service: 'bt-pricing-service',
      version,
      ts: new Date().toISOString(),
      engine_status: engineStatus,
    }
  })

  // JWT-gated pricing endpoints (P1 #11)
  await app.register(async (authed) => {
    await authed.register(authPlugin)

    // POST /quote — commercial split + CTO deterministic cost-breakdown anchor (or ML dynamically)
    authed.post('/quote', async (req, reply) => {
      const body = QuoteBody.safeParse(req.body)
      if (!body.success) {
        return reply.status(400).send({ 
          success: false, 
          error: body.error.errors[0].message, 
          code: 'VALIDATION_ERROR' 
        })
      }

      const useMl = process.env.PRICING_MODE === 'ml' || process.env.PRICING_MODE === 'dynamic'

      if (useMl) {
        const { distance_km, vehicle_type, load_type, weight_kg } = body.data

        // Map fields to ML format
        const model_category = VEHICLE_MAP[vehicle_type] ?? 'SCV Cargo'
        const handling = LOAD_MAP[load_type] ?? []
        const cargo_weight_mt = weight_kg / 1000.0

        // Construct ML payload with defaults for unspecified attributes
        const mlPayload = {
          model_category,
          vehicle_age: 5, // average/default
          distance_km,
          diesel_price: 92.0,
          demand_supply: 1.0,
          urgent: false,
          monsoon: false,
          harvest: false,
          shipper_segment: 'standard',
          load_type: 'FTL',
          cargo_weight_mt,
          cargo_volume_cft: 0.0,
          cargo_value_inr: 0.0,
          handling,
          manual_loading: false,
          operator_shippers_at_destination: 0,
          open_return_loads: 0,
        }

        try {
          const res = await fetch(`${PYTHON_SERVICE_URL}/v1/quote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(mlPayload),
          })

          if (!res.ok) {
            const errorData = await res.json() as any
            const msg = typeof errorData.detail === 'string' 
              ? errorData.detail 
              : JSON.stringify(errorData.detail)
            return reply.status(res.status).send({ 
              success: false, 
              error: msg || 'ML quote engine refused request' 
            })
          }

          const mlResp = await res.json() as any

          // Calculate metrics mapped from the ML response to legacy format
          const total = mlResp.rl_quote
          const platform_fee = Math.ceil(total * 0.10) // 10% platform rate matching legacy contract
          const base = mlResp.band.target
          const surcharges = mlResp.cargo.risk_premium_inr + mlResp.cargo.flat_handling_inr

          return reply.send({
            success: true,
            data: {
              base_price: base,
              weight_surcharge: surcharges,
              total_price: total,
              platform_fee,
              shipper_pays: total,
              driver_receives: total - platform_fee,
              currency: 'INR',
              version: 'v2-ml',
              quote_id: mlResp.quote_id,
            },
          })
        } catch (err) {
          return reply.status(502).send({
            success: false,
            error: 'ML pricing microservice is currently unreachable',
          })
        }
      } else {
        // Fallback to static rule-based pricing + CTO Cost breakdown
        return reply.send({ success: true, data: computeQuote(body.data) })
      }
    })

    // POST /quote/:quoteId/feedback — proxy client/shipper decisions to reinforcement learning agent
    authed.post('/quote/:quoteId/feedback', async (req, reply) => {
      const { quoteId } = req.params as { quoteId: string }
      try {
        const res = await fetch(`${PYTHON_SERVICE_URL}/v1/quote/${quoteId}/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req.body),
        })
        const data = await res.json()
        return reply.status(res.status).send(data)
      } catch (err) {
        return reply.status(502).send({ success: false, error: 'ML engine offline' })
      }
    })

    // POST /quote/ptl-aggregate — proxy consolidated consignment quotes to the ML engine
    authed.post('/quote/ptl-aggregate', async (req, reply) => {
      try {
        const res = await fetch(`${PYTHON_SERVICE_URL}/v1/quote/ptl-aggregate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req.body),
        })
        const data = await res.json()
        return reply.status(res.status).send(data)
      } catch (err) {
        return reply.status(502).send({ success: false, error: 'ML engine offline' })
      }
    })
  })

  await app.listen({ port: Number(process.env.PORT ?? 3003), host: '0.0.0.0' })
}

bootstrap().catch(err => {
  console.error(err)
  process.exit(1)
})
