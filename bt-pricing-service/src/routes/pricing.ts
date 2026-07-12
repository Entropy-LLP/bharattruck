import type { FastifyInstance, FastifyReply } from 'fastify'
import { QuoteBody, computeQuote } from '../lib/pricing.js'
import { insertPriceQuote } from '../lib/price-quote-store.js'

// -----------------------------------------------------------
// pricingRoutes — public, JWT-gated. Mounted under `/pricing` so the gateway
// rewrite (/api/pricing/(.*) -> /pricing/$1) reaches POST /pricing/quote.
//
// POST /quote computes the commercial split + CTO deterministic cost-breakdown
// (numbers unchanged) and PERSISTS it as a price_quotes lock (source of truth,
// no in-memory store). It returns the existing QuoteResult PLUS the lock handle
// { quote_id, quoted_price, breakdown, currency, expires_at } the shipper sends
// back on booking-create so the price SHOWN == the price CHARGED (PRD 5.4).
// -----------------------------------------------------------

// Locked-quote validity window. Sane default; a shipper who dawdles past this
// re-fetches a fresh quote.
const QUOTE_TTL_MS = 30 * 60_000 // 30 minutes

function handleError(reply: FastifyReply, err: unknown) {
  reply.log.error(err, 'Unhandled error in pricing routes')
  return reply.status(500).send({ success: false, error: 'Internal server error' })
}

export async function pricingRoutes(app: FastifyInstance) {
  // POST /quote (final path /pricing/quote). req.user.userId is the shipper's
  // users.id (JWT). shipper_pays === total_price is the number locked as quoted_price.
  app.post('/quote', async (req, reply) => {
    const body = QuoteBody.safeParse(req.body)
    if (!body.success) {
      return reply.status(400).send({ success: false, error: body.error.errors[0].message, code: 'VALIDATION_ERROR' })
    }
    try {
      const result = computeQuote(body.data)
      const expiresAt = new Date(Date.now() + QUOTE_TTL_MS).toISOString()

      const row = await insertPriceQuote({
        shipper_id:     req.user.userId,
        distance_km:    body.data.distance_km,
        vehicle_type:   body.data.vehicle_type,
        vehicle_class:  result.cost_breakdown.vehicle_class,
        load_type:      body.data.load_type,
        weight_kg:      body.data.weight_kg,
        breakdown_json: result,
        quoted_price:   result.shipper_pays,
        currency:       'INR',
        expires_at:     expiresAt,
      })

      return reply.send({
        success: true,
        data: {
          ...result,
          quote_id:     row.id,
          quoted_price: row.quoted_price,
          breakdown:    result.cost_breakdown,
          currency:     row.currency,
          expires_at:   row.expires_at,
        },
      })
    } catch (err) {
      return handleError(reply, err)
    }
  })
}
