/**
 * The rules, isolated from I/O so they are testable without a database and readable in one screen.
 *
 * `ship` is unconditional at MVP by founder decision D-5: KYC does not gate use, and posting a
 * load is itself the act that emerges the shipper persona. When KYC gating returns, this is the
 * one line that changes.
 */
export function capabilitiesFrom(facts) {
    const caps = ['ship'];
    if (facts.driver_id)
        caps.push('drive');
    // Ownership, not affiliation, is what grants marketplace access. An owner-driver attached to a
    // fleet KEEPS it: affiliation ADDS a source of work, it does not replace self-selection.
    // An assetless fleet driver has no 'carry' and correctly never sees a load board.
    if (facts.owned_vehicle_count >= 1)
        caps.push('carry');
    // Two ways to be running a fleet, and they are genuinely different businesses:
    //   - 2+ trucks: you are managing assets even with nobody hired yet
    //   - 1+ driver: you are managing people even if the truck is theirs (the attached-vehicle model)
    if (facts.owned_vehicle_count >= 2 || facts.held_driver_count >= 1)
        caps.push('operate');
    return caps;
}
/**
 * Resolve everything about a human in one pass.
 *
 * Six small indexed lookups rather than one join: they are individually cacheable, each maps to
 * exactly one fact in the model above, and a join would have to be re-derived every time the
 * ownership rules move. This sits behind /auth/me and is not on a per-request hot path.
 */
export async function resolvePersonas(supabase, userId, primaryPersona) {
    const [driverRes, fleetRes] = await Promise.all([
        supabase.from('drivers').select('id').eq('user_id', userId).maybeSingle(),
        supabase.from('fleet_owners').select('id').eq('user_id', userId).maybeSingle(),
    ]);
    if (driverRes.error)
        throw new Error(`drivers lookup failed: ${driverRes.error.message}`);
    if (fleetRes.error)
        throw new Error(`fleet_owners lookup failed: ${fleetRes.error.message}`);
    const driverId = driverRes.data?.id ?? null;
    const fleetOwnerId = fleetRes.data?.id ?? null;
    // Vehicles owned as a driver and as a fleet are counted together: migration 0022 guarantees a
    // truck has exactly one owner, so these sets cannot overlap and a sum cannot double-count.
    const [ownedAsDriver, ownedAsFleet, heldDrivers, affiliations] = await Promise.all([
        driverId
            ? supabase.from('vehicles').select('id', { count: 'exact', head: true }).eq('driver_id', driverId)
            : Promise.resolve({ count: 0, error: null }),
        fleetOwnerId
            ? supabase.from('vehicles').select('id', { count: 'exact', head: true }).eq('fleet_owner_id', fleetOwnerId)
            : Promise.resolve({ count: 0, error: null }),
        fleetOwnerId
            ? supabase
                .from('fleet_drivers')
                .select('id', { count: 'exact', head: true })
                .eq('fleet_owner_id', fleetOwnerId)
                .in('status', ['pending', 'active'])
            : Promise.resolve({ count: 0, error: null }),
        // Fleets this human DRIVES FOR. 'pending' counts: the seat is taken and the invite is live.
        driverId
            ? supabase
                .from('fleet_drivers')
                .select('fleet_owner_id')
                .eq('driver_id', driverId)
                .in('status', ['pending', 'active'])
            : Promise.resolve({ data: [], error: null }),
    ]);
    for (const [label, res] of [
        ['vehicles(driver)', ownedAsDriver],
        ['vehicles(fleet)', ownedAsFleet],
        ['fleet_drivers(held)', heldDrivers],
        ['fleet_drivers(affiliations)', affiliations],
    ]) {
        if (res.error)
            throw new Error(`${label} lookup failed: ${res.error.message}`);
    }
    const facts = {
        driver_id: driverId,
        fleet_owner_id: fleetOwnerId,
        owned_vehicle_count: (ownedAsDriver.count ?? 0) + (ownedAsFleet.count ?? 0),
        held_driver_count: heldDrivers.count ?? 0,
        affiliated_fleet_owner_ids: (affiliations.data ?? [])
            .map((r) => r.fleet_owner_id),
    };
    const capabilities = capabilitiesFrom(facts);
    return {
        user_id: userId,
        primary_persona: primaryPersona,
        capabilities,
        ...facts,
        // Owning an asset or running a fleet makes you a stakeholder in trip economics.
        sees_commercials: capabilities.includes('carry') || capabilities.includes('operate'),
    };
}
/** Convenience predicate so callers read as intent, not as array plumbing. */
export function can(snapshot, capability) {
    return snapshot.capabilities.includes(capability);
}
/**
 * Resolve the viewer's relation to a booking.
 *
 * Order is significant and is not alphabetical:
 *   shipper first  — you posted it, and under direct-attach (D-10) you may ALSO be the carrier.
 *                    Whoever is paying sees the paying side; that is the relation with the
 *                    stronger claim on the screen.
 *   carrier next   — the winning party, fleet or solo.
 *   driver last    — assigned to run it, which on a fleet booking is an employee relation.
 */
export function relationToBooking(booking, snapshot) {
    if (booking.shipper_id === snapshot.user_id)
        return 'shipper';
    if (booking.fleet_owner_id && booking.fleet_owner_id === snapshot.fleet_owner_id)
        return 'carrier';
    if (booking.driver_id && booking.driver_id === snapshot.driver_id) {
        // A solo driver IS the carrier — they bid, they won, they carry the economics. A driver on a
        // fleet-owned booking is staff, and `stripCommercialFields` will mask the money for them
        // unless they own the truck (see seesCommercialsOnBooking).
        return booking.fleet_owner_id ? 'driver' : 'carrier';
    }
    return 'observer';
}
/**
 * Whether this viewer may see freight/price on THIS booking.
 *
 * The asset-ownership rule, applied per booking. An assetless fleet driver is staff and stays
 * masked — that behaviour is unchanged. What changes is the owner-driver: a driver running their
 * OWN truck under a fleet's booking carries that truck's cost and risk, so they are a stakeholder
 * and the money stops being hidden from them.
 *
 * `viewerOwnsBookingVehicle` is passed in rather than looked up: the caller already has the
 * booking's vehicle in hand, and a lookup here would put a query on every row of a list response.
 */
export function seesCommercialsOnBooking(booking, snapshot, viewerOwnsBookingVehicle) {
    const relation = relationToBooking(booking, snapshot);
    if (relation === 'shipper' || relation === 'carrier')
        return true;
    if (relation === 'driver')
        return viewerOwnsBookingVehicle;
    return false;
}
