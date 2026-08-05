/**
 * Emergent personas — THE single implementation of "what may this human do?".
 *
 * WHY THIS REPLACES `role`: `users.role` is one enum value per human, and every service
 * authorizes on it. That cannot describe the businesses we actually have. A distributor ships
 * goods AND owns the trucks that move them. A driver who buys a second truck is running a fleet.
 * A driver whose own truck is attached to a fleet is that fleet's employee on some trips and an
 * independent operator on others. One role per human puts each of them in a costume that is wrong
 * most of the time.
 *
 * THE MODEL: a persona is not a flag, it is a VIEW over what you own and who you are connected to.
 *
 *     what you OWN   (trucks)            -> carrier capability
 *     who you HOLD   (drivers / fleets)  -> fleet capability
 *     what you DO    (post a load)       -> shipper capability
 *
 * Nothing is stored. Nobody "becomes" a fleet owner — they buy a second truck and the fleet
 * surfaces become relevant. Computing rather than storing is what makes that true: a stored flag
 * would need a migration, a backfill and a settings screen, and would go stale the moment someone
 * sold a truck.
 *
 * IDENTITY CONTRACT (see ./auth.ts — violating it silently authorizes the wrong party):
 *   • JWT `userId` is `public.users.id`.
 *   • `drivers.user_id` -> users.id;  `drivers.id` is a DIFFERENT row.
 *   • `fleet_owners.user_id` -> users.id;  `fleet_owners.id` is the fleet tenant key.
 *   • `vehicles.driver_id` -> drivers.id;  `vehicles.fleet_owner_id` -> fleet_owners.id.
 *
 * Schema source: supabase/migrations/0022_unified_identity.sql.
 * Locked model: docs/ARCHITECTURE_UNIFIED_IDENTITY.md.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserRole } from './auth.js';
/**
 * What a human may do. Deliberately verbs, not job titles: "fleet_owner" is a costume,
 * "may operate a fleet" is a fact about their assets.
 */
export type Capability = 
/** May post loads. Ungated — posting IS the act that emerges the shipper persona. */
'ship'
/** May be assigned trips. Has a `drivers` row. */
 | 'drive'
/** May bid and self-select work from the marketplace. Owns at least one truck. */
 | 'carry'
/** Fleet surfaces: assignment, P&L, driver management. Owns 2+ trucks OR holds a driver. */
 | 'operate';
export interface PersonaSnapshot {
    /** users.id */
    user_id: string;
    /**
     * Default surface, and the destination for emailed links. A multi-persona human still needs
     * ONE correct address for a password-reset mail — "all three personas" is not a destination.
     * This is `users.role` under an honest name, NOT an authorization axis.
     */
    primary_persona: UserRole;
    capabilities: Capability[];
    /** drivers.id, or null when this human has no driver profile. */
    driver_id: string | null;
    /** fleet_owners.id, or null when this human owns no fleet. */
    fleet_owner_id: string | null;
    /** Trucks owned outright by this human, as a driver or as a fleet. */
    owned_vehicle_count: number;
    /** Drivers held under this human's fleet with a live seat ('pending' | 'active'). */
    held_driver_count: number;
    /** Fleets this human DRIVES FOR (they are the employee). Multi-fleet is allowed. */
    affiliated_fleet_owner_ids: string[];
    /**
     * Whether this human is a stakeholder in trip economics anywhere.
     *
     * THE RULE (docs/ARCHITECTURE_UNIFIED_IDENTITY.md §1.1): commercial visibility follows ASSET
     * OWNERSHIP, not affiliation. Own a truck -> you carry its cost and risk -> you see the money.
     * Own nothing and drive for a fleet -> you are an employee -> you do not.
     *
     * This is a *baseline* for UI affordances. Per-booking masking is still decided per booking
     * (you do not see a stranger's freight just because you own a truck) — see
     * seesCommercialsOnBooking().
     */
    sees_commercials: boolean;
}
/** Ownership + relationship facts, before they are turned into capabilities. Exported for tests. */
export interface PersonaFacts {
    driver_id: string | null;
    fleet_owner_id: string | null;
    owned_vehicle_count: number;
    held_driver_count: number;
    affiliated_fleet_owner_ids: string[];
}
/**
 * The rules, isolated from I/O so they are testable without a database and readable in one screen.
 *
 * `ship` is unconditional at MVP by founder decision D-5: KYC does not gate use, and posting a
 * load is itself the act that emerges the shipper persona. When KYC gating returns, this is the
 * one line that changes.
 */
export declare function capabilitiesFrom(facts: PersonaFacts): Capability[];
/**
 * Resolve everything about a human in one pass.
 *
 * Six small indexed lookups rather than one join: they are individually cacheable, each maps to
 * exactly one fact in the model above, and a join would have to be re-derived every time the
 * ownership rules move. This sits behind /auth/me and is not on a per-request hot path.
 */
export declare function resolvePersonas(supabase: SupabaseClient, userId: string, primaryPersona: UserRole): Promise<PersonaSnapshot>;
/** Convenience predicate so callers read as intent, not as array plumbing. */
export declare function can(snapshot: PersonaSnapshot, capability: Capability): boolean;
/**
 * How a viewer relates to ONE booking. This is what makes "one app, no mode switch" work: the
 * object supplies the context, so the same screen renders the shipper view to the person who
 * posted the load and the carrier view to the person who won it.
 */
export type BookingRelation = 'shipper' | 'carrier' | 'driver' | 'observer';
export interface ViewerBooking {
    shipper_id: string;
    fleet_owner_id?: string | null;
    driver_id?: string | null;
    vehicle_id?: string | null;
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
export declare function relationToBooking(booking: ViewerBooking, snapshot: PersonaSnapshot): BookingRelation;
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
export declare function seesCommercialsOnBooking(booking: ViewerBooking, snapshot: PersonaSnapshot, viewerOwnsBookingVehicle: boolean): boolean;
