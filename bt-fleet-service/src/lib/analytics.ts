import { getSupabase } from './supabase.js'
import { loadCostNorms } from './economics.js'
import { listFleetVehicles, listVehicleFinance } from './vehicles-repo.js'
import { hydrateDriverIdentities } from './fleet-repo.js'
import { asRows, type FleetOwnerRow, type TripEconomicsRow, type VehicleRow } from './types.js'

// -----------------------------------------------------------
// analytics — every fleet dashboard number, computed from trip_economics ONLY.
//
// WHY: a fleet is 100-1000 trucks over arbitrary date ranges. Aggregating
// bookings x payouts x trip_expenses x location_history at request time does not
// survive that, which is why migration 0017 writes the per-trip roll-up once at
// completed->paid. Reference data (cost norms) and per-asset fixed costs
// (vehicle_finance) are joined in — they are one small row per truck, not a scan.
//
// Three DISTINCT utilization metrics (Q20), plus the headline running-cost score:
// did this asset cover its own running cost AND its EMI over the period?
// -----------------------------------------------------------

const ECONOMICS_COLUMNS =
  'booking_id, fleet_owner_id, vehicle_id, driver_id, revenue_inr, fuel_cost_est_inr, def_cost_est_inr, ' +
  'engine_oil_cost_inr, gear_oil_cost_inr, service_cost_inr, tyre_cost_inr, driver_wage_alloc_inr, ' +
  'fuel_cost_actual_inr, toll_cost_inr, other_cost_inr, running_cost_inr, net_profit_inr, ' +
  'distance_km_quoted, distance_km_actual, laden_weight_kg, capacity_kg, volume_used_cuft, ' +
  'capacity_cuft, started_at, completed_at, model_version, computed_at'

export type Period = { from: string; to: string }

const DEFAULT_PERIOD_DAYS = 30
const MS_PER_DAY = 86_400_000
const DAYS_PER_MONTH = 30.4375 // 365.25 / 12 — keeps a 90-day window worth ~3 EMIs

// resolvePeriod — default window is the trailing 30 days, so the dashboard has a
// sensible answer before the owner touches a date picker.
export function resolvePeriod(from?: string, to?: string, now = new Date()): Period {
  const end = to ? new Date(to) : now
  const start = from ? new Date(from) : new Date(end.getTime() - DEFAULT_PERIOD_DAYS * MS_PER_DAY)
  return { from: start.toISOString(), to: end.toISOString() }
}

export function daysInPeriod(period: Period): number {
  const days = (new Date(period.to).getTime() - new Date(period.from).getTime()) / MS_PER_DAY
  return Math.max(1, days)
}

export function monthsInPeriod(period: Period): number {
  return daysInPeriod(period) / DAYS_PER_MONTH
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function pct(numerator: number, denominator: number): number | null {
  if (!(denominator > 0)) return null
  return round2((numerator / denominator) * 100)
}

function sum(rows: TripEconomicsRow[], pick: (r: TripEconomicsRow) => number | null): number {
  return rows.reduce((total, r) => total + (Number(pick(r)) || 0), 0)
}

// loadTripEconomics — the single read every analytics endpoint is built on.
// Scoped by fleet_owner_id; the period filters on completed_at, which the roll-up
// always stamps.
export async function loadTripEconomics(
  fleetOwnerId: string,
  period: Period,
  filter: { vehicleId?: string; driverId?: string } = {},
): Promise<TripEconomicsRow[]> {
  let query = getSupabase()
    .from('trip_economics')
    .select(ECONOMICS_COLUMNS)
    .eq('fleet_owner_id', fleetOwnerId)
    .gte('completed_at', period.from)
    .lte('completed_at', period.to)
  if (filter.vehicleId) query = query.eq('vehicle_id', filter.vehicleId)
  if (filter.driverId) query = query.eq('driver_id', filter.driverId)

  const { data, error } = await query.order('completed_at', { ascending: false })
  if (error) throw new Error(`trip_economics select failed: ${error.message}`)
  return asRows<TripEconomicsRow>(data)
}

export type Utilization = {
  /** Σ laden_weight_kg ÷ Σ capacity_kg — how full the truck ran by weight. */
  tonnage_pct: number | null
  /** Σ volume_used_cuft ÷ Σ capacity_cuft — how full it ran by space. */
  volume_pct: number | null
  /** Σ distance_km_actual ÷ (kms_per_year ÷ 365 × days) — how hard it was worked. */
  distance_pct: number | null
  laden_weight_kg: number
  capacity_kg: number
  volume_used_cuft: number
  capacity_cuft: number
  distance_km: number
  expected_distance_km: number | null
}

// computeUtilization — the three metrics are deliberately separate: a truck can run
// 100% of its expected km while half empty, and the owner must see both.
export function computeUtilization(rows: TripEconomicsRow[], expectedDistanceKm: number | null): Utilization {
  const ladenKg = sum(rows, r => r.laden_weight_kg)
  const capacityKg = sum(rows, r => r.capacity_kg)
  const volumeCuft = sum(rows, r => r.volume_used_cuft)
  const capacityCuft = sum(rows, r => r.capacity_cuft)
  const distanceKm = sum(rows, r => r.distance_km_actual ?? r.distance_km_quoted)

  return {
    tonnage_pct: pct(ladenKg, capacityKg),
    volume_pct: pct(volumeCuft, capacityCuft),
    distance_pct: expectedDistanceKm === null ? null : pct(distanceKm, expectedDistanceKm),
    laden_weight_kg: round2(ladenKg),
    capacity_kg: round2(capacityKg),
    volume_used_cuft: round2(volumeCuft),
    capacity_cuft: round2(capacityCuft),
    distance_km: round2(distanceKm),
    expected_distance_km: expectedDistanceKm === null ? null : round2(expectedDistanceKm),
  }
}

export type RunningCostScore = {
  revenue_inr: number
  running_cost_inr: number
  gross_margin_inr: number
  fixed_cost_inr: number
  emi_inr: number
  surplus_inr: number
  /** The headline: did the asset pay for its own movement AND its EMI? */
  covered: boolean
}

// scoreRunningCost — monthly fixed charges are NOT allocated per trip (Q19); they
// are applied once here, pro-rated to the reporting window, so the answer reads as
// "this truck cleared its EMI by ₹X this month".
export function scoreRunningCost(
  rows: TripEconomicsRow[],
  monthlyFixedInr: number,
  emiMonthlyInr: number,
  months: number,
): RunningCostScore {
  const revenue = sum(rows, r => r.revenue_inr)
  const running = sum(rows, r => r.running_cost_inr)
  const fixed = monthlyFixedInr * months
  const surplus = revenue - running - fixed
  return {
    revenue_inr: round2(revenue),
    running_cost_inr: round2(running),
    gross_margin_inr: round2(revenue - running),
    fixed_cost_inr: round2(fixed),
    emi_inr: round2(emiMonthlyInr * months),
    surplus_inr: round2(surplus),
    covered: surplus >= 0,
  }
}

export type VehicleAnalytics = {
  vehicle_id: string
  rc_number: string
  model_category: string | null
  emission_norm: string | null
  trips: number
  utilization: Utilization
  score: RunningCostScore
  cost_breakdown_inr: {
    fuel: number
    def: number
    engine_oil: number
    gear_oil: number
    service: number
    tyres: number
    driver_wage: number
    toll: number
    other: number
  }
  net_profit_inr: number
  cost_per_km_inr: number | null
  revenue_per_km_inr: number | null
}

function costBreakdown(rows: TripEconomicsRow[]) {
  return {
    fuel: round2(sum(rows, r => r.fuel_cost_est_inr)),
    def: round2(sum(rows, r => r.def_cost_est_inr)),
    engine_oil: round2(sum(rows, r => r.engine_oil_cost_inr)),
    gear_oil: round2(sum(rows, r => r.gear_oil_cost_inr)),
    service: round2(sum(rows, r => r.service_cost_inr)),
    tyres: round2(sum(rows, r => r.tyre_cost_inr)),
    driver_wage: round2(sum(rows, r => r.driver_wage_alloc_inr)),
    toll: round2(sum(rows, r => r.toll_cost_inr)),
    other: round2(sum(rows, r => r.other_cost_inr)),
  }
}

// monthlyFixedForVehicle — EMI plus the annuals spread over 12, plus this truck's
// share of the fleet's unattributable overhead.
function monthlyFixedForVehicle(
  finance: { emi_amount_inr: number; insurance_annual_inr: number; permit_annual_inr: number; fitness_annual_inr: number } | undefined,
  overheadSharePerMonth: number,
): { total: number; emi: number } {
  const emi = Number(finance?.emi_amount_inr ?? 0)
  const annuals =
    Number(finance?.insurance_annual_inr ?? 0) +
    Number(finance?.permit_annual_inr ?? 0) +
    Number(finance?.fitness_annual_inr ?? 0)
  return { total: emi + annuals / 12 + overheadSharePerMonth, emi }
}

// perVehicleAnalytics — the per-asset P&L table. Four bounded reads regardless of
// how many trips the period contains: trips, vehicles, finance rows, cost norms.
export async function perVehicleAnalytics(
  owner: FleetOwnerRow,
  period: Period,
  vehicleId?: string,
): Promise<VehicleAnalytics[]> {
  const [rows, allVehicles, norms] = await Promise.all([
    loadTripEconomics(owner.id, period, { vehicleId }),
    listFleetVehicles(owner.id),
    loadCostNorms(),
  ])
  const vehicles = vehicleId ? allVehicles.filter(v => v.id === vehicleId) : allVehicles
  const finance = await listVehicleFinance(vehicles.map(v => v.id))

  const months = monthsInPeriod(period)
  const days = daysInPeriod(period)
  // Overhead is spread across ACTIVE vehicles — an owner with 10 trucks carries
  // a tenth of the office cost on each.
  const overheadShare = allVehicles.length > 0 ? Number(owner.monthly_overhead_inr) / allVehicles.length : 0

  const byVehicle = new Map<string, TripEconomicsRow[]>()
  for (const r of rows) {
    if (!r.vehicle_id) continue
    const list = byVehicle.get(r.vehicle_id) ?? []
    list.push(r)
    byVehicle.set(r.vehicle_id, list)
  }

  return vehicles.map(v => analyseVehicle(v, byVehicle.get(v.id) ?? [], norms, finance.get(v.id), overheadShare, months, days))
}

function analyseVehicle(
  vehicle: VehicleRow,
  rows: TripEconomicsRow[],
  norms: Map<string, { kms_per_year: number }>,
  finance: { emi_amount_inr: number; insurance_annual_inr: number; permit_annual_inr: number; fitness_annual_inr: number } | undefined,
  overheadShare: number,
  months: number,
  days: number,
): VehicleAnalytics {
  const kmsPerYear = vehicle.model_category ? norms.get(vehicle.model_category)?.kms_per_year ?? null : null
  const expectedKm = kmsPerYear === null ? null : (kmsPerYear / 365) * days
  const fixed = monthlyFixedForVehicle(finance, overheadShare)
  const utilization = computeUtilization(rows, expectedKm)
  const score = scoreRunningCost(rows, fixed.total, fixed.emi, months)

  return {
    vehicle_id: vehicle.id,
    rc_number: vehicle.rc_number,
    model_category: vehicle.model_category,
    emission_norm: vehicle.emission_norm,
    trips: rows.length,
    utilization,
    score,
    cost_breakdown_inr: costBreakdown(rows),
    net_profit_inr: round2(sum(rows, r => r.net_profit_inr)),
    cost_per_km_inr: utilization.distance_km > 0 ? round2(score.running_cost_inr / utilization.distance_km) : null,
    revenue_per_km_inr: utilization.distance_km > 0 ? round2(score.revenue_inr / utilization.distance_km) : null,
  }
}

export type FleetSummary = {
  period: Period
  trips: number
  active_vehicles: number
  utilization: Utilization
  score: RunningCostScore
  cost_breakdown_inr: ReturnType<typeof costBreakdown>
  net_profit_inr: number
  monthly_overhead_inr: number
  vehicles_covering_emi: number
}

export async function fleetSummary(owner: FleetOwnerRow, period: Period): Promise<FleetSummary> {
  const [rows, vehicles, norms] = await Promise.all([
    loadTripEconomics(owner.id, period),
    listFleetVehicles(owner.id),
    loadCostNorms(),
  ])
  const finance = await listVehicleFinance(vehicles.map(v => v.id))

  const months = monthsInPeriod(period)
  const days = daysInPeriod(period)
  const overheadShare = vehicles.length > 0 ? Number(owner.monthly_overhead_inr) / vehicles.length : 0

  // Fleet-wide expected distance is the sum of each truck's own annual-km norm —
  // a mixed fleet has no single denominator.
  let expectedKm: number | null = vehicles.length > 0 ? 0 : null
  for (const v of vehicles) {
    const kmsPerYear = v.model_category ? norms.get(v.model_category)?.kms_per_year : undefined
    if (kmsPerYear && expectedKm !== null) expectedKm += (kmsPerYear / 365) * days
  }

  const byVehicle = new Map<string, TripEconomicsRow[]>()
  for (const r of rows) {
    if (!r.vehicle_id) continue
    const list = byVehicle.get(r.vehicle_id) ?? []
    list.push(r)
    byVehicle.set(r.vehicle_id, list)
  }

  let fleetMonthlyFixed = 0
  let fleetMonthlyEmi = 0
  let coveringEmi = 0
  // Reuse the already-loaded rows rather than re-running perVehicleAnalytics —
  // the summary must stay a fixed number of queries.
  for (const v of vehicles) {
    const fixed = monthlyFixedForVehicle(finance.get(v.id), overheadShare)
    fleetMonthlyFixed += fixed.total
    fleetMonthlyEmi += fixed.emi
    const vehicleRows = byVehicle.get(v.id) ?? []
    if (vehicleRows.length > 0 && scoreRunningCost(vehicleRows, fixed.total, fixed.emi, months).covered) {
      coveringEmi++
    }
  }

  return {
    period,
    trips: rows.length,
    active_vehicles: vehicles.length,
    utilization: computeUtilization(rows, expectedKm),
    score: scoreRunningCost(rows, fleetMonthlyFixed, fleetMonthlyEmi, months),
    cost_breakdown_inr: costBreakdown(rows),
    net_profit_inr: round2(sum(rows, r => r.net_profit_inr)),
    monthly_overhead_inr: Number(owner.monthly_overhead_inr),
    vehicles_covering_emi: coveringEmi,
  }
}

export type DriverAnalytics = {
  driver_id: string
  full_name: string | null
  phone_number: string | null
  trips: number
  distance_km: number
  revenue_inr: number
  running_cost_inr: number
  net_profit_inr: number
  wage_allocated_inr: number
  net_profit_per_km_inr: number | null
}

export async function perDriverAnalytics(fleetOwnerId: string, period: Period): Promise<DriverAnalytics[]> {
  const rows = await loadTripEconomics(fleetOwnerId, period)

  const byDriver = new Map<string, TripEconomicsRow[]>()
  for (const r of rows) {
    if (!r.driver_id) continue
    const list = byDriver.get(r.driver_id) ?? []
    list.push(r)
    byDriver.set(r.driver_id, list)
  }

  const identities = await hydrateDriverIdentities([...byDriver.keys()])

  return [...byDriver.entries()].map(([driverId, driverRows]) => {
    const distance = sum(driverRows, r => r.distance_km_actual ?? r.distance_km_quoted)
    const profit = sum(driverRows, r => r.net_profit_inr)
    return {
      driver_id: driverId,
      full_name: identities.get(driverId)?.full_name ?? null,
      phone_number: identities.get(driverId)?.phone_number ?? null,
      trips: driverRows.length,
      distance_km: round2(distance),
      revenue_inr: round2(sum(driverRows, r => r.revenue_inr)),
      running_cost_inr: round2(sum(driverRows, r => r.running_cost_inr)),
      net_profit_inr: round2(profit),
      wage_allocated_inr: round2(sum(driverRows, r => r.driver_wage_alloc_inr)),
      net_profit_per_km_inr: distance > 0 ? round2(profit / distance) : null,
    }
  }).sort((a, b) => b.net_profit_inr - a.net_profit_inr)
}

export type FuelComparison = {
  period: Period
  estimated_inr: number
  actual_inr: number
  variance_inr: number
  variance_pct: number | null
  trips_with_actuals: number
  trips: number
  by_vehicle: {
    vehicle_id: string
    rc_number: string
    estimated_inr: number
    actual_inr: number
    variance_inr: number
    variance_pct: number | null
    trips_with_actuals: number
  }[]
}

// fuelComparison — modelled fuel vs what the driver actually filled (Q21). A
// persistent positive variance on one truck is the pilferage/derate signal the
// owner is really buying.
export async function fuelComparison(fleetOwnerId: string, period: Period): Promise<FuelComparison> {
  const [rows, vehicles] = await Promise.all([
    loadTripEconomics(fleetOwnerId, period),
    listFleetVehicles(fleetOwnerId),
  ])
  const rcByVehicle = new Map(vehicles.map(v => [v.id, v.rc_number]))

  // Only trips that HAVE an actual are comparable; including the rest would make
  // every fleet look like it is under-spending on diesel.
  const withActuals = rows.filter(r => r.fuel_cost_actual_inr != null)
  const estimated = sum(withActuals, r => r.fuel_cost_est_inr)
  const actual = sum(withActuals, r => r.fuel_cost_actual_inr)

  const byVehicle = new Map<string, TripEconomicsRow[]>()
  for (const r of withActuals) {
    if (!r.vehicle_id) continue
    const list = byVehicle.get(r.vehicle_id) ?? []
    list.push(r)
    byVehicle.set(r.vehicle_id, list)
  }

  return {
    period,
    estimated_inr: round2(estimated),
    actual_inr: round2(actual),
    variance_inr: round2(actual - estimated),
    variance_pct: pct(actual - estimated, estimated),
    trips_with_actuals: withActuals.length,
    trips: rows.length,
    by_vehicle: [...byVehicle.entries()].map(([vehicleId, vehicleRows]) => {
      const est = sum(vehicleRows, r => r.fuel_cost_est_inr)
      const act = sum(vehicleRows, r => r.fuel_cost_actual_inr)
      return {
        vehicle_id: vehicleId,
        rc_number: rcByVehicle.get(vehicleId) ?? '',
        estimated_inr: round2(est),
        actual_inr: round2(act),
        variance_inr: round2(act - est),
        variance_pct: pct(act - est, est),
        trips_with_actuals: vehicleRows.length,
      }
    }).sort((a, b) => b.variance_inr - a.variance_inr),
  }
}
