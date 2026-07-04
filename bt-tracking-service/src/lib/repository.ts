import { supabase } from './supabase.js'
import type { TrackingBooking } from './types.js'
import type { ComputedRoute } from './google.js'

// ── bookings (owned by bt-booking-service — read only) ───────────────────────
export async function getBookingForTracking(id: string): Promise<TrackingBooking | null> {
  const { data, error } = await supabase
    .from('bookings')
    .select('id, shipper_id, driver_id, status, source_lat, source_lng, dest_lat, dest_lng')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`DB select failed: ${error.message}`)
  return data as TrackingBooking | null
}

// JWT carries users.id; authz for drivers needs drivers.id.
export async function getDriverByUserId(userId: string): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('drivers')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(`Driver lookup failed: ${error.message}`)
  return data
}

// ── trip_routes (owned here) — durable backup of the cached route ────────────
// Best-effort: a DB hiccup must not fail a route response (Redis is the hot path).
export async function upsertTripRoute(bookingId: string, route: ComputedRoute): Promise<void> {
  const { error } = await supabase.from('trip_routes').upsert(
    {
      booking_id: bookingId,
      polyline: route.polyline,
      distance_m: route.distance_m,
      static_duration_s: route.static_duration_s,
      ne_lat: route.bounds.ne_lat,
      ne_lng: route.bounds.ne_lng,
      sw_lat: route.bounds.sw_lat,
      sw_lng: route.bounds.sw_lng,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'booking_id' },
  )
  if (error) throw new Error(`trip_routes upsert failed: ${error.message}`)
}

// ── route_alerts (owned here) — Phase 5 raises them; read-through lists them ──
export type AlertRow = {
  id: string
  type: string
  message: string | null
  lat: number | null
  lng: number | null
  acknowledged: boolean
  created_at: string
}

export async function getAlerts(bookingId: string): Promise<AlertRow[]> {
  const { data, error } = await supabase
    .from('route_alerts')
    .select('id, type, message, lat, lng, acknowledged, created_at')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) return []
  return (data ?? []) as AlertRow[]
}
