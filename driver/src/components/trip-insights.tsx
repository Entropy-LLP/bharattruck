'use client'

/**
 * TripInsights — the driver's in-trip panel: nearest petrol pumps, fuel cost, route alerts.
 *
 * COST SHAPE, and it is deliberate:
 *   pumps  — ON DEMAND. Every call is a billed Places (New) request, so it fires when the
 *            driver taps, never on a timer. Re-anchored on their current position each time,
 *            because a truck at 60 km/h leaves a 5 km search radius in five minutes.
 *   fuel   — on mount + on edit. Pure arithmetic server-side, no Google call.
 *   alerts — polled at 60s. A plain Postgres read with no Google behind it, and the driver
 *            genuinely wants to know they have drifted off route without tapping anything.
 *
 * Every failure here is non-fatal by construction. This panel sits under the trip controls;
 * if pumps 502 or the network drops, the driver must still be able to complete the delivery.
 * Nothing in here can throw into the parent tree.
 */

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Fuel, Loader2, MapPin, Navigation, RefreshCw } from 'lucide-react'
import {
  ApiError,
  getPumps,
  getFuel,
  getTripAlertsQuiet,
  type PetrolPump,
  type FuelData,
  type TripAlert,
} from '@/lib/api'
import { buildNavDeepLink } from '@/lib/nav'

const ALERT_POLL_MS = 60_000

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

export default function TripInsights({
  bookingId,
  onPumpsLoaded,
}: {
  bookingId: string
  /** Lets the parent overlay the pumps on the map once they exist. */
  onPumpsLoaded?: (pumps: PetrolPump[]) => void
}) {
  return (
    <div className="space-y-3">
      <AlertsCard bookingId={bookingId} />
      <FuelCard bookingId={bookingId} />
      <PumpsCard bookingId={bookingId} onPumpsLoaded={onPumpsLoaded} />
    </div>
  )
}

// ── Alerts ────────────────────────────────────────────────────

function AlertsCard({ bookingId }: { bookingId: string }) {
  const [alerts, setAlerts] = useState<TripAlert[]>([])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const data = await getTripAlertsQuiet(bookingId)
        if (cancelled) return
        // Only unresolved alerts matter to a driver mid-trip; the resolved history is the
        // fleet owner's and the shipper's concern, not something to nag the driver with.
        // Array guard: this payload is not validated field-by-field, and `.filter` on a
        // missing field would throw inside render.
        setAlerts(Array.isArray(data?.alerts) ? data.alerts.filter((a) => !a.resolved_at) : [])
        setFailed(false)
      } catch {
        if (!cancelled) setFailed(true)
      }
    }

    load()
    const id = setInterval(load, ALERT_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [bookingId])

  // A silent no-op is right here: an empty alert list and an unreachable alerts endpoint
  // both mean "nothing to tell the driver", and a red error box for the latter would be
  // pure noise on the screen they use to get paid.
  if (failed || alerts.length === 0) return null

  return (
    <div className="space-y-2">
      {/* NOTE: no blue-* classes below. driver/src/app/globals.css redefines
          --color-blue-500 through --color-blue-800 to the brand ORANGE but leaves
          blue-300/400 as stock Tailwind blue, so the obvious "info" styling renders as
          orange-on-blue. Info uses the neutral secondary surface instead, which also keeps
          it visually distinct from the amber warning tier. */}
      {alerts.map((a) => (
        <div
          key={a.id}
          role="status"
          aria-live="polite"
          className={`flex items-start gap-2 rounded-xl p-3 border ${
            a.severity === 'critical'
              ? 'bg-red-500/10 border-red-400/40'
              : a.severity === 'warning'
                ? 'bg-amber-500/10 border-amber-400/40'
                : 'bg-secondary border-border'
          }`}
        >
          <AlertTriangle
            className={`h-4 w-4 flex-shrink-0 mt-0.5 ${
              a.severity === 'critical'
                ? 'text-red-400'
                : a.severity === 'warning'
                  ? 'text-amber-400'
                  : 'text-muted-foreground'
            }`}
          />
          <p
            className={`text-sm ${
              a.severity === 'critical'
                ? 'text-red-300'
                : a.severity === 'warning'
                  ? 'text-amber-300'
                  : 'text-foreground'
            }`}
          >
            {a.message ?? a.type}
          </p>
        </div>
      ))}
    </div>
  )
}

// ── Fuel ──────────────────────────────────────────────────────

function FuelCard({ bookingId }: { bookingId: string }) {
  const [fuel, setFuel] = useState<FuelData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [price, setPrice] = useState<string>('')
  const [editing, setEditing] = useState(false)

  const load = useCallback(
    async (dieselPrice?: number) => {
      setLoading(true)
      setError(null)
      try {
        const data = await getFuel(bookingId, dieselPrice ? { diesel_price: dieselPrice } : undefined)
        setFuel(data)
        setPrice(String(data.diesel_price_inr))
      } catch (err) {
        setError('Could not load the fuel estimate just now.')
      } finally {
        setLoading(false)
      }
    },
    [bookingId],
  )

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="bg-card rounded-2xl border border-border p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Fuel className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-semibold text-foreground">Fuel for this trip</h4>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {error && <p className="text-xs text-muted-foreground">{error}</p>}

      {/* distance_basis 'unknown' means no route has been computed yet, so every figure
          below would be zero. Rendering "Rs 0" would read as "this trip costs nothing",
          which is worse than admitting we cannot say yet. */}
      {fuel && !error && fuel.distance_basis === 'unknown' && (
        <p className="text-xs text-muted-foreground">{fuel.distance_note}</p>
      )}

      {fuel && !error && fuel.distance_basis !== 'unknown' && (
        <>
          <p className="text-2xl font-bold text-foreground tabular-nums">
            {inr(fuel.estimated_fuel_cost_inr)}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {fuel.litres_required} L over {fuel.distance_km} km · {fuel.mileage_kmpl} kmpl
          </p>
          {fuel.def_cost_inr > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Diesel {inr(fuel.diesel_cost_inr)} + DEF {inr(fuel.def_cost_inr)}
            </p>
          )}

          {/* Provenance, always shown. An estimate built on a class average must never be
              presented with the same confidence as one built on the truck's own model. */}
          <p className="text-[11px] text-muted-foreground/70 mt-2 leading-snug">
            {fuel.distance_note} {fuel.basis_note}
          </p>

          {editing ? (
            <div className="flex items-center gap-2 mt-3">
              <div className="flex-1 flex items-center gap-1 bg-secondary rounded-xl px-3 h-11">
                <span className="text-sm text-muted-foreground">₹</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  aria-label="Diesel price per litre"
                  className="w-full bg-transparent text-sm text-foreground outline-none"
                />
                <span className="text-xs text-muted-foreground whitespace-nowrap">/ L</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  const n = Number(price)
                  if (Number.isFinite(n) && n > 0) void load(n)
                  setEditing(false)
                }}
                className="h-11 px-4 rounded-xl bg-purple-600 text-white text-sm font-semibold active:scale-95 transition-transform"
              >
                Apply
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="mt-3 h-11 -mx-1 px-1 flex items-center text-xs text-purple-400 font-medium"
            >
              Diesel at ₹{fuel.diesel_price_inr}/L — change
            </button>
          )}
        </>
      )}
    </div>
  )
}

// ── Petrol pumps ──────────────────────────────────────────────

function PumpsCard({
  bookingId,
  onPumpsLoaded,
}: {
  bookingId: string
  onPumpsLoaded?: (pumps: PetrolPump[]) => void
}) {
  const [pumps, setPumps] = useState<PetrolPump[] | null>(null)
  const [source, setSource] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getPumps(bookingId)
      // Array guard: the render below dereferences .length on anything non-null.
      const list = Array.isArray(data?.pumps) ? data.pumps : []
      setPumps(list)
      setSource(data?.origin_source ?? null)
      onPumpsLoaded?.(list)
    } catch (err) {
      // Deliberately NOT err.message: an UPSTREAM_ERROR from tracking-service carries up
      // to 200 chars of raw Google response body, which is noise to a driver.
      setError('Could not find nearby pumps just now — tap to try again.')
    } finally {
      setLoading(false)
    }
  }, [bookingId, onPumpsLoaded])

  return (
    <div className="bg-card rounded-2xl border border-border p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-semibold text-foreground">Petrol pumps nearby</h4>
        </div>
        {pumps && (
          <button
            type="button"
            onClick={() => void load()}
            // Disabled while in flight: every call here is a BILLED Places (New) request,
            // and a 16px icon on a moving truck gets double-tapped constantly.
            disabled={loading}
            aria-label="Search again from my current position"
            aria-busy={loading}
            className="-m-2 p-2 h-11 w-11 flex items-center justify-center text-muted-foreground active:scale-90 transition-transform disabled:opacity-40"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        )}
      </div>

      {error && <p className="text-xs text-muted-foreground mb-2">{error}</p>}

      {pumps === null ? (
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Find nearest pumps"
          aria-busy={loading}
          className="w-full h-11 rounded-xl bg-secondary text-foreground font-medium text-sm active:scale-[0.98] transition-transform disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Find nearest pumps'}
        </button>
      ) : pumps.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No pumps found within 5 km. Try again further along the highway.
        </p>
      ) : (
        <>
          {source && source !== 'live_position' && (
            <p className="text-[11px] text-amber-400/90 mb-2">
              {source === 'last_breadcrumb'
                ? 'Searched from your last known position — GPS is not reporting right now.'
                : 'Searched from the pickup point — no location recorded for this trip yet.'}
            </p>
          )}
          <ul className="divide-y divide-border">
            {pumps.map((p) => (
              <li key={p.place_id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {(p.distance_m / 1000).toFixed(1)} km
                    {p.address ? ` · ${p.address}` : ''}
                  </p>
                </div>
                {/* Deep-link handoff (D-004) — the phone's Google Maps does the navigating.
                    No in-app turn-by-turn, here or anywhere. */}
                <a
                  href={buildNavDeepLink({ destination: { lat: p.lat, lng: p.lng } })}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Navigate to ${p.name}`}
                  className="flex-shrink-0 h-11 w-11 rounded-full bg-secondary flex items-center justify-center active:scale-90 transition-transform"
                >
                  <Navigation className="h-4 w-4 text-purple-400" />
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
