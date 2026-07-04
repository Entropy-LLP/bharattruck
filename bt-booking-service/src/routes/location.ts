import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  redis,
  driverLocationKey,
  driverBookingKey,
  bookingDriverKey,
  LOCATION_TTL_SECONDS,
} from '../lib/redis.js'
import { BookingError } from '../lib/types.js'
import * as repo from '../lib/repository.js'

const UpdateLocationBody = z.object({
  lat:        z.number().min(-90).max(90),
  lng:        z.number().min(-180).max(180),
  heading:    z.number().min(0).max(360).optional(),
  speed_kmh:  z.number().min(0).optional(),
  accuracy_m: z.number().min(0).optional(),
  booking_id: z.string().uuid().optional(),
})

const DriverIdParam  = z.object({ driver_id:  z.string().uuid() })
const BookingIdParam = z.object({ booking_id: z.string().uuid() })

type LocationData = {
  driver_id:  string
  lat:        number
  lng:        number
  heading:    number | null
  speed_kmh:  number | null
  accuracy_m: number | null
  booking_id: string | null
  updated_at: string
}

function handleError(reply: FastifyReply, err: unknown) {
  if (err instanceof BookingError) {
    return reply.status(err.httpStatus).send({ success: false, error: err.message, code: err.code })
  }
  return reply.status(500).send({ success: false, error: 'Internal server error' })
}

async function getLocation(driverId: string): Promise<LocationData | null> {
  const raw = await redis.get(driverLocationKey(driverId))
  return raw ? (JSON.parse(raw) as LocationData) : null
}

export async function locationRoutes(app: FastifyInstance) {

  // POST /location/update
  app.post('/update', async (req, reply) => {
    if (req.user.role !== 'driver') {
      throw new BookingError('Only drivers can update location', 'FORBIDDEN', 403)
    }

    const parsed = UpdateLocationBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: parsed.error.errors[0].message,
        code: 'VALIDATION_ERROR',
      })
    }

    const { lat, lng, heading, speed_kmh, accuracy_m, booking_id } = parsed.data

    const driverRow = await repo.getDriverByUserId(req.user.userId)
    if (!driverRow) throw new BookingError('Driver profile not found', 'NOT_FOUND', 404)

    const driverId = driverRow.id

    if (booking_id) {
      const booking = await repo.getBookingById(booking_id)
      if (!booking) throw new BookingError(`Booking ${booking_id} not found`, 'NOT_FOUND', 404)
      if (booking.driver_id !== driverId) throw new BookingError('You are not assigned to this booking', 'FORBIDDEN', 403)
      if (booking.status !== 'accepted' && booking.status !== 'in_transit') {
        throw new BookingError(
          `Booking is in '${booking.status}' status — location tracking only allowed for accepted or in_transit bookings`,
          'INVALID_TRANSITION',
          409,
        )
      }
    }

    const now = new Date().toISOString()
    const locationData: LocationData = {
      driver_id:  driverId,
      lat,
      lng,
      heading:    heading ?? null,
      speed_kmh:  speed_kmh ?? null,
      accuracy_m: accuracy_m ?? null,
      booking_id: booking_id ?? null,
      updated_at: now,
    }

    const pipeline = redis.pipeline()
    pipeline.set(driverLocationKey(driverId), JSON.stringify(locationData), 'EX', LOCATION_TTL_SECONDS)
    if (booking_id) {
      pipeline.set(driverBookingKey(driverId), booking_id, 'EX', LOCATION_TTL_SECONDS)
      pipeline.set(bookingDriverKey(booking_id), driverId, 'EX', LOCATION_TTL_SECONDS)
    }
    await pipeline.exec()

    app.log.info({ driver_id: driverId, lat, lng, booking_id }, 'Location updated')

    return reply.send({
      success: true,
      data: { driver_id: driverId, lat, lng, booking_id: booking_id ?? null, updated_at: now, ttl_seconds: LOCATION_TTL_SECONDS },
    })
  })

  // GET /location/driver/:driver_id
  app.get('/driver/:driver_id', async (req, reply) => {
    const paramParsed = DriverIdParam.safeParse(req.params)
    if (!paramParsed.success) {
      return reply.status(400).send({ success: false, error: paramParsed.error.errors[0].message, code: 'VALIDATION_ERROR' })
    }

    const { driver_id } = paramParsed.data

    if (req.user.role === 'driver') {
      const driverRow = await repo.getDriverByUserId(req.user.userId)
      if (!driverRow || driverRow.id !== driver_id) {
        throw new BookingError('You can only view your own location', 'FORBIDDEN', 403)
      }
    } else if (req.user.role === 'shipper') {
      const hasActiveBooking = await shipperHasActiveBookingWithDriver(req.user.userId, driver_id)
      if (!hasActiveBooking) {
        throw new BookingError('You can only view location for drivers assigned to your active bookings', 'FORBIDDEN', 403)
      }
    }

    const location = await getLocation(driver_id)
    return reply.send({
      success: true,
      data: location,
      ...(location ? {} : { message: 'No recent location available — driver may be offline' }),
    })
  })

  // GET /location/booking/:booking_id
  app.get('/booking/:booking_id', async (req, reply) => {
    const paramParsed = BookingIdParam.safeParse(req.params)
    if (!paramParsed.success) {
      return reply.status(400).send({ success: false, error: paramParsed.error.errors[0].message, code: 'VALIDATION_ERROR' })
    }

    const { booking_id } = paramParsed.data

    const booking = await repo.getBookingById(booking_id)
    if (!booking) throw new BookingError(`Booking ${booking_id} not found`, 'NOT_FOUND', 404)

    if (req.user.role === 'shipper' && booking.shipper_id !== req.user.userId) {
      throw new BookingError('Forbidden', 'FORBIDDEN', 403)
    }
    if (req.user.role === 'driver') {
      const driverRow = await repo.getDriverByUserId(req.user.userId)
      if (!driverRow || booking.driver_id !== driverRow.id) {
        throw new BookingError('Forbidden', 'FORBIDDEN', 403)
      }
    }

    if (!booking.driver_id) {
      return reply.send({ success: true, data: null, message: 'No driver assigned to this booking yet' })
    }

    if (booking.status !== 'accepted' && booking.status !== 'in_transit') {
      return reply.send({
        success: true,
        data: null,
        message: `Booking is in '${booking.status}' status — live tracking only available for accepted or in_transit bookings`,
      })
    }

    const location = await getLocation(booking.driver_id)
    return reply.send({
      success: true,
      data: location,
      ...(location ? {} : { message: 'Driver assigned but no recent location — driver may be offline' }),
    })
  })
}

async function shipperHasActiveBookingWithDriver(shipperId: string, driverId: string): Promise<boolean> {
  const { supabase } = await import('../lib/supabase.js')
  const { data, error } = await supabase
    .from('bookings')
    .select('id')
    .eq('shipper_id', shipperId)
    .eq('driver_id', driverId)
    .in('status', ['accepted', 'in_transit'])
    .limit(1)

  if (error) throw new Error(`DB query failed: ${error.message}`)
  return (data?.length ?? 0) > 0
}
