// ============================================================
// src/lib/documents/rules.ts
//
// Responsibility: the compliance ARITHMETIC and FORMAT rules behind the freight
// documents — nothing here touches Postgres, Fastify or an actor. Every rule in
// this file is a restatement of a specific provision, and each one exists
// because getting it wrong is a detention, a rejected document or a tax event
// rather than a bug report. Citations are to docs/INDIA_FREIGHT_COMPLIANCE.md.
//
// WHAT IS DELIBERATELY NOT HERE:
//   - Number ALLOCATION. The gapless per-owner counter lives in migration 0024
//     (allocate_document_number) because it has to share a transaction with the
//     INSERT of the document, and supabase-js has no transactions at all. A
//     read-then-write in Node would hand two concurrent bookings the same LR
//     number. This file only knows how to SHAPE and CHECK a number.
//   - Any recomputation of an e-way bill's validity. See ewayBillExpiry.
//   - The intra-state threshold table (§4.2). It is effective-dated, per-state
//     and partly contested; a constant would be a wrong answer with a confident
//     face. Only the inter-state figure — which no state may vary — is here.
// ============================================================

// -----------------------------------------------------------
// Enums shared with the DB (migration 0024). Kept as string unions rather than
// TS enums so the wire value IS the value — these are printed on a document.
// -----------------------------------------------------------

/**
 * §5.8. "To Pay" is not a note on an invoice, it is the informal sector's
 * built-in escrow: the consignee pays before the goods are released and the
 * carrier's Contract Act s.170 lien is the leverage. A POD flow that marks
 * delivered-and-released without recording payment removes the only leverage a
 * small operator has, which is why this is an enum on the document.
 */
export type FreightTerm = 'PAID' | 'TO_PAY' | 'TO_BE_BILLED'

/** GODOWN = consignee collects from the destination branch; DOOR = we deliver. */
export type DeliveryMode = 'GODOWN' | 'DOOR'

/** §4.8. Portal affinity: a bill raised on NIC1 cannot be cancelled on NIC2. */
export type EwbPortal = 'NIC1' | 'NIC2'

/** Who owns a document series. Mirrors public.document_issuer_kind. */
export type DocumentIssuerKind = 'fleet_owner' | 'driver' | 'shipper'

// -----------------------------------------------------------
// Document numbers — CGST Rule 46(b).
//
// ≤16 characters, alphanumerics + hyphen + slash ONLY, consecutive, unique per
// owner per financial year. §3.3 calls out putting a uuid or a 20-char slug in
// this field as a common bug in logistics SaaS; the specimens in §11.1 show what
// real operators actually print ('2026-27/11', 'MA/4135/2526').
//
// The same regex is a CHECK constraint on every number column in 0024. Two
// copies on purpose: this one gives the user a 400 with a sentence they can act
// on, the DB one guarantees no other code path can ever get past it.
// -----------------------------------------------------------

export const MAX_GST_DOCUMENT_NUMBER_LENGTH = 16

export const GST_DOCUMENT_NUMBER_PATTERN = /^[A-Za-z0-9/-]{1,16}$/

export function isGstDocumentNumber(value: string): boolean {
  return GST_DOCUMENT_NUMBER_PATTERN.test(value)
}

/**
 * Series prefix rules. Capped at 4 characters and to the Rule 46(b) charset
 * MINUS the slash (the formatter supplies the separator), so the assembled
 * number cannot run past 16: 4 + '/' + 7 (FY) + '/' still leaves 3 digits of
 * serial, and 8 digits when there is no prefix at all.
 */
export const SERIES_PREFIX_PATTERN = /^[A-Za-z0-9-]{1,4}$/

/** Indian FY label as printed inside the number, e.g. '2026-27'. */
export const FINANCIAL_YEAR_PATTERN = /^\d{4}-\d{2}$/

/**
 * Assemble `[PREFIX/]<FY>/<serial>` — the Destinio specimen's shape when there
 * is no prefix, the Maru specimen's when there is.
 *
 * Throws rather than truncating on overflow. A truncated number is a DIFFERENT
 * number: it collides with an earlier one in the same series, which is the one
 * failure mode the whole numbering design exists to prevent. The DB allocator
 * makes the same check for the same reason, and there the failure rolls the
 * counter back so no serial is burnt.
 */
export function formatDocumentNumber(input: {
  financialYear: string
  serial: number
  prefix?: string | null
}): string {
  const { financialYear, serial, prefix } = input

  if (!FINANCIAL_YEAR_PATTERN.test(financialYear)) {
    throw new Error(`Invalid financial year label '${financialYear}' (expected e.g. 2026-27)`)
  }
  if (!Number.isInteger(serial) || serial < 1) {
    throw new Error(`Invalid document serial ${serial} — a Rule 46(b) series starts at 1`)
  }
  if (prefix != null && !SERIES_PREFIX_PATTERN.test(prefix)) {
    throw new Error(`Invalid series prefix '${prefix}' (max 4 chars, [A-Za-z0-9-] only)`)
  }

  const number = `${prefix ? `${prefix}/` : ''}${financialYear}/${serial}`

  if (!isGstDocumentNumber(number)) {
    throw new Error(
      `Document number '${number}' violates Rule 46(b) ` +
      `(max ${MAX_GST_DOCUMENT_NUMBER_LENGTH} chars, [A-Za-z0-9/-] only)`,
    )
  }
  return number
}

// -----------------------------------------------------------
// Indian financial year — 1 April to 31 March, evaluated in IST.
//
// The timezone is load-bearing, not pedantry. A document issued at
// 2026-03-31 23:00 UTC is 2026-04-01 04:30 in Kolkata and belongs to FY 2026-27.
// Deriving the year from a UTC date puts the first documents of every April back
// into a series that was already closed on 31 March — i.e. it reissues numbers.
//
// A fixed +05:30 offset rather than Intl: India has never observed daylight
// saving, so the offset is a constant, and a constant cannot depend on which ICU
// data the Node image happens to ship with.
// -----------------------------------------------------------

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000

export function financialYearOf(at: Date = new Date()): string {
  const ist = new Date(at.getTime() + IST_OFFSET_MS)
  // getUTC* on the shifted instant reads the IST wall clock.
  const month = ist.getUTCMonth() + 1 // 1-12
  const startYear = month >= 4 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1
  const tail = String((startYear + 1) % 100).padStart(2, '0')
  return `${startYear}-${tail}`
}

// -----------------------------------------------------------
// Weight — §11.2, the thing a statute-only reading misses.
//
// Freight bills on the CHARGED weight, which is max(actual, volumetric). Light
// bulky cargo is the normal case, not the exception, so a schema (or a
// calculation) carrying one weight cannot reproduce a real freight bill. The
// actual weight is separately load-bearing: Carriage by Road Act s.9 makes the
// weight on the goods receipt PRIMA FACIE EVIDENCE in a shortage claim.
// -----------------------------------------------------------

export function chargedWeightKg(actualKg: number, volumetricKg?: number | null): number {
  if (!(actualKg > 0)) throw new Error('actual weight must be positive')
  if (volumetricKg == null) return actualKg
  if (!(volumetricKg > 0)) throw new Error('volumetric weight must be positive when supplied')
  return Math.max(actualKg, volumetricKg)
}

// -----------------------------------------------------------
// Charges — §11.2. Freight + stationary + hamali/handling summing to a total,
// never one lump figure. The consignee disputes hamali far more often than
// freight, and a single number makes that dispute unanswerable.
//
// The DB stores total_charge_inr as a GENERATED column over the same four
// fields, so this function and the stored total cannot drift; it exists so the
// caller can show the total before the row is written.
// -----------------------------------------------------------

export type LrCharges = {
  freightInr: number
  stationaryInr?: number
  handlingInr?: number
  otherInr?: number
}

export function lrChargeTotalInr(charges: LrCharges): number {
  const parts = [
    charges.freightInr,
    charges.stationaryInr ?? 0,
    charges.handlingInr ?? 0,
    charges.otherInr ?? 0,
  ]
  for (const p of parts) {
    if (!Number.isFinite(p) || p < 0) throw new Error('charge lines must be finite and non-negative')
  }
  return roundInr(parts.reduce((a, b) => a + b, 0))
}

// -----------------------------------------------------------
// Consignment value — Rule 138 Explanation 2, §4.1.
//
//     consignment_value = section 15 value
//                       + CGST + SGST + UTGST + IGST + cess   <- INCLUDED
//                       - exempt component                    <- mixed invoice only
//
// 🔴 THE VALUE INCLUDES GST. ₹48,000 + 5% = ₹50,400, which is over the ₹50,000
// line and needs an e-way bill; thresholding on the ₹48,000 taxable value says
// it does not, and the truck moves without one. That is a s.129 detention, which
// is 100%/200% of tax territory, not a ₹1,000 penalty.
//
// The exempt component is subtracted ONLY where one invoice covers exempt and
// taxable goods together — hence a defaulted, explicitly named input rather than
// a general "deductions" bag someone would reach for.
// -----------------------------------------------------------

export type ConsignmentValueInput = {
  taxableValueInr: number
  cgstInr?: number
  sgstInr?: number
  utgstInr?: number
  igstInr?: number
  cessInr?: number
  /** Only on a mixed exempt+taxable invoice. Zero everywhere else. */
  exemptValueInr?: number
}

export function consignmentValueInr(input: ConsignmentValueInput): number {
  const {
    taxableValueInr,
    cgstInr = 0, sgstInr = 0, utgstInr = 0, igstInr = 0, cessInr = 0,
    exemptValueInr = 0,
  } = input

  for (const [name, v] of Object.entries({
    taxableValueInr, cgstInr, sgstInr, utgstInr, igstInr, cessInr, exemptValueInr,
  })) {
    if (!Number.isFinite(v) || v < 0) throw new Error(`${name} must be finite and non-negative`)
  }

  return roundInr(
    taxableValueInr + cgstInr + sgstInr + utgstInr + igstInr + cessInr - exemptValueInr,
  )
}

/**
 * Rule 138(1): required where consignment value EXCEEDS ₹50,000 — strictly
 * greater than, so an exactly-₹50,000 consignment does not need one.
 *
 * INTER-STATE ONLY, and that is the whole reason this constant is allowed to
 * exist: §4.2 confirms the inter-state figure is ₹50,000 everywhere and no state
 * may vary it. Intra-state is a different question with a per-state,
 * effective-dated, partly contested answer (Rajasthan ₹2,00,000 intra-city, MP
 * none intra-district, Goa only for 22 goods…). That table is NOT in this slice
 * and must not be faked with this constant.
 */
export const INTER_STATE_EWB_THRESHOLD_INR = 50_000

export function interStateEwayBillRequired(consignmentValue: number): boolean {
  return consignmentValue > INTER_STATE_EWB_THRESHOLD_INR
}

// -----------------------------------------------------------
// E-way bill expiry — §4.4.
//
// 🔴 THE VALIDITY IS GIVEN TO US, NEVER DERIVED. Explanation 1 to Rule 138(10):
// each day of validity expires at midnight of the day IMMEDIATELY FOLLOWING
// generation. So a bill raised at 23:55 has about 24 hours of life and one
// raised at 00:05 has about 48 — from the same "1 day" allowance. Any local
// `generated_at + n days` gets the second case wrong by a full day in the
// dangerous direction: we would tell a driver they are covered while the bill is
// already dead. There is deliberately no function in this module that computes a
// valid_upto, and no default or trigger on the column that stores it.
//
// What we DO own is the alert. §9.3: replicate the portal's 4-day window, because
// mid-transit expiry is the most common cause of detention.
// -----------------------------------------------------------

export const EWB_EXPIRY_ALERT_WINDOW_DAYS = 4

const MS_PER_HOUR = 60 * 60 * 1000

export type EwayBillExpiry = {
  /** 'expired' the instant validity passes — there is no grace period at a checkpoint. */
  state: 'valid' | 'expiring_soon' | 'expired'
  hours_remaining: number
  valid_upto: string
}

export function ewayBillExpiry(
  validUpto: Date | string,
  now: Date = new Date(),
  windowDays: number = EWB_EXPIRY_ALERT_WINDOW_DAYS,
): EwayBillExpiry {
  const upto = validUpto instanceof Date ? validUpto : new Date(validUpto)
  if (Number.isNaN(upto.getTime())) throw new Error(`Invalid valid_upto '${String(validUpto)}'`)

  const msRemaining = upto.getTime() - now.getTime()
  const hours = msRemaining / MS_PER_HOUR

  const state: EwayBillExpiry['state'] =
    msRemaining <= 0 ? 'expired'
      : hours <= windowDays * 24 ? 'expiring_soon'
      : 'valid'

  return {
    state,
    // Rounded to whole hours for display; never rounded UP past the boundary,
    // because "1 hour left" on an expired bill is the worst possible message.
    hours_remaining: msRemaining <= 0 ? 0 : Math.floor(hours),
    valid_upto: upto.toISOString(),
  }
}

// -----------------------------------------------------------
// Money. Every amount on these documents is stored as numeric(_,2); rounding to
// paise here keeps a JS float sum (0.1 + 0.2) from arriving at the DB as a value
// that prints one paisa off the figure the user was shown.
// -----------------------------------------------------------

export function roundInr(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100
}
