'use client'

/**
 * Post a Load (ship surface — Phase 2 of docs/UNIFIED_APP_PLAN.md).
 *
 * Ported from shipper/src/app/bookings/new/page.tsx into bt-app's house style
 * (light cards, the shared Field/INPUT/PRIMARY_BTN conventions, ErrorNote banners
 * for failures, toast for success — matching settings/ and the fleet console).
 *
 * The flow the backend requires, kept intact:
 *  - Route COORDINATES drive both the quote and the booking: bt-pricing-service
 *    DERIVES distance server-side from them (the shipper never types a distance),
 *    and the SAME coords + vehicle class are sent on create so the booking binds to
 *    the locked quote (a mismatch is rejected).
 *  - The price is ADVISORY on an auction (D-11): a reference, not a charge. The
 *    panel says so, driven by the server's own classification.
 *  - A load must name a REACHABLE consignee (D-29): name + phone are required.
 *    Receiver email is the optional legacy POD inbox.
 *  - On submit → createBooking → the new load's detail page.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { PackagePlus } from 'lucide-react'

import { PageHeader } from '@/components/app-shell'
import { Card, CardHead, ErrorNote } from '@/components/stat'
import {
  ApiError,
  assignToBooking,
  createBooking,
  directAttachBooking,
  getPriceQuote,
  priceQuoteBasis,
  priceQuoteHeading,
  quoteKindOf,
} from '@/lib/api'
import { useAuth } from '@/lib/auth'
import FleetPairPicker, { type FleetPair } from '@/components/fleet-pair-picker'
import { inr } from '@/lib/format'
import type {
  BookingType,
  ConsigneeInput,
  PriceQuote,
  PriceQuoteLoadType,
  PriceQuoteVehicleType,
} from '@/lib/types'

const LOAD_TYPES: { value: PriceQuoteLoadType; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'fragile', label: 'Fragile' },
  { value: 'perishable', label: 'Perishable' },
  { value: 'hazardous', label: 'Hazardous' },
  { value: 'heavy_machinery', label: 'Heavy machinery' },
]

const VEHICLE_TYPES: { value: PriceQuoteVehicleType; label: string }[] = [
  { value: 'mini_truck', label: 'Mini truck' },
  { value: 'lcv', label: 'LCV' },
  { value: 'hcv', label: 'HCV' },
  { value: 'trailer', label: 'Trailer' },
]

const INPUT =
  'w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none ' +
  'focus:border-blue-500 focus:ring-2 focus:ring-blue-100'

const PRIMARY_BTN =
  'rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5 ' +
  'active:scale-[0.98] transition-transform disabled:opacity-50 disabled:active:scale-100'

const SECONDARY_BTN =
  'rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium px-4 py-2.5 ' +
  'disabled:opacity-50'

/** A 10-digit Indian mobile, best-effort normalised (the server is authoritative). */
function toTenDigit(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.length > 10 ? digits.slice(-10) : digits
}

export default function PostLoadPage() {
  const router = useRouter()
  // A poster who holds a fleet profile is a DISTRIBUTOR — they can carry their own load with
  // their own fleet (D-10). Only they see the truck+driver picker below; everyone else keeps
  // the solo direct-attach by driver id.
  const { personas } = useAuth()
  const isDistributor = !!personas?.fleet_owner_id

  const [submitting, setSubmitting] = useState(false)
  const [quoting, setQuoting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [gstinBlocked, setGstinBlocked] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)

  const [bookingType, setBookingType] = useState<BookingType>('auction')

  // Quote-affecting fields are controlled so a stale lock can be invalidated the
  // moment any of them changes — a price priced for one trip must never be
  // submitted against another.
  const [sourceAddress, setSourceAddress] = useState('')
  const [sourceLat, setSourceLat] = useState('')
  const [sourceLng, setSourceLng] = useState('')
  const [destAddress, setDestAddress] = useState('')
  const [destLat, setDestLat] = useState('')
  const [destLng, setDestLng] = useState('')
  const [vehicleType, setVehicleType] = useState<PriceQuoteVehicleType>('lcv')
  const [loadType, setLoadType] = useState<PriceQuoteLoadType>('general')
  const [weightKg, setWeightKg] = useState('')

  // Consignee (D-29): name + phone required, receiver email optional.
  const [consigneeName, setConsigneeName] = useState('')
  const [consigneePhone, setConsigneePhone] = useState('')
  const [receiverEmail, setReceiverEmail] = useState('')

  // Schedule + marketplace routing.
  const [pickupDate, setPickupDate] = useState('')
  const [pickupTimeSlot, setPickupTimeSlot] = useState('')
  const [specialInstructions, setSpecialInstructions] = useState('')
  const [targetDriverId, setTargetDriverId] = useState('')
  // Distributor direct-attach: the truck + driver from the poster's own fleet.
  const [fleetPair, setFleetPair] = useState<FleetPair>({ vehicleId: null, driverId: null })
  const [auctionDeadline, setAuctionDeadline] = useState('')

  const [quote, setQuote] = useState<PriceQuote | null>(null)

  function invalidateQuote() {
    setQuote((q) => (q ? null : q))
  }

  function changeBookingType(next: BookingType) {
    if (next === bookingType) return
    setBookingType(next)
    invalidateQuote()
  }

  async function handleGetQuote() {
    setQuoteError(null)
    const sLat = parseFloat(sourceLat)
    const sLng = parseFloat(sourceLng)
    const dLat = parseFloat(destLat)
    const dLng = parseFloat(destLng)
    const weight = parseFloat(weightKg)

    if (![sLat, sLng, dLat, dLng].every(Number.isFinite)) {
      setQuoteError('Enter valid pickup & drop coordinates before getting a quote.')
      return
    }
    if (!Number.isFinite(weight) || weight <= 0) {
      setQuoteError('Enter a valid weight (kg) before getting a quote.')
      return
    }

    setQuoting(true)
    try {
      const q = await getPriceQuote({
        source_lat: sLat,
        source_lng: sLng,
        dest_lat: dLat,
        dest_lng: dLng,
        vehicle_type: vehicleType,
        load_type: loadType,
        weight_kg: weight,
        booking_type: bookingType,
      })
      setQuote(q)
      toast.success(quoteKindOf(q, bookingType) === 'advisory' ? 'Estimate ready' : 'Price locked')
    } catch (err: unknown) {
      setQuoteError(err instanceof ApiError ? err.message : 'Could not get a price quote — please try again.')
    } finally {
      setQuoting(false)
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFormError(null)

    if (!quote) {
      setFormError('Get a price quote before creating the booking.')
      return
    }
    const weight = parseFloat(weightKg)
    if (!Number.isFinite(weight) || weight <= 0) {
      setFormError('Enter a valid weight (kg).')
      return
    }
    if (!sourceAddress.trim() || !destAddress.trim()) {
      setFormError('Enter both a pickup and a drop address.')
      return
    }
    if (!pickupDate) {
      setFormError('Choose a pickup date.')
      return
    }
    const name = consigneeName.trim()
    const phone = toTenDigit(consigneePhone)
    if (!name) {
      setFormError('Enter the consignee’s name — a load must name who receives it (D-29).')
      return
    }
    if (!/^[6-9]\d{9}$/.test(phone)) {
      setFormError('Enter a valid 10-digit Indian mobile number for the consignee.')
      return
    }
    const distributorDirect = isDistributor && bookingType === 'direct'
    if (bookingType === 'direct') {
      if (distributorDirect) {
        if (!fleetPair.vehicleId || !fleetPair.driverId) {
          setFormError('Pick both a truck and a driver from your fleet.')
          return
        }
      } else if (!targetDriverId.trim()) {
        setFormError('A direct booking needs the target driver’s ID.')
        return
      }
    }

    const consignee: ConsigneeInput = { name, phone }

    setSubmitting(true)
    try {
      const booking = await createBooking({
        source_address: sourceAddress.trim(),
        source_lat: parseFloat(sourceLat),
        source_lng: parseFloat(sourceLng),
        destination_address: destAddress.trim(),
        dest_lat: parseFloat(destLat),
        dest_lng: parseFloat(destLng),
        load_type: loadType,
        weight_kg: weight,
        vehicle_type: vehicleType,
        quote_id: quote.quote_id,
        pickup_date: pickupDate,
        pickup_time_slot: pickupTimeSlot.trim() || undefined,
        special_instructions: specialInstructions.trim() || undefined,
        consignee,
        receiver_email: receiverEmail.trim() || undefined,
        booking_type: bookingType,
        // A distributor attaches to their OWN fleet below (never a solo target driver).
        target_driver_id: (!distributorDirect && bookingType === 'direct') ? targetDriverId.trim() || undefined : undefined,
        auction_deadline:
          bookingType === 'auction' && auctionDeadline
            ? new Date(auctionDeadline).toISOString()
            : undefined,
      })

      if (distributorDirect) {
        // Create → attach to my fleet → pair my chosen truck + driver. If the pairing step
        // trips (e.g. the truck is already on a trip), the load is still attached to the
        // fleet and shows in Trips → Needs assignment, so nothing is lost.
        await directAttachBooking(booking.id)
        try {
          await assignToBooking(booking.id, fleetPair.driverId!, fleetPair.vehicleId!)
          toast.success('Load posted and assigned to your truck & driver')
        } catch {
          toast.success('Load posted and attached to your fleet — finish assigning it in Trips')
        }
      } else {
        toast.success('Load posted')
      }
      router.push(`/loads/${booking.id}`)
    } catch (err: unknown) {
      // GSTIN missing (FB-04): point at Settings rather than a dead-end message. Keyed on
      // the dedicated GST_REQUIRED code, not message text (which shares VALIDATION_ERROR with
      // an expired quote-lock and could be reworded/localized).
      if (err instanceof ApiError && err.code === 'GST_REQUIRED') {
        setFormError(err.message)
        setGstinBlocked(true)
        setSubmitting(false)
        return
      }
      // An expired or already-used price-lock: drop it and make the shipper re-quote.
      if (err instanceof ApiError && (err.code === 'VALIDATION_ERROR' || err.code === 'INVALID_TRANSITION')) {
        setQuote(null)
        setFormError('Your quoted price is no longer valid — please get a new quote and try again.')
        setGstinBlocked(false)
      } else {
        setFormError(err instanceof ApiError ? err.message : 'Could not post the load — please try again.')
        setGstinBlocked(false)
      }
      setSubmitting(false)
    }
  }

  const kind = quote ? quoteKindOf(quote, bookingType) : null

  return (
    <div className="p-4 lg:p-6 max-w-2xl mx-auto">
      <PageHeader title="Post a Load" subtitle="Create a booking and take it to the marketplace or your own fleet." />

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Pickup */}
        <Card>
          <CardHead title="Pickup" sub="Where the goods are collected." />
          <div className="p-4 space-y-4">
            <Field id="source_address" label="Pickup address">
              <input
                id="source_address"
                value={sourceAddress}
                onChange={(e) => setSourceAddress(e.target.value)}
                placeholder="45 MG Road, Mumbai"
                className={INPUT}
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field id="source_lat" label="Latitude">
                <input
                  id="source_lat"
                  type="number"
                  step="any"
                  value={sourceLat}
                  onChange={(e) => { setSourceLat(e.target.value); invalidateQuote() }}
                  placeholder="19.0760"
                  className={`${INPUT} tabular-nums`}
                />
              </Field>
              <Field id="source_lng" label="Longitude">
                <input
                  id="source_lng"
                  type="number"
                  step="any"
                  value={sourceLng}
                  onChange={(e) => { setSourceLng(e.target.value); invalidateQuote() }}
                  placeholder="72.8777"
                  className={`${INPUT} tabular-nums`}
                />
              </Field>
            </div>
          </div>
        </Card>

        {/* Drop */}
        <Card>
          <CardHead title="Drop" sub="Where the goods are delivered." />
          <div className="p-4 space-y-4">
            <Field id="destination_address" label="Drop address">
              <input
                id="destination_address"
                value={destAddress}
                onChange={(e) => setDestAddress(e.target.value)}
                placeholder="12 Brigade Road, Bengaluru"
                className={INPUT}
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field id="dest_lat" label="Latitude">
                <input
                  id="dest_lat"
                  type="number"
                  step="any"
                  value={destLat}
                  onChange={(e) => { setDestLat(e.target.value); invalidateQuote() }}
                  placeholder="12.9716"
                  className={`${INPUT} tabular-nums`}
                />
              </Field>
              <Field id="dest_lng" label="Longitude">
                <input
                  id="dest_lng"
                  type="number"
                  step="any"
                  value={destLng}
                  onChange={(e) => { setDestLng(e.target.value); invalidateQuote() }}
                  placeholder="77.5946"
                  className={`${INPUT} tabular-nums`}
                />
              </Field>
            </div>
          </div>
        </Card>

        {/* Consignee (D-29) */}
        <Card>
          <CardHead title="Consignee" sub="Who receives the goods." />
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field id="consignee_name" label="Name" hint="The person or business receiving the load.">
                <input
                  id="consignee_name"
                  value={consigneeName}
                  onChange={(e) => setConsigneeName(e.target.value)}
                  placeholder="Anita Traders"
                  className={INPUT}
                />
              </Field>
              <Field id="consignee_phone" label="Mobile" hint="10-digit Indian mobile.">
                <input
                  id="consignee_phone"
                  type="tel"
                  inputMode="tel"
                  value={consigneePhone}
                  onChange={(e) => setConsigneePhone(e.target.value)}
                  placeholder="98765 43210"
                  className={`${INPUT} tabular-nums`}
                />
              </Field>
            </div>
            <Field
              id="receiver_email"
              label="Receiver email (optional)"
              hint="Delivery code is emailed here."
            >
              <input
                id="receiver_email"
                type="email"
                value={receiverEmail}
                onChange={(e) => setReceiverEmail(e.target.value)}
                placeholder="consignee@example.com"
                className={INPUT}
              />
            </Field>
          </div>
        </Card>

        {/* Cargo & vehicle — these drive the price quote */}
        <Card>
          <CardHead title="Cargo & vehicle" info="Distance is derived from the coordinates above." />
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field id="vehicle_type" label="Vehicle type">
                <select
                  id="vehicle_type"
                  value={vehicleType}
                  onChange={(e) => { setVehicleType(e.target.value as PriceQuoteVehicleType); invalidateQuote() }}
                  className={INPUT}
                >
                  {VEHICLE_TYPES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                </select>
              </Field>
              <Field id="load_type" label="Load type">
                <select
                  id="load_type"
                  value={loadType}
                  onChange={(e) => { setLoadType(e.target.value as PriceQuoteLoadType); invalidateQuote() }}
                  className={INPUT}
                >
                  {LOAD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Field>
            </div>
            <Field id="weight_kg" label="Weight (kg)">
              <input
                id="weight_kg"
                type="number"
                min="1"
                value={weightKg}
                onChange={(e) => { setWeightKg(e.target.value); invalidateQuote() }}
                placeholder="5000"
                className={`${INPUT} tabular-nums`}
              />
            </Field>

            <div className="pt-1">
              <button type="button" onClick={handleGetQuote} disabled={quoting} className={`${SECONDARY_BTN} w-full`}>
                {quoting ? 'Getting price…' : quote ? 'Refresh quote' : 'Get quote'}
              </button>

              {quoteError && <div className="mt-3"><ErrorNote message={quoteError} /></div>}

              {quote && (
                <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-semibold text-gray-900">
                      {priceQuoteHeading(quote, bookingType)}
                    </span>
                    <span className="text-lg font-bold text-emerald-700 tabular-nums">{inr(quote.quoted_price)}</span>
                  </div>
                  {kind === 'advisory' && (
                    <span className="mt-1 inline-block text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                      Reference, not binding
                    </span>
                  )}
                  <dl className="mt-3 space-y-1 text-xs text-gray-600">
                    <Line label="Distance (est.)" value={`${quote.breakdown.distance_km} km`} />
                    <Line label="Fuel" value={inr(quote.breakdown.fuel_cost)} />
                    <Line label="Driver wage" value={inr(quote.breakdown.driver_wage)} />
                    <Line label="Per-km operating" value={inr(quote.breakdown.per_km_operating_cost)} />
                    <Line label="Handling" value={inr(quote.breakdown.handling)} />
                    <Line label="Platform fee" value={inr(quote.platform_fee)} />
                    <Line label="Vehicle class" value={quote.breakdown.vehicle_class} />
                  </dl>
                  <p className="mt-3 text-[11px] text-gray-500">
                    {priceQuoteBasis(quote, bookingType)}{' '}
                    {kind === 'advisory' ? 'Estimate' : 'Price'} valid until{' '}
                    {new Date(quote.expires_at).toLocaleString('en-IN')}.
                  </p>
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Schedule */}
        <Card>
          <CardHead title="Schedule" />
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field id="pickup_date" label="Pickup date">
                <input
                  id="pickup_date"
                  type="date"
                  value={pickupDate}
                  onChange={(e) => setPickupDate(e.target.value)}
                  className={INPUT}
                />
              </Field>
              <Field id="pickup_time_slot" label="Time slot (optional)">
                <input
                  id="pickup_time_slot"
                  value={pickupTimeSlot}
                  onChange={(e) => setPickupTimeSlot(e.target.value)}
                  placeholder="9 AM – 12 PM"
                  className={INPUT}
                />
              </Field>
            </div>
            <Field id="special_instructions" label="Special instructions (optional)">
              <textarea
                id="special_instructions"
                rows={3}
                value={specialInstructions}
                onChange={(e) => setSpecialInstructions(e.target.value)}
                placeholder="Any special handling requirements…"
                className={`${INPUT} resize-y`}
              />
            </Field>
          </div>
        </Card>

        {/* Marketplace routing */}
        <Card>
          <CardHead title="How to fill it" />
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TypeToggle
                active={bookingType === 'auction'}
                onClick={() => changeBookingType('auction')}
                title="Auction"
                hint="Open to all carriers — they bid, you pick."
              />
              <TypeToggle
                active={bookingType === 'direct'}
                onClick={() => changeBookingType('direct')}
                title="Direct"
                hint={isDistributor ? 'Carry it with your own fleet.' : 'Sent to one specific driver.'}
              />
            </div>

            {bookingType === 'direct' && (
              isDistributor ? (
                <div>
                  <label className="block text-xs text-gray-400 uppercase tracking-wide mb-2">Carry it with your fleet</label>
                  <FleetPairPicker value={fleetPair} onChange={setFleetPair} />
                </div>
              ) : (
                <Field id="target_driver_id" label="Target driver ID">
                  <input
                    id="target_driver_id"
                    value={targetDriverId}
                    onChange={(e) => setTargetDriverId(e.target.value)}
                    placeholder="UUID of the driver"
                    className={`${INPUT} font-mono`}
                  />
                </Field>
              )
            )}

            {bookingType === 'auction' && (
              <Field id="auction_deadline" label="Auction deadline (optional)">
                <input
                  id="auction_deadline"
                  type="datetime-local"
                  value={auctionDeadline}
                  onChange={(e) => setAuctionDeadline(e.target.value)}
                  className={INPUT}
                />
              </Field>
            )}
          </div>
        </Card>

        {formError && (
          <div className="space-y-2">
            <ErrorNote message={formError} />
            {gstinBlocked && (
              <p className="text-sm text-gray-700">
                <Link href="/settings" className="font-semibold text-blue-600 hover:underline">
                  Open Settings → Your GSTIN
                </Link>
                {' '}to add it, then try posting again.
              </p>
            )}
          </div>
        )}

        <button type="submit" disabled={submitting || !quote} className={`${PRIMARY_BTN} w-full`}>
          {submitting ? 'Posting…' : quote ? 'Post load' : 'Get a quote to continue'}
        </button>
      </form>
    </div>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className="tabular-nums text-gray-900">{value}</dd>
    </div>
  )
}

function TypeToggle({
  active, onClick, title, hint,
}: { active: boolean; onClick: () => void; title: string; hint: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border p-3 text-left transition-colors ${
        active ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-100' : 'border-gray-200 hover:bg-gray-50'
      }`}
    >
      <p className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
        {active && <PackagePlus className="w-3.5 h-3.5 text-blue-600" />}
        {title}
      </p>
      <p className="text-xs text-gray-500 mt-0.5">{hint}</p>
    </button>
  )
}

function Field({
  id, label, hint, children,
}: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="text-xs text-gray-400 uppercase tracking-wide">{label}</label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  )
}
