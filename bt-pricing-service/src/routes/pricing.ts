import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { QuoteBody, computeQuote } from '../lib/pricing.js'
import { insertPriceQuote } from '../lib/price-quote-store.js'
import { roadDistanceKm } from '../lib/geo.js'
import { resolveCostFloor, type CostFloorBreakdown } from '../lib/cost-engine.js'
import { defaultRouteDistanceClient } from '../lib/tracking-client.js'

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
//
// "SHOWN == CHARGED" holds for BINDING quotes (booking_type 'direct', and any caller
// that sends no booking_type). For an ADVISORY quote — an auction — the platform has
// no price at all: quoted_price is a benchmark and the charge is the winning carrier's
// bid. The row is still written, because it is the record of what the shipper was
// shown and when, which is precisely the evidence you want if the pricing posture is
// ever questioned (INDIA_FREIGHT_COMPLIANCE.md §1.3). Read quote_kind out of
// breakdown_json before treating a stored quoted_price as an amount owed.
//
// The default cuts the wrong way at production volume, so read it as a compatibility
// shim and not as a safe fallback: booking_type is optional ONLY so that a caller
// written before this field keeps working. Live bookings are ~94% auction, so a
// caller that omits it does not produce a neutral row — it produces a stored
// `quote_kind: 'binding'`, a machine-readable claim that the platform charged that
// freight, on the exact bookings where §1.3 red line 3 says it must never claim
// that. Any NEW caller sends its booking_type. Adding one that does not is a
// regression even though nothing fails.
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
      // Real road distance from bt-tracking-service (cached there; the Google Maps key never enters
      // pricing — the frozen maps CONTRACT). Any failure/timeout/missing-secret falls back to the
      // self-contained haversine estimate, so a quote never hard-fails on tracking being down (P1).
      const routeClient = defaultRouteDistanceClient()
      let routedKm: number | null = null
      if (routeClient) {
        try {
          routedKm = await routeClient.routeDistanceKm({
            source_lat: body.data.source_lat, source_lng: body.data.source_lng,
            dest_lat:   body.data.dest_lat,   dest_lng:   body.data.dest_lng,
          })
        } catch (err) {
          req.log.warn({ err }, 'tracking route lookup failed; falling back to haversine estimate')
        }
      }
      const distance_km = routedKm ?? roadDistanceKm(
        body.data.source_lat, body.data.source_lng,
        body.data.dest_lat,   body.data.dest_lng,
      )
      const distance_basis: 'routed' | 'estimated' = routedKm != null ? 'routed' : 'estimated'
      // Guard identical/degenerate coords so we never trip the DB check
      // (distance_km > 0 / quoted_price > 0) and leak a 500 — return a clean 4xx.
      if (!(distance_km > 0)) {
        return reply.status(400).send({
          success: false,
          error: 'Source and destination are the same location — cannot price a zero-distance trip',
          code: 'VALIDATION_ERROR',
        })
      }

      // Resolve the REAL CV-Parc cost floor. Defensive: a norms-table outage must
      // not take down quoting — the commercial split below does not depend on the
      // floor — so a failure logs and degrades to `cost_floor: null`. In
      // production the tables are seeded, so this populates.
      let costFloor: CostFloorBreakdown | null = null
      try {
        costFloor = await resolveCostFloor({
          distance_km,
          weight_kg:        body.data.weight_kg,
          load_type:        body.data.load_type,
          vehicle_type:     body.data.vehicle_type,
          model_category:   body.data.model_category,
          emission_norm:    body.data.emission_norm,
          truck_age:        body.data.truck_age,
          diesel_price_inr: body.data.diesel_price_inr,
        })
      } catch (err) {
        req.log.warn({ err }, 'CV-Parc cost floor unavailable; quoting with the commercial split only')
      }

      // booking_type is optional and only classifies the result (advisory vs
      // binding) — it does not touch the maths. Omitted → binding, so every
      // caller that predates it is byte-identical. See lib/pricing.ts.
      const result = computeQuote({
        distance_km,
        vehicle_type: body.data.vehicle_type,
        load_type:    body.data.load_type,
        weight_kg:    body.data.weight_kg,
        booking_type: body.data.booking_type,
      }, costFloor)
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
        breakdown_json: { ...result, distance_basis },
        quoted_price:   result.shipper_pays,
        currency:       'INR',
        expires_at:     expiresAt,
      })

      return reply.send({
        success: true,
        data: {
          ...result,
          distance_basis,
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
