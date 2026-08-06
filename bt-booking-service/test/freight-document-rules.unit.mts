/**
 * Freight-document compliance rules.
 *
 * Every check here pins a provision, not a preference. The failure each one
 * prevents is written next to it, because the cost of getting these wrong is not
 * a bug report:
 *
 *   - a uuid in a document-number field is an INVALID GST document (§3.3), and
 *     the doc calls it out as a common bug in logistics SaaS;
 *   - a financial year computed in UTC reissues last year's numbers every April;
 *   - an e-way bill threshold checked on the PRE-TAX value moves a truck without
 *     a bill it needed — a s.129 detention, not a ₹1,000 penalty (§4.1);
 *   - a locally recomputed valid_upto tells a driver they are covered while the
 *     bill is already dead (§4.4, the midnight rule).
 *
 * Pure functions, no Postgres.
 *
 * Run: npx tsx test/freight-document-rules.unit.mts
 */
process.env.JWT_SECRET = 'test-jwt-secret-long-enough-for-hs256-verification'
process.env.SUPABASE_URL = 'http://fake.local'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key'

import * as rules from '../src/lib/documents/rules.js'

let passed = 0
const failures: string[] = []
function check(label: string, ok: boolean) {
  if (ok) { passed++; console.log(`  ✓ ${label}`) }
  else { failures.push(label); console.log(`  ✗ ${label}`) }
}
function throws(label: string, fn: () => unknown) {
  let threw = false
  try { fn() } catch { threw = true }
  check(label, threw)
}

console.log('\n── Rule 46(b): the document-number format')
{
  // The two shapes real operators print (§11.1 specimens).
  check("accepts the Destinio shape '2026-27/11'", rules.isGstDocumentNumber('2026-27/11'))
  check("accepts the Maru shape 'MA/4135/2526'", rules.isGstDocumentNumber('MA/4135/2526'))
  check('accepts exactly 16 characters', rules.isGstDocumentNumber('ABCD/2026-27/999'))

  // The bugs.
  check(
    'REJECTS a uuid — an invalid GST document number',
    !rules.isGstDocumentNumber('11111111-1111-4111-8111-111111111111'),
  )
  check('REJECTS a 20-character slug', !rules.isGstDocumentNumber('LR20260806ABCDEFGHIJ'))
  check('REJECTS 17 characters', !rules.isGstDocumentNumber('ABCDE/2026-27/999'))
  check('REJECTS characters outside [A-Za-z0-9/-]', !rules.isGstDocumentNumber('INV#11'))
  check('REJECTS an underscore', !rules.isGstDocumentNumber('INV_11'))
  check('REJECTS a space', !rules.isGstDocumentNumber('INV 11'))
  check('REJECTS the empty string', !rules.isGstDocumentNumber(''))
  check('16 is the cap', rules.MAX_GST_DOCUMENT_NUMBER_LENGTH === 16)
}

console.log('\n── number assembly')
{
  check(
    'unprefixed series reproduces the specimen shape',
    rules.formatDocumentNumber({ financialYear: '2026-27', serial: 11 }) === '2026-27/11',
  )
  check(
    'a prefix is separated by a slash',
    rules.formatDocumentNumber({ financialYear: '2026-27', serial: 11, prefix: 'MA' }) === 'MA/2026-27/11',
  )
  check(
    'the series starts at 1, not 0',
    rules.formatDocumentNumber({ financialYear: '2026-27', serial: 1 }) === '2026-27/1',
  )
  check(
    'an 8-digit serial still fits unprefixed',
    rules.formatDocumentNumber({ financialYear: '2026-27', serial: 99999999 }).length === 16,
  )

  throws('serial 0 is refused — Rule 46(b) series are 1-based', () =>
    rules.formatDocumentNumber({ financialYear: '2026-27', serial: 0 }))
  throws('a fractional serial is refused', () =>
    rules.formatDocumentNumber({ financialYear: '2026-27', serial: 1.5 }))
  throws('a 5-character prefix is refused', () =>
    rules.formatDocumentNumber({ financialYear: '2026-27', serial: 1, prefix: 'TOOBIG' }))
  throws('a prefix containing a slash is refused (the formatter owns the separator)', () =>
    rules.formatDocumentNumber({ financialYear: '2026-27', serial: 1, prefix: 'M/A' }))
  throws('a malformed FY label is refused', () =>
    rules.formatDocumentNumber({ financialYear: '2026', serial: 1 }))
  // Overflow must THROW, never truncate: a truncated number is a DIFFERENT
  // number and collides with an earlier document in the same series.
  throws('an over-16 assembly throws rather than truncating', () =>
    rules.formatDocumentNumber({ financialYear: '2026-27', serial: 10000, prefix: 'ABCD' }))
}

console.log('\n── financial year: 1 April, in IST')
{
  const fy = (iso: string) => rules.financialYearOf(new Date(iso))

  check("mid-year is the FY that started in April", fy('2026-08-06T12:00:00Z') === '2026-27')
  check('1 April IST opens the new FY', fy('2026-04-01T00:00:00+05:30') === '2026-27')
  check('31 March IST is still the old FY', fy('2026-03-31T12:00:00+05:30') === '2025-26')
  check('January belongs to the FY that started last April', fy('2026-01-15T12:00:00Z') === '2025-26')

  // THE TRAP. 2026-03-31 23:00 UTC is 2026-04-01 04:30 in Kolkata. Computing
  // the year off the UTC date puts this document back into a series that closed
  // on 31 March — i.e. it reissues a number that is already printed.
  check(
    'IST, not UTC: 31 Mar 23:00 UTC is already FY 2026-27',
    fy('2026-03-31T23:00:00Z') === '2026-27',
  )
  check(
    'and 31 Mar 18:29 UTC (23:59 IST) is still FY 2025-26',
    fy('2026-03-31T18:29:00Z') === '2025-26',
  )

  // The label must satisfy the same regex the DB CHECK enforces, at the century
  // boundary too — '1999-0' would be rejected by Postgres after the fact.
  check('century rollover zero-pads to 1999-00', fy('1999-06-01T12:00:00Z') === '1999-00')
  check('every label matches the stored pattern', rules.FINANCIAL_YEAR_PATTERN.test(fy('2000-04-01T12:00:00Z')))
}

console.log('\n── weight: actual AND charged (§11.2)')
{
  check('charged falls back to actual when nothing cubes out', rules.chargedWeightKg(9000) === 9000)
  check('charged is the volumetric weight when it is higher', rules.chargedWeightKg(9000, 12500) === 12500)
  check('charged is the actual weight when volumetric is lower', rules.chargedWeightKg(9000, 4000) === 9000)
  check('charged is never below actual', rules.chargedWeightKg(9000, 8999.9) === 9000)
  throws('a non-positive actual weight is refused', () => rules.chargedWeightKg(0))
}

console.log('\n── charge lines sum to a total, never one lump figure (§11.2)')
{
  check(
    'freight + stationary + hamali',
    rules.lrChargeTotalInr({ freightInr: 18000, stationaryInr: 50, handlingInr: 900 }) === 18950,
  )
  check('missing lines are zero, not undefined', rules.lrChargeTotalInr({ freightInr: 18000 }) === 18000)
  check(
    'paise survive the sum',
    rules.lrChargeTotalInr({ freightInr: 0.1, stationaryInr: 0.2 }) === 0.3,
  )
  throws('a negative charge line is refused', () => rules.lrChargeTotalInr({ freightInr: -1 }))
}

console.log('\n── consignment value INCLUDES GST (§4.1, Rule 138 Explanation 2)')
{
  // The worked example from the doc: ₹48,000 + 5% = ₹50,400, which is over the
  // line. A pre-tax check says ₹48,000 and lets the truck leave without a bill.
  const value = rules.consignmentValueInr({ taxableValueInr: 48000, cgstInr: 1200, sgstInr: 1200 })
  check('₹48,000 + 5% GST = ₹50,400', value === 50400)
  check('…and that DOES need an e-way bill', rules.interStateEwayBillRequired(value) === true)
  check(
    'while the pre-tax figure alone would NOT — the bug this prevents',
    rules.interStateEwayBillRequired(48000) === false,
  )

  check('IGST counts the same as CGST+SGST', rules.consignmentValueInr({ taxableValueInr: 48000, igstInr: 2400 }) === 50400)
  check('cess is included', rules.consignmentValueInr({ taxableValueInr: 100, cessInr: 10 }) === 110)
  check(
    'the exempt component is subtracted on a mixed invoice',
    rules.consignmentValueInr({ taxableValueInr: 60000, igstInr: 3000, exemptValueInr: 20000 }) === 43000,
  )
  check('a wholly taxable invoice subtracts nothing', rules.consignmentValueInr({ taxableValueInr: 60000 }) === 60000)

  // Rule 138(1) says "exceeds", so the boundary itself is below the line.
  check('the threshold is ₹50,000', rules.INTER_STATE_EWB_THRESHOLD_INR === 50000)
  check('exactly ₹50,000 does not need one ("exceeds")', rules.interStateEwayBillRequired(50000) === false)
  check('₹50,000.01 does', rules.interStateEwayBillRequired(50000.01) === true)

  check(
    'float noise does not leak into a statutory figure',
    rules.consignmentValueInr({ taxableValueInr: 0.1, igstInr: 0.2 }) === 0.3,
  )
  throws('a negative tax component is refused', () =>
    rules.consignmentValueInr({ taxableValueInr: 100, igstInr: -1 }))
}

console.log('\n── e-way bill expiry: STORED, never derived (§4.4)')
{
  const now = new Date('2026-08-06T10:00:00Z')
  const inHours = (h: number) => new Date(now.getTime() + h * 3600_000).toISOString()

  check('a bill 10 days out is simply valid', rules.ewayBillExpiry(inHours(240), now).state === 'valid')
  check('the alert window is 4 days (§9.3)', rules.EWB_EXPIRY_ALERT_WINDOW_DAYS === 4)
  check('3 days out is expiring soon', rules.ewayBillExpiry(inHours(72), now).state === 'expiring_soon')
  check('exactly 4 days out is already inside the window', rules.ewayBillExpiry(inHours(96), now).state === 'expiring_soon')
  check('4 days and an hour out is not', rules.ewayBillExpiry(inHours(97), now).state === 'valid')
  check('the instant validity passes it is expired — no grace at a checkpoint',
    rules.ewayBillExpiry(inHours(0), now).state === 'expired')
  check('an hour past is expired', rules.ewayBillExpiry(inHours(-1), now).state === 'expired')
  check('an expired bill reports 0 hours left, never a negative countdown',
    rules.ewayBillExpiry(inHours(-5), now).hours_remaining === 0)
  check('hours remaining rounds DOWN, so it never over-promises',
    rules.ewayBillExpiry(inHours(3.9), now).hours_remaining === 3)
  check('the deadline is echoed back unchanged',
    rules.ewayBillExpiry(inHours(48), now).valid_upto === inHours(48))
  throws('an unparseable valid_upto is refused rather than treated as expired', () =>
    rules.ewayBillExpiry('not-a-date', now))

  // The structural pin for D-17 / §4.4: this module must not grow a function
  // that DERIVES a validity deadline. The midnight rule (a "day" ends at
  // midnight of the day FOLLOWING generation) makes any local computation wrong
  // by up to a full day in the direction that gets a driver detained.
  const exported = Object.keys(rules)
  check(
    'no exported helper computes a valid_upto',
    !exported.some(k => /valid.?upto|validity|expiry.?date/i.test(k) && /compute|derive|calc/i.test(k)),
  )
  check(
    'nothing in this module is named to suggest deriving validity',
    !exported.some(k => /^(compute|derive|calculate)/i.test(k)),
  )
}

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) { failures.forEach(f => console.log(`  - ${f}`)); process.exit(1) }
