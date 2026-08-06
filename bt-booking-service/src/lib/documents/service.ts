// ============================================================
// src/lib/documents/service.ts
//
// Responsibility: who may issue which document on a booking, what the platform
// fills in itself, and what it will accept from a client.
//
// 🔴 THE CONTROL THIS FILE EXISTS FOR (red line 1, §1.3): the ISSUER of an LR is
// derived from the BOOKING and the AUTHENTICATED ACTOR — never from the request
// body. A caller cannot name the party a document is issued by, and in particular
// cannot make BharatTruck the named issuer, because there is no code path that
// reads an issuer identity off the wire. The platform is never a party; it holds
// the pen for the carrier, and the carrier's own series numbers the document.
//
// The second control is §11.4: the invoice number, the invoice value and the
// e-way bill number printed on an LR are READ FROM OUR OWN ROWS, not accepted
// from the caller. On paper a booking clerk retypes them and they drift — one
// specimen pair is out by ₹63,776 on a hand-keyed invoice value, and consignment
// value drives the e-way bill threshold, so that is not a clerical matter.
// Generating both documents is what removes the entire class of error, and
// removing it means refusing to take the number from a human.
// ============================================================

import { z } from 'zod'
import { BookingError, type AuthenticatedUser } from '../types.js'
import * as repo from '../repository.js'
import { getFleetOwnerByUserId } from '../fleet.js'
import { supabase } from '../supabase.js'
import * as docs from './repository.js'
import {
  chargedWeightKg,
  consignmentValueInr,
  ewayBillExpiry,
  lrChargeTotalInr,
  roundInr,
  SERIES_PREFIX_PATTERN,
  type DocumentIssuerKind,
  type EwayBillExpiry,
} from './rules.js'

// -----------------------------------------------------------
// Request schemas. Money and weights are validated here so an invalid document
// is rejected with a sentence the user can act on, before a serial is allocated
// against it — a rejected allocation rolls back cleanly, but not allocating at
// all is cheaper and leaves nothing to explain.
// -----------------------------------------------------------

const money = z.number().nonnegative().finite()
const stateCode = z.string().regex(/^\d{2}$/, 'state code must be the two-digit GST state code')
const seriesPrefix = z.string().regex(SERIES_PREFIX_PATTERN, 'series prefix: max 4 chars, [A-Za-z0-9-] only')

export const IssueLorryReceiptBodySchema = z.object({
  // Per-owner series prefix, frozen on the first document of the financial year.
  series_prefix:         seriesPrefix.optional(),

  consignor_name:        z.string().min(1),
  consignor_gstin:       z.string().optional(),
  consignor_pan:         z.string().optional(),
  consignor_address:     z.string().optional(),
  consignee_name:        z.string().min(1),
  consignee_gstin:       z.string().optional(),
  consignee_address:     z.string().optional(),

  origin_place:          z.string().min(1),
  destination_place:     z.string().min(1),
  // Rule 46(o) — the delivery address where it differs from the place of supply.
  // This, not the billing address, is what the POD geofence targets (§5.4).
  delivery_address:      z.string().optional(),

  vehicle_number:        z.string().optional(),
  articles_count:        z.number().int().positive().optional(),

  // §11.2. The caller states what was weighed and what the cargo cubes out at;
  // the CHARGED weight is computed, never accepted — see below.
  actual_weight_kg:      z.number().positive().finite(),
  volumetric_weight_kg:  z.number().positive().finite().optional(),

  rate_inr:              money.optional(),
  rate_type:             z.string().optional(),
  // Printed under "(said to contain)" — the carrier never opens the packaging,
  // so the description is the consignor's assertion and is labelled as one.
  said_to_contain:       z.string().min(1),

  freight_charge_inr:    money,
  stationary_charge_inr: money.optional(),
  handling_charge_inr:   money.optional(),
  other_charge_inr:      money.optional(),

  freight_term:          z.enum(['PAID', 'TO_PAY', 'TO_BE_BILLED']),
  delivery_mode:         z.enum(['GODOWN', 'DOOR']).optional(),
  loading_by:            z.enum(['consignor', 'consignee']).optional(),
  unloading_by:          z.enum(['consignor', 'consignee']).optional(),

  place_of_supply_state: z.string().optional(),
  place_of_supply_code:  stateCode.optional(),
  reverse_charge:        z.boolean().optional(),
  carriage_risk:         z.enum(['owners_risk', 'carriers_risk']).optional(),

  // Issuer facts the platform does not hold for a solo owner-driver. Accepted
  // ONLY as attributes of the issuer the booking already determines — they can
  // never change WHO the issuer is.
  issuer_transporter_id: z.string().optional(),
  issuer_pan:            z.string().optional(),
  issuer_address:        z.string().optional(),
})

export type IssueLorryReceiptBody = z.infer<typeof IssueLorryReceiptBodySchema>

export const IssueInvoiceBodySchema = z.object({
  series_prefix:         seriesPrefix.optional(),

  supplier_legal_name:   z.string().min(1).optional(),
  supplier_gstin:        z.string().optional(),
  supplier_address:      z.string().optional(),

  billed_to_name:        z.string().min(1),
  billed_to_gstin:       z.string().optional(),
  billed_to_address:     z.string().optional(),
  billed_to_state:       z.string().optional(),
  billed_to_state_code:  stateCode.optional(),
  shipped_to_name:       z.string().optional(),
  shipped_to_gstin:      z.string().optional(),
  shipped_to_address:    z.string().optional(),
  shipped_to_state:      z.string().optional(),
  shipped_to_state_code: stateCode.optional(),

  place_of_supply_state: z.string().optional(),
  place_of_supply_code:  stateCode.optional(),
  reverse_charge:        z.boolean().optional(),

  taxable_value_inr:     money,
  cgst_inr:              money.optional(),
  sgst_inr:              money.optional(),
  utgst_inr:             money.optional(),
  igst_inr:              money.optional(),
  cess_inr:              money.optional(),
  // Subtracted from consignment value ONLY on an invoice covering exempt and
  // taxable goods together (Rule 138 Explanation 2).
  exempt_value_inr:      money.optional(),
  tcs_inr:               money.optional(),
  round_off_inr:         z.number().finite().optional(),

  // E-invoice fields (D-18). Recorded, never generated — an IRN can only come
  // from the IRP, and its presence changes which e-way bill path is legal (§11.5).
  irn:                   z.string().regex(/^[0-9a-fA-F]{64}$/, 'IRN must be a 64-character hex hash').optional(),
  ack_no:                z.string().optional(),
  ack_date:              z.string().datetime().optional(),
})

export type IssueInvoiceBody = z.infer<typeof IssueInvoiceBodySchema>

export const RecordEwayBillBodySchema = z.object({
  ewb_number:      z.string().regex(/^\d{12}$/, 'e-way bill number is 12 digits'),
  generated_at:    z.string().datetime(),
  // 🔴 REQUIRED, and never computed. §4.4: a day of validity expires at midnight
  // of the day FOLLOWING generation, so a bill raised at 23:55 has ~24h and one
  // raised at 00:05 has ~48h from the identical allowance. Deriving it locally
  // would tell a driver they are covered while the bill is dead. Copy the
  // portal's figure or record nothing.
  valid_upto:      z.string().datetime(),
  issuing_portal:  z.enum(['NIC1', 'NIC2']),
  // §4.5 / Rule 138(5A): once Part B is entered the consignment cannot be
  // reassigned to another transporter. Capturing the moment is what will let the
  // booking flow refuse a carrier swap instead of desyncing from the EWB system.
  part_b_entered_at: z.string().datetime().optional(),
  document_number: z.string().regex(/^[A-Za-z0-9/-]{1,16}$/, 'document number must satisfy Rule 46(b)').optional(),
  document_uri:    z.string().url().optional(),
  // Fallback only — the invoice's own GST-inclusive value wins when we have one.
  consignment_value_inr: money.optional(),
})

export type RecordEwayBillBody = z.infer<typeof RecordEwayBillBodySchema>

// -----------------------------------------------------------
// Party resolution.
//
// The carrier on a booking is a fleet when fleet_owner_id is set and the solo
// driver otherwise — the same discriminator the rest of this service uses. Both
// issue LRs under their OWN GSTIN/TRANSIN and their own series; a solo
// owner-driver is not "the platform's driver", they are a carrier with one truck.
// -----------------------------------------------------------

type LrIssuer = {
  kind: Extract<DocumentIssuerKind, 'fleet_owner' | 'driver'>
  id: string
  legalName: string
  transporterId: string | null
  pan: string | null
  address: string | null
}

async function resolveLrIssuer(
  booking: { id: string; driver_id: string | null; fleet_owner_id: string | null },
  actor: AuthenticatedUser,
): Promise<LrIssuer> {
  if (booking.fleet_owner_id) {
    const owner = await getFleetOwnerByUserId(actor.userId)
    if (!owner || owner.id !== booking.fleet_owner_id) {
      throw new BookingError('Only the carrier on this booking can issue its consignment note', 'FORBIDDEN', 403)
    }
    // Identity read from the fleet's own row, not the request. company_name is
    // the name that gets printed as the issuer.
    const { data } = await supabase
      .from('fleet_owners')
      .select('company_name, gstin, pan, billing_address')
      .eq('id', owner.id)
      .maybeSingle()

    return {
      kind: 'fleet_owner',
      id: owner.id,
      legalName: data?.company_name ?? 'Carrier',
      transporterId: data?.gstin ?? null,
      pan: data?.pan ?? null,
      address: data?.billing_address ?? null,
    }
  }

  const driverRow = await repo.getDriverByUserId(actor.userId)
  if (!driverRow || !booking.driver_id || driverRow.id !== booking.driver_id) {
    throw new BookingError('Only the carrier on this booking can issue its consignment note', 'FORBIDDEN', 403)
  }
  const { data } = await supabase
    .from('users')
    .select('full_name')
    .eq('id', actor.userId)
    .maybeSingle()

  return {
    kind: 'driver',
    id: driverRow.id,
    legalName: data?.full_name ?? 'Owner-driver',
    transporterId: null,
    pan: null,
    address: null,
  }
}

async function loadBookingOr404(bookingId: string) {
  const booking = await repo.getBookingById(bookingId)
  if (!booking) throw new BookingError(`Booking ${bookingId} not found`, 'NOT_FOUND', 404)
  return booking
}

/**
 * Read access to a booking's documents: the shipper, the assigned driver, the
 * fleet that won it, and ops. Same shape as every other per-booking read in this
 * service — the consignee is NOT here, because their access is the emailed
 * document itself (§5.6: the receiver path assumes zero app installation).
 */
async function assertCanReadDocuments(
  booking: { shipper_id: string; driver_id: string | null; fleet_owner_id: string | null },
  actor: AuthenticatedUser,
): Promise<void> {
  if (actor.role === 'admin') return
  if (actor.role === 'shipper' && booking.shipper_id === actor.userId) return

  if (actor.role === 'driver' && booking.driver_id) {
    const driverRow = await repo.getDriverByUserId(actor.userId)
    if (driverRow && driverRow.id === booking.driver_id) return
  }

  if (actor.role === 'fleet_owner' && booking.fleet_owner_id) {
    const owner = await getFleetOwnerByUserId(actor.userId)
    if (owner && owner.id === booking.fleet_owner_id) return
  }

  throw new BookingError('You cannot view documents for this booking', 'FORBIDDEN', 403)
}

// -----------------------------------------------------------
// issueLorryReceipt
// -----------------------------------------------------------

export async function issueLorryReceipt(
  bookingId: string,
  body: IssueLorryReceiptBody,
  actor: AuthenticatedUser,
) {
  const booking = await loadBookingOr404(bookingId)

  // A consignment note transfers the lien on the goods and makes the carrier
  // responsible for them until safe delivery (CBIC Flyer 38). Issuing one before
  // a carrier has been awarded the load would assert that transfer with nobody on
  // the other end of it.
  if (!booking.driver_id && !booking.fleet_owner_id) {
    throw new BookingError(
      'A consignment note can only be issued once a carrier is assigned to the booking',
      'INVALID_TRANSITION',
      409,
    )
  }

  const issuer = await resolveLrIssuer(booking, actor)

  // §11.4 — the linkage fields come from OUR rows. Never from the request.
  // invoice_value is the GST-INCLUSIVE consignment value, because that is the
  // figure the e-way bill threshold is measured against (§4.1).
  const invoice = await docs.getFreightInvoice(bookingId)
  const ewbs = await docs.listEwayBills(bookingId)

  const chargedKg = chargedWeightKg(body.actual_weight_kg, body.volumetric_weight_kg)

  const payload = {
    issuer_legal_name:     issuer.legalName,
    issuer_transporter_id: issuer.transporterId ?? body.issuer_transporter_id ?? null,
    issuer_pan:            issuer.pan ?? body.issuer_pan ?? null,
    issuer_address:        issuer.address ?? body.issuer_address ?? null,

    consignor_name:    body.consignor_name,
    consignor_gstin:   body.consignor_gstin ?? null,
    consignor_pan:     body.consignor_pan ?? null,
    consignor_address: body.consignor_address ?? null,
    consignee_name:    body.consignee_name,
    consignee_gstin:   body.consignee_gstin ?? null,
    consignee_address: body.consignee_address ?? null,

    origin_place:      body.origin_place,
    destination_place: body.destination_place,
    delivery_address:  body.delivery_address ?? null,

    vehicle_number: body.vehicle_number ?? null,
    articles_count: body.articles_count ?? null,

    actual_weight_kg:  body.actual_weight_kg,
    charged_weight_kg: chargedKg,
    rate_inr:          body.rate_inr ?? null,
    rate_type:         body.rate_type ?? null,
    said_to_contain:   body.said_to_contain,

    freight_charge_inr:    roundInr(body.freight_charge_inr),
    stationary_charge_inr: roundInr(body.stationary_charge_inr ?? 0),
    handling_charge_inr:   roundInr(body.handling_charge_inr ?? 0),
    other_charge_inr:      roundInr(body.other_charge_inr ?? 0),

    freight_term:  body.freight_term,
    delivery_mode: body.delivery_mode ?? null,
    loading_by:    body.loading_by ?? null,
    unloading_by:  body.unloading_by ?? null,

    place_of_supply_state: body.place_of_supply_state ?? null,
    place_of_supply_code:  body.place_of_supply_code ?? null,
    reverse_charge:        body.reverse_charge ?? true,
    carriage_risk:         body.carriage_risk ?? 'owners_risk',

    invoice_number:    invoice?.invoice_number ?? null,
    invoice_value_inr: invoice ? Number(invoice.consignment_value_inr) : null,
    eway_bill_number:  ewbs[0]?.ewb_number ?? null,
  }

  const lr = await docs.issueLorryReceipt({
    bookingId,
    issuerKind: issuer.kind,
    issuerId:   issuer.id,
    prefix:     body.series_prefix ?? null,
    payload,
  })

  return {
    ...lr,
    // Convenience for the caller: the same total the DB generated, so a client
    // never has to add the charge lines up itself and get a different answer.
    charges_total_inr: lrChargeTotalInr({
      freightInr:    payload.freight_charge_inr,
      stationaryInr: payload.stationary_charge_inr,
      handlingInr:   payload.handling_charge_inr,
      otherInr:      payload.other_charge_inr,
    }),
  }
}

// -----------------------------------------------------------
// issueFreightInvoice — the SHIPPER's document, on the SHIPPER's series.
// -----------------------------------------------------------

export async function issueFreightInvoice(
  bookingId: string,
  body: IssueInvoiceBody,
  actor: AuthenticatedUser,
) {
  const booking = await loadBookingOr404(bookingId)

  if (actor.role !== 'shipper' || booking.shipper_id !== actor.userId) {
    throw new BookingError('Only the shipper on this booking can issue its invoice', 'FORBIDDEN', 403)
  }

  // §4.1, computed here so the caller cannot supply a total that disagrees with
  // its own parts. The DB recomputes the same formula as a generated column —
  // this copy exists to put the number in the response and, more importantly, in
  // the e-way bill decision below.
  const consignmentValue = consignmentValueInr({
    taxableValueInr: body.taxable_value_inr,
    cgstInr:  body.cgst_inr,
    sgstInr:  body.sgst_inr,
    utgstInr: body.utgst_inr,
    igstInr:  body.igst_inr,
    cessInr:  body.cess_inr,
    exemptValueInr: body.exempt_value_inr,
  })

  // TCS (s.206C(1H)) and the round-off move the money owed but are NOT part of
  // consignment value — they sit outside the Rule 138 formula, which is why they
  // are added here and not inside consignmentValueInr.
  const grandTotal = roundInr(consignmentValue + (body.tcs_inr ?? 0) + (body.round_off_inr ?? 0))

  const { data: supplier } = await supabase
    .from('users')
    .select('full_name')
    .eq('id', actor.userId)
    .maybeSingle()

  const lr = await docs.getLorryReceipt(bookingId)
  const ewbs = await docs.listEwayBills(bookingId)

  const invoice = await docs.issueFreightInvoice({
    bookingId,
    supplierUserId: actor.userId,
    prefix: body.series_prefix ?? null,
    payload: {
      supplier_legal_name: body.supplier_legal_name ?? supplier?.full_name ?? 'Supplier',
      supplier_gstin:      body.supplier_gstin ?? null,
      supplier_address:    body.supplier_address ?? null,

      billed_to_name:        body.billed_to_name,
      billed_to_gstin:       body.billed_to_gstin ?? null,
      billed_to_address:     body.billed_to_address ?? null,
      billed_to_state:       body.billed_to_state ?? null,
      billed_to_state_code:  body.billed_to_state_code ?? null,
      shipped_to_name:       body.shipped_to_name ?? null,
      shipped_to_gstin:      body.shipped_to_gstin ?? null,
      shipped_to_address:    body.shipped_to_address ?? null,
      shipped_to_state:      body.shipped_to_state ?? null,
      shipped_to_state_code: body.shipped_to_state_code ?? null,

      place_of_supply_state: body.place_of_supply_state ?? null,
      place_of_supply_code:  body.place_of_supply_code ?? null,
      reverse_charge:        body.reverse_charge ?? false,

      taxable_value_inr: roundInr(body.taxable_value_inr),
      cgst_inr:          roundInr(body.cgst_inr ?? 0),
      sgst_inr:          roundInr(body.sgst_inr ?? 0),
      utgst_inr:         roundInr(body.utgst_inr ?? 0),
      igst_inr:          roundInr(body.igst_inr ?? 0),
      cess_inr:          roundInr(body.cess_inr ?? 0),
      exempt_value_inr:  roundInr(body.exempt_value_inr ?? 0),
      tcs_inr:           roundInr(body.tcs_inr ?? 0),
      round_off_inr:     roundInr(body.round_off_inr ?? 0),
      grand_total_inr:   grandTotal,

      lr_number:        lr?.lr_number ?? null,
      eway_bill_number: ewbs[0]?.ewb_number ?? null,

      irn:      body.irn ?? null,
      ack_no:   body.ack_no ?? null,
      ack_date: body.ack_date ?? null,
    },
  })

  return invoice
}

// -----------------------------------------------------------
// recordEwayBill — D-17. We record theirs; we generate nothing.
// -----------------------------------------------------------

export async function recordEwayBill(
  bookingId: string,
  body: RecordEwayBillBody,
  actor: AuthenticatedUser,
) {
  const booking = await loadBookingOr404(bookingId)
  // Either party may hold the paper: the shipper usually raises Part A, the
  // carrier enters Part B. Whoever has it in their hand should be able to file it.
  await assertCanReadDocuments(booking, actor)

  if (new Date(body.valid_upto).getTime() <= new Date(body.generated_at).getTime()) {
    throw new BookingError('valid_upto must be after generated_at', 'VALIDATION_ERROR', 400)
  }

  const invoice = await docs.getFreightInvoice(bookingId)

  const record = await docs.recordEwayBill({
    bookingId,
    ewbNumber:     body.ewb_number,
    generatedAt:   body.generated_at,
    validUpto:     body.valid_upto,
    issuingPortal: body.issuing_portal,
    partBEnteredAt: body.part_b_entered_at ?? null,
    documentNumber: body.document_number ?? invoice?.invoice_number ?? null,
    // Our own invoice's GST-inclusive value beats anything typed in, for the
    // same reason as the LR linkage above.
    consignmentValueInr: invoice ? Number(invoice.consignment_value_inr) : (body.consignment_value_inr ?? null),
    documentUri: body.document_uri ?? null,
    recordedBy:  actor.userId,
  })

  return withExpiry(record)
}

// -----------------------------------------------------------
// getBookingDocuments — the read side.
// -----------------------------------------------------------

export type BookingDocuments = {
  booking_id: string
  lorry_receipt: docs.DbLorryReceipt | null
  invoice: docs.DbFreightInvoice | null
  eway_bills: Array<docs.DbEwayBillRecord & { expiry: EwayBillExpiry }>
}

export async function getBookingDocuments(
  bookingId: string,
  actor: AuthenticatedUser,
): Promise<BookingDocuments> {
  const booking = await loadBookingOr404(bookingId)
  await assertCanReadDocuments(booking, actor)

  const [lr, invoice, ewbs] = await Promise.all([
    docs.getLorryReceipt(bookingId),
    docs.getFreightInvoice(bookingId),
    docs.listEwayBills(bookingId),
  ])

  return {
    booking_id: bookingId,
    lorry_receipt: lr,
    invoice,
    eway_bills: ewbs.map(withExpiry),
  }
}

/**
 * Attaches the expiry verdict computed from the STORED valid_upto (§9.3's 4-day
 * alert window). The verdict is derived; the deadline never is.
 */
function withExpiry(record: docs.DbEwayBillRecord): docs.DbEwayBillRecord & { expiry: EwayBillExpiry } {
  return { ...record, expiry: ewayBillExpiry(record.valid_upto) }
}
