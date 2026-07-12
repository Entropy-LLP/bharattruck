import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { QuoteBody, computeQuote } from '../lib/pricing.js'
import { insertPriceQuote } from '../lib/price-quote-store.js'
import { roadDistanceKm } from '../lib/geo.js'

// -----------------------------------------------------------
// pricingRoutes — public, JWT-gated. Mounted under `/pricing` so the gateway
// rewrite (/api/pricing/(.*) -> /pricing/$1) reaches POST /pricing/quote.
//
// POST /quote accepts the booking's ROUTE (source/dest coords) + cargo, DERIVES
// distance_km server-side (haversine × road-winding factor — never client-asserted;
// no Google Routes/maps key here per the FROZEN maps rule), computes the commercial
// split + CTO deterministic cost-breakdown (numbers unchanged), and PERSISTS it as a
// price_quotes lock (source of truth, no in-memory store). It returns the QuoteResult
// PLUS the lock handle { quote_id, quoted_price, breakdown, currency, expires_at } the
// shipper sends back on booking-create so the price SHOWN == the price CHARGED (PRD 5.4).
// The coords + cargo are persisted so booking-create can BIND the booking to exactly
// what was priced.
// -----------------------------------------------------------

// Request body: the booking's route + cargo. distance_km is DERIVED here, never
// accepted from the client. Reuses QuoteBody's vehicle_type/load_type/weight_kg
// enums (single source of truth) and drops the old client-supplied distance_km.
const lat = z.number().min(-90).max(90)
const lng = z.number().min(-180).max(180)
const QuoteRequestBody = QuoteBody.omit({ distance_km: true }).extend({
  source_lat: lat,
  source_lng: lng,
  dest_lat:   lat,
  dest_lng:   lng,
})

// Locked-quote validity window. Sane default; a shipper who dawdles past this
// re-fetches a fresh quote.
const QUOTE_TTL_MS = 30 * 60_000 // 30 minutes

function handleError(reply: FastifyReply, err: unknown) {
  reply.log.error(err, 'Unhandled error in pricing routes')
  return reply.status(500).send({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' })
}

export async function pricingRoutes(app: FastifyInstance) {
  // POST /quote (final path /pricing/quote). req.user.userId is the shipper's
  // users.id (JWT). shipper_pays === total_price is the number locked as quoted_price.
  app.post('/quote', async (req, reply) => {
    const body = QuoteRequestBody.safeParse(req.body)
    if (!body.success) {
      return reply.status(400).send({ success: false, error: body.error.errors[0].message, code: 'VALIDATION_ERROR' })
    }
    try {
      // Derive road distance from the coords (self-contained; no maps key).
      const distance_km = roadDistanceKm(
        body.data.source_lat, body.data.source_lng,
        body.data.dest_lat,   body.data.dest_lng,
      )
      // Guard identical/degenerate coords so we never trip the DB check
      // (distance_km > 0 / quoted_price > 0) and leak a 500 — return a clean 4xx.
      if (!(distance_km > 0)) {
        return reply.status(400).send({
          success: false,
          error: 'Source and destination are the same location — cannot price a zero-distance trip',
          code: 'VALIDATION_ERROR',
        })
      }

      const result = computeQuote({
        distance_km,
        vehicle_type: body.data.vehicle_type,
        load_type:    body.data.load_type,
        weight_kg:    body.data.weight_kg,
      })
      const expiresAt = new Date(Date.now() + QUOTE_TTL_MS).toISOString()

      const row = await insertPriceQuote({
        shipper_id:     req.user.userId,
        source_lat:     body.data.source_lat,
        source_lng:     body.data.source_lng,
        dest_lat:       body.data.dest_lat,
        dest_lng:       body.data.dest_lng,
        distance_km,
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
