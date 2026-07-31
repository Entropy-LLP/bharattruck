import { getSupabase } from './supabase.js'
import {
  asRow,
  asRowOrNull,
  asRows,
  FleetError,
  UNIQUE_VIOLATION,
  type FleetDriverRow,
  type FleetDriverStatus,
  type FleetOwnerRow,
} from './types.js'
import type { AuthenticatedUser } from '../plugins/auth.js'

// -----------------------------------------------------------
// fleet-repo — tenancy resolution and the fleet_owners / fleet_drivers tables.
//
// TENANCY IS THE TOP RISK OF THIS SLICE. Every owner-scoped route resolves its
// fleet_owner_id here, from the JWT's users.id, and scopes every subsequent query
// by it. A fleet_owner_id arriving in a request body is NEVER trusted — there is
// deliberately no code path that reads one.
// -----------------------------------------------------------

const OWNER_COLUMNS =
  'id, user_id, company_name, gstin, pan, contact_phone, billing_address, city, state, ' +
  'monthly_overhead_inr, is_active, created_at, updated_at'

// requireFleetOwner — THE tenancy gate. Call this first on every owner-scoped
// route; the returned row's `id` is the only fleet_owner_id the request may touch.
export async function requireFleetOwner(user: AuthenticatedUser): Promise<FleetOwnerRow> {
  if (user.role !== 'fleet_owner') {
    throw new FleetError('Only fleet owners can access this resource', 'FORBIDDEN', 403)
  }
  const owner = await getFleetOwnerByUserId(user.userId)
  if (!owner) {
    throw new FleetError('Fleet profile not found — register one at POST /fleet/owners', 'NOT_FOUND', 404)
  }
  if (!owner.is_active) {
    throw new FleetError('This fleet account is deactivated', 'FORBIDDEN', 403)
  }
  return owner
}

// requireDriver — the mirror gate for the two driver-side invite routes. A
// fleet_owner token can never satisfy it (owners hold no drivers row at all), so
// the invite inbox is not reachable from the owner persona.
export async function requireDriver(user: AuthenticatedUser): Promise<{ id: string }> {
  if (user.role !== 'driver') {
    throw new FleetError('Only drivers can access this resource', 'FORBIDDEN', 403)
  }
  const { data, error } = await getSupabase()
    .from('drivers')
    .select('id')
    .eq('user_id', user.userId)
    .maybeSingle()
  if (error) throw new Error(`Driver lookup failed: ${error.message}`)
  if (!data) throw new FleetError('Driver profile not found', 'NOT_FOUND', 404)
  return data as { id: string }
}

export async function getFleetOwnerByUserId(userId: string): Promise<FleetOwnerRow | null> {
  const { data, error } = await getSupabase()
    .from('fleet_owners')
    .select(OWNER_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(`fleet_owners select failed: ${error.message}`)
  return asRowOrNull<FleetOwnerRow>(data)
}

export type CreateFleetOwnerInput = {
  user_id: string
  company_name: string
  gstin?: string | null
  pan?: string | null
  contact_phone?: string | null
  billing_address?: string | null
  city?: string | null
  state?: string | null
  monthly_overhead_inr?: number
}

export async function createFleetOwner(input: CreateFleetOwnerInput): Promise<FleetOwnerRow> {
  const { data, error } = await getSupabase()
    .from('fleet_owners')
    .insert(input)
    .select(OWNER_COLUMNS)
    .single()
  if (error) {
    // fleet_owners.user_id is UNIQUE — a second registration is a conflict, not a 500.
    if (error.code === UNIQUE_VIOLATION) {
      throw new FleetError('A fleet profile already exists for this account', 'CONFLICT', 409)
    }
    throw new Error(`fleet_owners insert failed: ${error.message}`)
  }
  return asRow<FleetOwnerRow>(data)
}

export async function updateFleetOwner(
  fleetOwnerId: string,
  patch: Partial<Omit<CreateFleetOwnerInput, 'user_id'>>,
): Promise<FleetOwnerRow> {
  const { data, error } = await getSupabase()
    .from('fleet_owners')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', fleetOwnerId)
    .select(OWNER_COLUMNS)
    .single()
  if (error) throw new Error(`fleet_owners update failed: ${error.message}`)
  return asRow<FleetOwnerRow>(data)
}

// -----------------------------------------------------------
// fleet_drivers — affiliation lifecycle
// -----------------------------------------------------------

const AFFILIATION_COLUMNS =
  'id, fleet_owner_id, driver_id, status, monthly_salary_inr, invited_by, ' +
  'invited_at, responded_at, left_at, created_at, updated_at'

export type DriverIdentity = {
  driver_id: string
  user_id: string
  full_name: string | null
  phone_number: string | null
  kyc_status: string | null
  average_rating: number | null
  total_trips: number | null
}

// findDriverByPhone — invites name an EXISTING driver account (locked model: we
// never create driver identities on the owner's behalf), so this resolves
// phone -> users.id -> drivers.id and refuses anything that is not a driver.
export async function findDriverByPhone(phone: string): Promise<DriverIdentity> {
  const supabase = getSupabase()
  const { data: user, error: userErr } = await supabase
    .from('users')
    .select('id, full_name, phone_number, role, kyc_status')
    .eq('phone_number', phone)
    .maybeSingle()
  if (userErr) throw new Error(`users select failed: ${userErr.message}`)
  if (!user) {
    throw new FleetError(
      'No BharatTruck account exists for that phone number — the driver must sign up first',
      'NOT_FOUND',
      404,
    )
  }
  if ((user as { role: string }).role !== 'driver') {
    throw new FleetError('That account is not a driver account', 'VALIDATION_ERROR', 400)
  }

  const { data: driver, error: driverErr } = await supabase
    .from('drivers')
    .select('id, average_rating, total_trips')
    .eq('user_id', (user as { id: string }).id)
    .maybeSingle()
  if (driverErr) throw new Error(`drivers select failed: ${driverErr.message}`)
  if (!driver) throw new FleetError('That driver has not completed driver onboarding yet', 'NOT_FOUND', 404)

  const u = user as { id: string; full_name: string | null; phone_number: string | null; kyc_status: string | null }
  const d = driver as { id: string; average_rating: number | null; total_trips: number | null }
  return {
    driver_id: d.id,
    user_id: u.id,
    full_name: u.full_name,
    phone_number: u.phone_number,
    kyc_status: u.kyc_status,
    average_rating: d.average_rating,
    total_trips: d.total_trips,
  }
}

// hydrateDriverIdentities — batch drivers.id -> name/phone/KYC in two bounded
// queries. Explicit joins rather than PostgREST embedding so the roster does not
// depend on FK-name inference.
export async function hydrateDriverIdentities(driverIds: string[]): Promise<Map<string, DriverIdentity>> {
  const out = new Map<string, DriverIdentity>()
  if (driverIds.length === 0) return out

  const supabase = getSupabase()
  const { data: drivers, error: driverErr } = await supabase
    .from('drivers')
    .select('id, user_id, average_rating, total_trips')
    .in('id', driverIds)
  if (driverErr) throw new Error(`drivers select failed: ${driverErr.message}`)

  const driverRows = (drivers ?? []) as {
    id: string; user_id: string; average_rating: number | null; total_trips: number | null
  }[]
  if (driverRows.length === 0) return out

  const { data: users, error: userErr } = await supabase
    .from('users')
    .select('id, full_name, phone_number, kyc_status')
    .in('id', driverRows.map(d => d.user_id))
  if (userErr) throw new Error(`users select failed: ${userErr.message}`)

  const userById = new Map(
    ((users ?? []) as { id: string; full_name: string | null; phone_number: string | null; kyc_status: string | null }[])
      .map(u => [u.id, u]),
  )
  for (const d of driverRows) {
    const u = userById.get(d.user_id)
    out.set(d.id, {
      driver_id: d.id,
      user_id: d.user_id,
      full_name: u?.full_name ?? null,
      phone_number: u?.phone_number ?? null,
      kyc_status: u?.kyc_status ?? null,
      average_rating: d.average_rating,
      total_trips: d.total_trips,
    })
  }
  return out
}

export async function inviteDriver(
  fleetOwnerId: string,
  driverId: string,
  invitedBy: string,
): Promise<FleetDriverRow> {
  const { data, error } = await getSupabase()
    .from('fleet_drivers')
    .insert({ fleet_owner_id: fleetOwnerId, driver_id: driverId, invited_by: invitedBy, status: 'pending' })
    .select(AFFILIATION_COLUMNS)
    .single()
  if (error) {
    // fleet_drivers_one_live_per_driver: the driver already has a pending or active
    // affiliation (possibly with a DIFFERENT fleet — which we must not disclose).
    if (error.code === UNIQUE_VIOLATION) {
      throw new FleetError(
        'That driver already has a pending or active fleet affiliation',
        'CONFLICT',
        409,
      )
    }
    throw new Error(`fleet_drivers insert failed: ${error.message}`)
  }
  return asRow<FleetDriverRow>(data)
}

export async function listFleetDrivers(
  fleetOwnerId: string,
  statuses?: FleetDriverStatus[],
): Promise<FleetDriverRow[]> {
  let query = getSupabase()
    .from('fleet_drivers')
    .select(AFFILIATION_COLUMNS)
    .eq('fleet_owner_id', fleetOwnerId)
  if (statuses?.length) query = query.in('status', statuses)

  const { data, error } = await query.order('invited_at', { ascending: false })
  if (error) throw new Error(`fleet_drivers select failed: ${error.message}`)
  return asRows<FleetDriverRow>(data)
}

// getFleetDriverById — always scoped by fleet_owner_id so one fleet can never
// address another fleet's affiliation row by guessing its uuid.
export async function getFleetDriverById(
  fleetOwnerId: string,
  affiliationId: string,
): Promise<FleetDriverRow | null> {
  const { data, error } = await getSupabase()
    .from('fleet_drivers')
    .select(AFFILIATION_COLUMNS)
    .eq('id', affiliationId)
    .eq('fleet_owner_id', fleetOwnerId)
    .maybeSingle()
  if (error) throw new Error(`fleet_drivers select failed: ${error.message}`)
  return asRowOrNull<FleetDriverRow>(data)
}

// getActiveAffiliation — the assignment guard: is this driver actually employed by
// THIS fleet right now?
export async function getActiveAffiliation(
  fleetOwnerId: string,
  driverId: string,
): Promise<FleetDriverRow | null> {
  const { data, error } = await getSupabase()
    .from('fleet_drivers')
    .select(AFFILIATION_COLUMNS)
    .eq('fleet_owner_id', fleetOwnerId)
    .eq('driver_id', driverId)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw new Error(`fleet_drivers select failed: ${error.message}`)
  return asRowOrNull<FleetDriverRow>(data)
}

// getLatestAffiliation — the salary source for the wage allocation. Deliberately
// NOT filtered to 'active': a driver who has since left still earned a salary
// during the months whose economics we are rolling up.
export async function getLatestAffiliation(
  fleetOwnerId: string,
  driverId: string,
): Promise<FleetDriverRow | null> {
  const { data, error } = await getSupabase()
    .from('fleet_drivers')
    .select(AFFILIATION_COLUMNS)
    .eq('fleet_owner_id', fleetOwnerId)
    .eq('driver_id', driverId)
    .order('invited_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`fleet_drivers select failed: ${error.message}`)
  return asRowOrNull<FleetDriverRow>(data)
}

export async function updateFleetDriver(
  affiliationId: string,
  patch: Partial<Pick<FleetDriverRow, 'status' | 'monthly_salary_inr' | 'responded_at' | 'left_at'>>,
): Promise<FleetDriverRow> {
  const { data, error } = await getSupabase()
    .from('fleet_drivers')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', affiliationId)
    .select(AFFILIATION_COLUMNS)
    .single()
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new FleetError(
        'That driver already has a pending or active affiliation elsewhere',
        'CONFLICT',
        409,
      )
    }
    throw new Error(`fleet_drivers update failed: ${error.message}`)
  }
  return asRow<FleetDriverRow>(data)
}

// listPendingInvitesForDriver — driver-side inbox, joined to the inviting fleet's
// company name (a driver must know WHO is asking before accepting).
export async function listPendingInvitesForDriver(
  driverId: string,
): Promise<(FleetDriverRow & { company_name: string | null; fleet_city: string | null })[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('fleet_drivers')
    .select(AFFILIATION_COLUMNS)
    .eq('driver_id', driverId)
    .eq('status', 'pending')
    .order('invited_at', { ascending: false })
  if (error) throw new Error(`fleet_drivers select failed: ${error.message}`)

  const invites = asRows<FleetDriverRow>(data)
  if (invites.length === 0) return []

  const { data: owners, error: ownerErr } = await supabase
    .from('fleet_owners')
    .select('id, company_name, city')
    .in('id', invites.map(i => i.fleet_owner_id))
  if (ownerErr) throw new Error(`fleet_owners select failed: ${ownerErr.message}`)

  const ownerById = new Map(
    ((owners ?? []) as { id: string; company_name: string; city: string | null }[]).map(o => [o.id, o]),
  )
  return invites.map(i => ({
    ...i,
    company_name: ownerById.get(i.fleet_owner_id)?.company_name ?? null,
    fleet_city: ownerById.get(i.fleet_owner_id)?.city ?? null,
  }))
}

// getAffiliationForDriver — the driver-side "who do I drive for?" lookup.
//
// This is the signal the driver app needs to know WHICH product it is: an
// affiliated driver has no load board and never bids (founder Q14), so the app
// must render assigned trips rather than a marketplace. Without it the client
// cannot tell the two apart — `/invites/mine` only ever returns 'pending' rows,
// so the moment a driver accepts, the affiliation becomes invisible to them.
//
// Keyed on status='active' to match isFleetAffiliatedDriver() in
// bt-booking-service/src/lib/fleet.ts — the two MUST agree, or the client would
// render one product while the API enforces the other.
export async function getAffiliationForDriver(
  driverId: string,
): Promise<(FleetDriverRow & { company_name: string | null; fleet_city: string | null }) | null> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('fleet_drivers')
    .select(AFFILIATION_COLUMNS)
    .eq('driver_id', driverId)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw new Error(`fleet_drivers select failed: ${error.message}`)

  const affiliation = asRowOrNull<FleetDriverRow>(data)
  if (!affiliation) return null

  const { data: owner, error: ownerErr } = await supabase
    .from('fleet_owners')
    .select('company_name, city')
    .eq('id', affiliation.fleet_owner_id)
    .maybeSingle()
  if (ownerErr) throw new Error(`fleet_owners select failed: ${ownerErr.message}`)

  const ownerRow = owner as { company_name: string; city: string | null } | null
  return {
    ...affiliation,
    company_name: ownerRow?.company_name ?? null,
    fleet_city: ownerRow?.city ?? null,
  }
}

// getInviteForDriver — scoped by driver_id: a driver may only respond to an
// invitation addressed to them.
export async function getInviteForDriver(
  driverId: string,
  affiliationId: string,
): Promise<FleetDriverRow | null> {
  const { data, error } = await getSupabase()
    .from('fleet_drivers')
    .select(AFFILIATION_COLUMNS)
    .eq('id', affiliationId)
    .eq('driver_id', driverId)
    .maybeSingle()
  if (error) throw new Error(`fleet_drivers select failed: ${error.message}`)
  return asRowOrNull<FleetDriverRow>(data)
}

// getActiveDriverIds — authoritative membership from Postgres. GET /fleet/live
// serves from the Redis set and falls back to this on a cold/evicted key, so the
// live map is self-healing rather than silently empty after a Redis restart.
export async function getActiveDriverIds(fleetOwnerId: string): Promise<string[]> {
  const rows = await listFleetDrivers(fleetOwnerId, ['active'])
  return rows.map(r => r.driver_id)
}
