import { supabase } from './supabase.js'
import type {
  AuthenticatedUser,
  BookingStatus,
  BookingWithProfiles,
  CreateBookingBody,
  DbBooking,
} from './types.js'

// -----------------------------------------------------------
// createBooking
// Inserts a new pending booking. Shipper identity comes from
// the authenticated actor — never from the request body.
// -----------------------------------------------------------

export async function createBooking(
  body: CreateBookingBody,
  actor: AuthenticatedUser,
): Promise<DbBooking> {
  // Fetch shipper profile from DB — JWT only carries userId + role
  const { data: userRow } = await supabase
    .from('users')
    .select('full_name, phone_number, email')
    .eq('id', actor.userId)
    .single()

  const shipperName    = userRow?.full_name ?? userRow?.email ?? 'Unknown'
  const shipperContact = userRow?.phone_number ?? userRow?.email ?? ''

  const { data, error } = await supabase
    .from('bookings')
    .insert({
      shipper_id:           actor.userId,
      shipper_name:         shipperName,
      shipper_contact:      shipperContact,
      source_address:       body.source_address,
      source_lat:           body.source_lat,
      source_lng:           body.source_lng,
      destination_address:  body.destination_address,
      dest_lat:             body.dest_lat,
      dest_lng:             body.dest_lng,
      load_type:            body.load_type,
      weight_kg:            body.weight_kg,
      quoted_price:         body.quoted_price,
      pickup_date:          body.pickup_date,
      pickup_time_slot:     body.pickup_time_slot ?? null,
      special_instructions: body.special_instructions ?? null,
      booking_type:         body.booking_type ?? 'direct',
      target_driver_id:     body.target_driver_id ?? null,
      auction_deadline:     body.auction_deadline ?? null,
      dimensions_json:      body.dimensions_json ?? null,
      status:               'pending',
    })
    .select('*')
    .single()

  if (error) throw new Error(`DB insert failed: ${error.message}`)
  return data as DbBooking
}

// -----------------------------------------------------------
// getBookingById
// Returns the booking with nested driver + user profile.
// Uses .maybeSingle() so null is returned (not thrown) on miss.
// -----------------------------------------------------------

export async function getBookingById(id: string): Promise<BookingWithProfiles | null> {
  const { data, error } = await supabase
    .from('bookings')
    .select(`
      *,
      driver:drivers!bookings_driver_id_fkey (
        id,
        truck_number,
        truck_type,
        truck_capacity_kg,
        average_rating,
        total_trips,
        user:users!drivers_user_id_fkey (
          id,
          full_name,
          phone_number
        )
      )
    `)
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`DB select failed: ${error.message}`)
  return data as BookingWithProfiles | null
}

// -----------------------------------------------------------
// listBookings
// Role-scoped: shipper→own rows, driver→pending rows, admin→all.
// -----------------------------------------------------------

export async function listBookings(actor: AuthenticatedUser): Promise<DbBooking[]> {
  let query = supabase
    .from('bookings')
    .select('*')
    .order('created_at', { ascending: false })

  if (actor.role === 'shipper') {
    query = query.eq('shipper_id', actor.userId)
  } else if (actor.role === 'driver') {
    query = query.eq('status', 'pending')
  }
  // admin: no additional filter

  const { data, error } = await query
  if (error) throw new Error(`DB list failed: ${error.message}`)
  return (data ?? []) as DbBooking[]
}

// -----------------------------------------------------------
// acceptBooking
// Atomically sets driver_id + transitions to 'accepted'.
// The WHERE status='pending' guard is optimistic concurrency:
// only one driver wins when two race to accept the same booking.
// -----------------------------------------------------------

export async function acceptBooking(
  bookingId: string,
  driverId: string,
): Promise<DbBooking | null> {
  const { data, error } = await supabase
    .from('bookings')
    .update({
      driver_id:  driverId,
      status:     'accepted',
      updated_at: new Date().toISOString(),
    })
    .eq('id', bookingId)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle()

  if (error) throw new Error(`DB accept failed: ${error.message}`)
  return data as DbBooking | null
}

// -----------------------------------------------------------
// cancelBooking
// Cancels from any of the provided statuses (caller decides
// which statuses are valid — business rule stays in service).
// -----------------------------------------------------------

export async function cancelBooking(
  bookingId: string,
  cancellableStatuses: BookingStatus[],
): Promise<DbBooking | null> {
  const { data, error } = await supabase
    .from('bookings')
    .update({
      status:     'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('id', bookingId)
    .in('status', cancellableStatuses)
    .select('*')
    .maybeSingle()

  if (error) throw new Error(`DB cancel failed: ${error.message}`)
  return data as DbBooking | null
}

// -----------------------------------------------------------
// getDriverByUserId
// Bridge: JWT gives us users.id; accept/cancel need drivers.id.
// -----------------------------------------------------------

export async function getDriverByUserId(
  userId: string,
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('drivers')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw new Error(`Driver lookup failed: ${error.message}`)
  return data
}
