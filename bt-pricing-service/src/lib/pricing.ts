import { z } from 'zod'
import {
  type VehicleClass,
  VEHICLE_TYPE_TO_CLASS,
  HANDLING_BASE,
  costBreakdown,
  variableCostPerKm,
  type CostBreakdown,
} from './cto-cost.js'

// -----------------------------------------------------------
// Commercial split (what the shipper is charged) PLUS the CTO deterministic
// cost-breakdown anchor (Appendix A) so the shipper sees where the price comes
// from. Both are returned together.
//
// THE RATE CARD IS DERIVED FROM THE COST MODEL, NOT HARDCODED.
//
// It used to be a second, independent table of magic numbers — hcv: 22 — sitting
// next to a cost engine that says an HCV costs 90/3.5 + 1200/400 + 8 = ~36.7 per
// km to run. Every class was underwater, worst at HCV, where the platform quoted
// 22 against a 36.7 cost and the carrier ate ~15/km. That is what put negative
// margins on the fleet P&L dashboards.
//
// Two hardcoded tables cannot stay in sync, and the failure is silent and
// one-directional: raise DIESEL_PRICE_INR and the cost side moves while the rate
// side does not, so the same bug quietly comes back and deepens with every fuel
// move. Deriving the rate from the cost makes "priced below cost" structurally
// unreachable for any positive margin multiple.
// -----------------------------------------------------------

/** Read a positive number from the environment, falling back when unset/invalid. */
function envNum(name: string, fallback: number): number {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

/**
 * Gross margin over operating cost.
 *
 * Anchored on the only real market numbers we have (founder, 2026-08-02): an HCV
 * costs about 36/km to run and moves at about 60/km in the market. 36.71 * 1.63
 * = 59.8, which reproduces that 60 from the cost model alone — so one constant
 * carries the whole card instead of four independently-guessed rates.
 */
export const MARGIN_MULTIPLE = envNum('PRICE_MARGIN_MULTIPLE', 1.63)

/**
 * Commercial rate (INR/km) for a vehicle type.
 *
 * Derived from the cost model, with a per-type env escape hatch —
 * `RATE_PER_KM_HCV=60` — for when the founder has a real number for a lane and
 * wants it used verbatim rather than computed. Overrides are deliberately NOT
 * floored at cost: an operator setting a rate is making a commercial decision
 * (a loss-leader on a return leg is a real strategy) and the platform should not
 * silently overrule it. The default path is the one that must never go
 * underwater, and it cannot.
 */
export function ratePerKm(vehicleType: string): number {
  const override = envNum(`RATE_PER_KM_${vehicleType.toUpperCase()}`, 0)
  if (override) return override
  const cls: VehicleClass = VEHICLE_TYPE_TO_CLASS[vehicleType] ?? 'MCV'
  return Math.round(variableCostPerKm(cls) * MARGIN_MULTIPLE)
}

export const LOAD_MULT: Record<string, number>   = { general: 1.0, fragile: 1.2, perishable: 1.15, hazardous: 1.5, heavy_machinery: 1.3 }
export const PLATFORM_RATE = 0.10

export const QuoteBody = z.object({
  distance_km:  z.number().positive(),
  vehicle_type: z.enum(['mini_truck', 'lcv', 'hcv', 'trailer']),
  load_type:    z.enum(['general', 'fragile', 'perishable', 'hazardous', 'heavy_machinery']),
  weight_kg:    z.number().positive(),
})
export type QuoteInput = z.infer<typeof QuoteBody>

export type QuoteResult = {
  base_price: number
  weight_surcharge: number
  /** Fixed per-trip loading/handling cost, passed through at cost. */
  handling_fee: number
  /** Derived rate actually used, so the caller can show its working. */
  rate_per_km: number
  total_price: number
  platform_fee: number
  shipper_pays: number
  driver_receives: number
  currency: 'INR'
  version: string
  cost_breakdown: CostBreakdown
}

export function computeQuote(input: QuoteInput): QuoteResult {
  const { distance_km, vehicle_type, load_type, weight_kg } = input

  const vehicleClass: VehicleClass = VEHICLE_TYPE_TO_CLASS[vehicle_type] ?? 'MCV'
  const rate = ratePerKm(vehicle_type)

  const base         = Math.ceil(distance_km * rate * (LOAD_MULT[load_type] ?? 1.0))
  const wt_surcharge = weight_kg > 5000 ? Math.ceil((weight_kg - 5000) / 1000) * 500 : 0

  // Handling is a FIXED per-trip cost (loading/unloading labour), so a purely
  // per-km price leaves it uncovered — and the shorter the trip, the bigger the
  // hole. A 50km HCV run bills 3,000 against 2,836 of cost, of which 1,000 is
  // this. Passed through at cost, not marked up: the margin is on the movement.
  const handling     = HANDLING_BASE[vehicleClass]

  const total        = base + wt_surcharge + handling
  const platform_fee = Math.ceil(total * PLATFORM_RATE)

  return {
    base_price: base,
    weight_surcharge: wt_surcharge,
    handling_fee: handling,
    rate_per_km: rate,
    total_price: total,
    platform_fee,
    shipper_pays: total,
    driver_receives: total - platform_fee,
    currency: 'INR',
    version: 'v2-cost-derived',
    cost_breakdown: costBreakdown(vehicleClass, distance_km),
  }
}
