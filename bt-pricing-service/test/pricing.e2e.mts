/**
 * T-BE-5 — CTO cost-breakdown + JWT auth. Verifies the deterministic
 * breakdown math against known inputs and the auth boundary via app.inject().
 * Run: npx tsx test/pricing.e2e.mts
 */
process.env.JWT_SECRET = 'test-jwt-secret-long-enough-for-hs256'
delete process.env.DIESEL_PRICE_INR // ensure default 90 for the base cases

import Fastify from 'fastify'
import jwt from 'jsonwebtoken'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}`) } else { failures.push(`${name} ${detail}`); console.log(`  FAIL  ${name} ${detail}`) }
}
const tok = () => jwt.sign({ userId: 'u1', role: 'shipper' }, process.env.JWT_SECRET!)

async function main() {
  const { costBreakdown } = await import('../src/lib/cto-cost.js')
  const authPlugin = (await import('../src/plugins/auth.js')).default
  const { QuoteBody, computeQuote } = await import('../src/lib/pricing.js')

  console.log('\n── deterministic breakdown math (known inputs) ──')
  // HCV, 100km @ diesel 90, mileage 3.5:
  //   fuel=ceil(100/3.5*90)=2572; driver=ceil(100/400*1200)=300; opex=ceil(100*8)=800; handling=1000; total=4672
  const hcv = costBreakdown('HCV', 100)
  check('HCV/100 fuel_cost=2572', hcv.fuel_cost === 2572, `(got ${hcv.fuel_cost})`)
  check('HCV/100 driver_wage=300', hcv.driver_wage === 300, `(got ${hcv.driver_wage})`)
  check('HCV/100 per_km_operating_cost=800', hcv.per_km_operating_cost === 800, `(got ${hcv.per_km_operating_cost})`)
  check('HCV/100 handling=1000', hcv.handling === 1000, `(got ${hcv.handling})`)
  check('HCV/100 operating_cost_total=4672', hcv.operating_cost_total === 4672, `(got ${hcv.operating_cost_total})`)
  check('HCV mileage aligned to tracking D-009 (3.5)', hcv.mileage_kmpl === 3.5)

  // MCV, 200km @ diesel 90, mileage 6.0:
  //   fuel=ceil(200/6*90)=3000; driver=ceil(200/400*1200)=600; opex=ceil(200*6)=1200; handling=800; total=5600
  const mcv = costBreakdown('MCV', 200)
  check('MCV/200 fuel_cost=3000', mcv.fuel_cost === 3000, `(got ${mcv.fuel_cost})`)
  check('MCV/200 operating_cost_total=5600', mcv.operating_cost_total === 5600, `(got ${mcv.operating_cost_total})`)
  check('MCV mileage aligned to tracking D-009 (6.0)', mcv.mileage_kmpl === 6.0)

  console.log('\n── diesel price env-override ──')
  process.env.DIESEL_PRICE_INR = '100'
  const hcv100 = costBreakdown('HCV', 100) // fuel=ceil(100/3.5*100)=2858
  check('diesel override 100 → HCV/100 fuel=2858', hcv100.fuel_cost === 2858 && hcv100.diesel_price_inr === 100, `(got ${hcv100.fuel_cost}/${hcv100.diesel_price_inr})`)
  delete process.env.DIESEL_PRICE_INR

  // Build the real JWT-gated app
  const app = Fastify({ logger: false })
  await app.register(async (authed) => {
    await authed.register(authPlugin)
    authed.post('/quote', async (req, reply) => {
      const body = QuoteBody.safeParse(req.body)
      if (!body.success) return reply.status(400).send({ success: false, error: body.error.errors[0].message, code: 'VALIDATION_ERROR' })
      return reply.send({ success: true, data: computeQuote(body.data) })
    })
  })
  await app.ready()
  const quote = (body: any, token?: string) => app.inject({
    method: 'POST', url: '/quote', headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body,
  })

  console.log('\n── JWT auth boundary (P1 #11) ──')
  let r = await quote({ distance_km: 100, vehicle_type: 'hcv', load_type: 'general', weight_kg: 1000 })
  check('quote without token 401', r.statusCode === 401, `(got ${r.statusCode})`)
  r = await quote({ distance_km: 100, vehicle_type: 'hcv', load_type: 'general', weight_kg: 1000 }, 'not.a.jwt')
  check('quote with bad token 401', r.statusCode === 401, `(got ${r.statusCode})`)

  console.log('\n── /quote returns breakdown + commercial split ──')
  r = await quote({ distance_km: 100, vehicle_type: 'hcv', load_type: 'general', weight_kg: 1000 }, tok())
  check('quote with token 200', r.statusCode === 200, `(got ${r.statusCode})`)
  const d = r.json().data
  // HCV/100km: rate=round(36.714*1.63)=60 → base=6000, handling=1000, total=7000.
  check('commercial split present (total_price=7000)', d?.total_price === 7000, `(got ${d?.total_price})`)
  check('derived HCV rate is the founder market anchor (60/km)', d?.rate_per_km === 60, `(got ${d?.rate_per_km})`)
  check('handling passed through at cost (1000)', d?.handling_fee === 1000, `(got ${d?.handling_fee})`)
  check('cost_breakdown present + matches HCV/100', d?.cost_breakdown?.operating_cost_total === 4672 && d?.cost_breakdown?.vehicle_class === 'HCV', JSON.stringify(d?.cost_breakdown))

  console.log('\n── the regression guard: no class may be priced below cost ──')
  // The original bug: a hand-written rate card (hcv: 22) sitting next to a cost
  // engine that says an HCV costs ~36.7/km. Every class was underwater. Assert
  // the property directly, across the whole matrix and at both a short and a
  // long trip, so no future edit to either table can reintroduce it silently.
  for (const vt of ['mini_truck', 'lcv', 'hcv', 'trailer'] as const) {
    for (const km of [50, 1200]) {
      const q = (await quote({ distance_km: km, vehicle_type: vt, load_type: 'general', weight_kg: 1000 }, tok())).json().data
      const cost = q.cost_breakdown.operating_cost_total
      check(`${vt}/${km}km: carrier receives ${q.driver_receives} > cost ${cost}`, q.driver_receives > cost, '')
    }
  }

  console.log('\n── a fuel move flows through to the rate ──')
  // The silent, one-directional failure the old hardcoded card had: diesel rises,
  // cost rises, price does not, and the margin quietly vanishes.
  const rateAt90 = (await quote({ distance_km: 100, vehicle_type: 'hcv', load_type: 'general', weight_kg: 1000 }, tok())).json().data.rate_per_km
  process.env.DIESEL_PRICE_INR = '120'
  const rateAt120 = (await quote({ distance_km: 100, vehicle_type: 'hcv', load_type: 'general', weight_kg: 1000 }, tok())).json().data.rate_per_km
  delete process.env.DIESEL_PRICE_INR
  check('diesel 90 → 120 raises the HCV rate', rateAt120 > rateAt90, `(${rateAt90} → ${rateAt120})`)

  console.log('\n── per-type env override wins over the derived rate ──')
  process.env.RATE_PER_KM_HCV = '75'
  const overridden = (await quote({ distance_km: 100, vehicle_type: 'hcv', load_type: 'general', weight_kg: 1000 }, tok())).json().data
  delete process.env.RATE_PER_KM_HCV
  check('RATE_PER_KM_HCV=75 is used verbatim', overridden.rate_per_km === 75 && overridden.base_price === 7500, `(got ${overridden.rate_per_km}/${overridden.base_price})`)

  console.log('\n── class mapping assumptions (Q9-flagged) ──')
  r = await quote({ distance_km: 50, vehicle_type: 'mini_truck', load_type: 'general', weight_kg: 500 }, tok())
  check('mini_truck → SCV (assumption)', r.json().data?.cost_breakdown?.vehicle_class === 'SCV', JSON.stringify(r.json().data?.cost_breakdown?.vehicle_class))
  r = await quote({ distance_km: 50, vehicle_type: 'trailer', load_type: 'general', weight_kg: 500 }, tok())
  check('trailer → HCV (assumption)', r.json().data?.cost_breakdown?.vehicle_class === 'HCV', JSON.stringify(r.json().data?.cost_breakdown?.vehicle_class))

  console.log('\n── D-11: the platform price is ADVISORY on an auction ──')
  // The platform does not have a price on an auction — the charge is the winning
  // carrier's bid. Beyond the product decision, a platform that SETS the freight
  // price drifts toward GTA characterisation under Indian GST, which is a tax and
  // cargo-liability event (INDIA_FREIGHT_COMPLIANCE.md §1.3 red line 3, §9.4).
  // Price discovery is safe; price setting is not. These checks are the guard on
  // that line, so pin the classification rather than the arithmetic.
  const base = { distance_km: 100, vehicle_type: 'hcv', load_type: 'general', weight_kg: 1000 }
  const kindOf = async (booking_type?: string) =>
    (await quote(booking_type ? { ...base, booking_type } : base, tok())).json().data

  const auction = await kindOf('auction')
  check('auction → advisory', auction.quote_kind === 'advisory', `(got ${auction.quote_kind})`)
  check('instant → binding', (await kindOf('instant')).quote_kind === 'binding')
  check('direct → binding', (await kindOf('direct')).quote_kind === 'binding')

  // The compatibility default. bt-booking-service's quote-lock saga resolves the
  // charge from the locked row and sends no booking_type; if omission ever meant
  // advisory, every instant/direct price would silently come unbound.
  const omitted = await kindOf()
  check('booking_type omitted → binding (existing callers unchanged)', omitted.quote_kind === 'binding', `(got ${omitted.quote_kind})`)

  // The failure mode a bare `=== 'auction'` invites: a typo, a capitalised value
  // or a renamed enum member falls through to binding, and an auction quote
  // quietly becomes a price the platform charges. Reject at the edge instead —
  // a 400 is loud, a silent downgrade is not.
  const typo = await quote({ ...base, booking_type: 'Auction' }, tok())
  check('unknown booking_type rejected, never silently binding', typo.statusCode === 400, `(got ${typo.statusCode})`)

  // Classification must not move the number. If advisory ever became a discount
  // or a range, it would stop being the same benchmark the cost model produced —
  // and the "shown == charged" guarantee on the binding path would be comparing
  // against a different figure than the one the rate card justifies.
  check(
    'advisory and binding price the SAME number (label, not a discount)',
    auction.total_price === omitted.total_price && auction.rate_per_km === omitted.rate_per_km,
    `(${auction.total_price}/${auction.rate_per_km} vs ${omitted.total_price}/${omitted.rate_per_km})`,
  )

  // The disclosure has to travel with the quote. A client left to compose this
  // itself eventually omits it, and an auction number shown without "this is a
  // reference" is the exact fact pattern §1.3 warns about.
  check('advisory basis names the carrier bid as the actual charge', /winning carrier/i.test(auction.basis), `(got ${auction.basis})`)
  check('binding basis states it is the price charged', /price charged/i.test(omitted.basis), `(got ${omitted.basis})`)

  await app.close()
  console.log(`\n${failures.length ? 'RESULT: FAIL' : 'RESULT: PASS'} — ${passed} checks passed, ${failures.length} failed`)
  if (failures.length) { failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1) }
}
main().catch(err => { console.error(err); process.exit(1) })
