import { getSupabase } from './supabase.js'

// -----------------------------------------------------------
// price-quote-store — persistence for the `price_quotes` table (migration 013).
// The DB is the single source of truth for the price-lock: the price SHOWN at
// quote time is the price CHARGED at booking (PRD 5.4). There is NO in-memory
// quote store. Written by bt-pricing-service (service-role); consumed once by
// bt-booking-service via the internal endpoints.
//
// NOTE: `price_quotes` is the SHIPPER price-lock. It is NOT the `quotes`
// driver-auction bid table — do not confuse the two.
// -----------------------------------------------------------

export type PriceQuoteRow = {
  id: string
  shipper_id: string
  distance_km: number
  vehicle_type: string
  vehicle_class: string
  load_type: string
  weight_kg: number
  breakdown_json: unknown
  quoted_price: number
  currency: string
  expires_at: string
  consumed_by_booking_id: string | null
  created_at: string
}

export type InsertPriceQuoteInput = {
  shipper_id: string
  distance_km: number
  vehicle_type: string
  vehicle_class: string
  load_type: string
  weight_kg: number
  breakdown_json: unknown
  quoted_price: number
  currency: string
  expires_at: string
}

// insertPriceQuote — persist one locked quote row and return it.
export async function insertPriceQuote(input: InsertPriceQuoteInput): Promise<PriceQuoteRow> {
  const { data, error } = await getSupabase()
    .from('price_quotes')
    .insert({
      shipper_id:     input.shipper_id,
      distance_km:    input.distance_km,
      vehicle_type:   input.vehicle_type,
      vehicle_class:  input.vehicle_class,
      load_type:      input.load_type,
      weight_kg:      input.weight_kg,
      breakdown_json: input.breakdown_json,
      quoted_price:   input.quoted_price,
      currency:       input.currency,
      expires_at:     input.expires_at,
    })
    .select('*')
    .single()

  if (error) throw new Error(`price_quotes insert failed: ${error.message}`)
  return data as PriceQuoteRow
}

// getPriceQuoteById — read one locked quote (null if it does not exist).
export async function getPriceQuoteById(id: string): Promise<PriceQuoteRow | null> {
  const { data, error } = await getSupabase()
    .from('price_quotes')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`price_quotes select failed: ${error.message}`)
  return (data as PriceQuoteRow | null) ?? null
}

// consumePriceQuote — atomic conditional update that stamps consumed_by_booking_id
// only when the quote is still unconsumed AND unexpired. This single UPDATE is the
// replay + expiry guard enforced in the DB: two concurrent bookings racing on one
// quote_id, only one WHERE consumed_by_booking_id IS NULL match wins; the other gets
// null. Returns the row on success, null if already consumed or expired.
export async function consumePriceQuote(id: string, bookingId: string): Promise<PriceQuoteRow | null> {
  const { data, error } = await getSupabase()
    .from('price_quotes')
    .update({ consumed_by_booking_id: bookingId })
    .eq('id', id)
    .is('consumed_by_booking_id', null)
    .gt('expires_at', new Date().toISOString())
    .select('*')
    .maybeSingle()

  if (error) throw new Error(`price_quotes consume failed: ${error.message}`)
  return (data as PriceQuoteRow | null) ?? null
}
