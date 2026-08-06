// ============================================================
// src/lib/pod/geo.ts
//
// Responsibility: the distance maths the POD geofence gate needs, and the tuned
// thresholds it compares against. Kept tiny and pure so the gate logic is
// testable without a database or a clock.
//
// NO PostGIS (frozen contract §3.1 D-007). lat/lng are plain decimals and this is
// the same haversine the tracking-service evaluator uses on every GPS fix; the two
// must agree on what "at the drop" means, so the formula lives in one obvious place.
// ============================================================

const EARTH_RADIUS_M = 6_371_000

const toRad = (deg: number): number => (deg * Math.PI) / 180

// Great-circle distance in metres between two lat/lng points. Haversine is exact
// enough at freight-drop scale (sub-metre error over a few km) and needs no
// projection — which is the whole reason the schema can stay PostGIS-free.
export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

// -----------------------------------------------------------
// DROP_RADIUS_M — how close counts as "at the delivery address".
//
// 750 m, sitting deliberately between two numbers already in the system: the
// tracking evaluator's 50 m geofence floor (too tight — a parked truck's GPS
// jitters ±40 m and would flap in and out) and the 2 km near_drop ALERT
// (INDIA_FREIGHT_COMPLIANCE §-derived contract), which is a "getting close" nudge,
// not a "you have arrived" gate. 750 m absorbs consumer-GPS error while still being
// far too tight for the "driver phones ahead from 40 km away" hole this gate closes.
// Tunable after the first real drive, exactly like the alert thresholds.
// -----------------------------------------------------------
export const DROP_RADIUS_M = 750

// -----------------------------------------------------------
// NEAR_DROP_M — the corroboration band for the OTP gate.
//
// A live GPS fix between DROP_RADIUS_M and this value is treated as "at the dock,
// GPS drifting" ONLY when a 'drop' geofence-enter event already corroborates arrival
// (urban canyon / warehouse-roof multipath routinely pushes a parked truck a few
// hundred metres off). Beyond this, a live fix is taken at face value and the gate
// blocks — which is what shuts the "driver phones ahead from 40 km away" hole. 2 km
// matches the near_drop alert threshold in the frozen tracking contract, so the gate
// and the alert agree on what "nearly there" means.
// -----------------------------------------------------------
export const NEAR_DROP_M = 2000

// Result of comparing a fix against the drop. Kept as a coarse verdict because the
// evidence table stores exactly these three strings (pod_evidence.geofence_result).
export type GeofenceVerdict = 'inside' | 'outside' | 'unknown'

export function geofenceVerdict(distanceM: number | null): GeofenceVerdict {
  if (distanceM === null || !Number.isFinite(distanceM)) return 'unknown'
  return distanceM <= DROP_RADIUS_M ? 'inside' : 'outside'
}
