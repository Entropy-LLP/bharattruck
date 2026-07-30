import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { evaluateFix } from '../lib/evaluator.js'
import { TrackingError } from '../lib/types.js'

// -----------------------------------------------------------
// Internal routes (D-014) — shared-secret gated, never exposed by the gateway.
// -----------------------------------------------------------

const FixBody = z.object({
  booking_id: z.string().uuid(),
  driver_id: z.string().uuid().nullable().optional(),
  vehicle_id: z.string().uuid().nullable().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  speed_kmh: z.number().min(0).nullable().optional(),
  heading: z.number().min(0).max(360).nullable().optional(),
  recorded_at: z.string().datetime({ offset: true }),
})

export async function internalRoutes(app: FastifyInstance) {
  /**
   * POST /internal/evaluate — evaluate one already-ingested GPS fix.
   *
   * Called by bt-booking-service after it has written the Redis live position and the
   * breadcrumb. It is fired WITHOUT await on that side, so the response here is diagnostic
   * only; nothing upstream branches on it.
   *
   * Always answers 2xx once the body validates. An evaluation fault (a geometry edge case,
   * a DB blip) is reported in the payload rather than raised, because a non-2xx would put a
   * retry/error path into GPS ingestion for derived data that is safe to miss — the next
   * fix, ~12 s later, recomputes everything from the durable telemetry row anyway.
   */
  app.post('/evaluate', async (req, reply) => {
    const parsed = FixBody.safeParse(req.body)
    if (!parsed.success) {
      throw new TrackingError(parsed.error.errors[0].message, 'VALIDATION_ERROR', 400)
    }
    const body = parsed.data

    try {
      const result = await evaluateFix({
        booking_id: body.booking_id,
        driver_id: body.driver_id ?? null,
        vehicle_id: body.vehicle_id ?? null,
        lat: body.lat,
        lng: body.lng,
        speed_kmh: body.speed_kmh ?? null,
        heading: body.heading ?? null,
        recorded_at: body.recorded_at,
      })
      return reply.send({ success: true, data: result })
    } catch (err) {
      req.log.error({ err, booking_id: body.booking_id }, 'Fix evaluation failed (GPS ingestion unaffected)')
      return reply.send({
        success: true,
        data: { evaluated: false, error: (err as Error).message },
      })
    }
  })
}
