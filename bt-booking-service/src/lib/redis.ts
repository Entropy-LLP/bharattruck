import { Redis } from 'ioredis'

const url = process.env.REDIS_URL
if (!url) throw new Error('REDIS_URL must be set')

export const redis = new Redis(url, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
})

export const LOCATION_TTL_SECONDS = 30

export const driverLocationKey  = (driverId: string)  => `loc:driver:${driverId}`
export const driverBookingKey   = (driverId: string)  => `loc:driver-booking:${driverId}`
export const bookingDriverKey   = (bookingId: string) => `loc:booking-driver:${bookingId}`
