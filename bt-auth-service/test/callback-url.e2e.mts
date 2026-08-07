/**
 * callback_url origin allowlist — the guard on emailed sign-in / reset links.
 *
 * The vector this closes: POST a victim's address with callback_url pointing at a host
 * the attacker owns, and the victim is mailed a real single-use token addressed to that
 * host. So the assertions are about two things — which origins the allowlist accepts,
 * and that a refusal happens BEFORE anything is looked up or sent, so the 400 cannot
 * double as an account-existence oracle on these deliberately enumeration-safe routes.
 *
 * Registers the REAL authRoutes against an in-memory Redis and Supabase.
 * Run: npx tsx test/callback-url.e2e.mts
 */
process.env.JWT_SECRET = 'test-jwt-secret-hs256'
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-hs256'
process.env.EMAIL_DEV_MODE = 'true' // never touch a real SMTP host — links land on stdout
// The deployment the route cases run under: two persona apps on https, plus one extra
// origin declared the way the unified app will be before it has link vars of its own.
process.env.SHIPPER_MAGIC_LINK_URL = 'https://app.bharattruck.in/auth/callback'
process.env.DRIVER_MAGIC_LINK_URL = 'https://driver.bharattruck.in/auth/callback'
process.env.ALLOWED_CALLBACK_ORIGINS = 'https://unified.bharattruck.in'
// High enough that the per-address send throttle never fires mid-run and turns a
// callback_url assertion into a rate-limit assertion.
process.env.EMAIL_SEND_LIMIT = '50'
process.env.SMTP_DAILY_BUDGET = '50'

import Fastify from 'fastify'
import bcrypt from 'bcrypt'
import { callbackOriginAllowlist, isAllowedCallbackUrl } from '../src/lib/callback-url.js'

const SHIPPER_APP = 'https://app.bharattruck.in'
const KNOWN = 'known@example.com'
const GHOST = 'ghost@example.com'

type Row = Record<string, any>
let users: Row[] = []

// ── Fake Redis: only the commands these two routes touch. Values are strings, as in
// the real client, so a bug that assumes numbers surfaces here rather than in prod.
class FakeRedis {
  private store = new Map<string, string>()
  private expiries = new Map<string, number>()
  async incr(k: string) { const n = Number(this.store.get(k) ?? 0) + 1; this.store.set(k, String(n)); return n }
  async expire(k: string, s: number) { this.expiries.set(k, s); return 1 }
  async ttl(k: string) { return this.expiries.get(k) ?? -1 }
  async get(k: string) { return this.store.get(k) ?? null }
  async set(k: string, v: string, ..._rest: unknown[]) { this.store.set(k, v); return 'OK' }
  async del(k: string) { this.expiries.delete(k); return this.store.delete(k) ? 1 : 0 }
}

class FakeQuery {
  private f: Array<[string, any]> = []
  private mode: 'select' | 'insert' | 'update' | 'upsert' = 'select'
  private payload: Row | null = null
  constructor(private table: string) {}
  select() { return this }
  insert(p: Row) { this.mode = 'insert'; this.payload = p; return this }
  update(p: Row) { this.mode = 'update'; this.payload = p; return this }
  upsert(p: Row) { this.mode = 'upsert'; this.payload = p; return this }
  eq(c: string, v: any) { this.f.push([c, v]); return this }
  private m(r: Row) { return this.f.every(([c, v]) => r[c] === v) }
  private run() {
    if (this.table !== 'users') return { data: [], error: null }
    if (this.mode === 'insert') {
      const row = { id: `u${users.length + 1}`, role: 'shipper', email_verified: false, ...this.payload }
      users.push(row)
      return { data: [row], error: null }
    }
    if (this.mode === 'update') {
      const hit = users.filter(r => this.m(r))
      hit.forEach(r => Object.assign(r, this.payload))
      return { data: hit, error: null }
    }
    if (this.mode === 'upsert') return { data: [], error: null }
    return { data: users.filter(r => this.m(r)), error: null }
  }
  maybeSingle() { const { data, error } = this.run(); return Promise.resolve({ data: data.length ? data[0] : null, error }) }
  single() { return this.maybeSingle() }
  then(f: (v: any) => any, r?: (e: any) => any) { return Promise.resolve(this.run()).then(f, r) }
}

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}`) } else { failures.push(`${name} ${detail}`); console.log(`  FAIL  ${name} ${detail}`) }
}

/** Collect everything the code under test writes to stdout — that is where [DEV] links go. */
function captureConsoleLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = []
  const original = console.log
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')) }
  return { lines, restore: () => { console.log = original } }
}

async function main() {
  console.log('\n── allowlist construction ──')

  // Exactly what the routes build: every role's magic-link and reset base, plus the
  // comma-separated extras. fleet_owner falls through to the shipper app, so three
  // distinct origins is the right answer for this env, not six.
  const allowed = callbackOriginAllowlist(
    ['https://app.bharattruck.in/auth/callback', 'https://app.bharattruck.in/auth/reset', 'https://driver.bharattruck.in/auth/callback'],
    process.env,
  )
  check('configured origins are allowed', allowed.has(SHIPPER_APP) && allowed.has('https://driver.bharattruck.in'), `(got ${[...allowed]})`)
  check('ALLOWED_CALLBACK_ORIGINS entry is allowed', allowed.has('https://unified.bharattruck.in'), `(got ${[...allowed]})`)
  check('paths collapse to one origin, not one entry per URL', allowed.size === 3, `(got ${allowed.size}: ${[...allowed]})`)

  console.log('\n── origin comparison, not prefix comparison ──')

  check('exact configured origin passes', isAllowedCallbackUrl(`${SHIPPER_APP}/auth/callback`, allowed))
  check('any path/query on an allowed origin passes', isAllowedCallbackUrl(`${SHIPPER_APP}/auth/reset?next=%2Fbookings`, allowed))
  check('a foreign origin is rejected', !isAllowedCallbackUrl('https://evil.example/auth/callback', allowed))
  // The two classic bypasses of a startsWith()/includes() check. Both parse to the
  // attacker's origin, which is where the browser would actually deliver the token.
  check('suffix attack rejected — allowed value in the query', !isAllowedCallbackUrl(`https://evil.example/?next=${SHIPPER_APP}`, allowed))
  check('prefix attack rejected — allowed value as a subdomain label', !isAllowedCallbackUrl('https://app.bharattruck.in.evil.example/auth/callback', allowed))
  check('userinfo attack rejected — allowed value before an @', !isAllowedCallbackUrl(`${SHIPPER_APP}@evil.example/auth/callback`, allowed))
  check('a different port is a different origin', !isAllowedCallbackUrl('https://app.bharattruck.in:8443/auth/callback', allowed))

  console.log('\n── scheme rules ──')

  check('http rejected for a non-localhost host', !isAllowedCallbackUrl('http://app.bharattruck.in/auth/callback', allowed))
  // zod's .url() accepts these; only the origin check stops them.
  check('javascript: rejected', !isAllowedCallbackUrl('javascript:alert(document.cookie)', allowed))
  check('data: rejected', !isAllowedCallbackUrl('data:text/html,<script>fetch(location)</script>', allowed))
  check('garbage rejected', !isAllowedCallbackUrl('not-a-url', allowed))

  // Dev deployment: the defaults are http://localhost, and those must keep working.
  const devAllowed = callbackOriginAllowlist(['http://localhost:3000/auth/callback', 'http://localhost:3002/auth/callback'], {})
  check('http localhost allowed when that is the configured base', isAllowedCallbackUrl('http://localhost:3000/auth/callback', devAllowed))
  check('a plain-http env entry is dropped, not trusted', !callbackOriginAllowlist(['http://app.bharattruck.in/auth/callback'], {}).size)

  console.log('\n── route wiring: refused before any lookup or send ──')

  const redis = new FakeRedis()
  const app = Fastify({ logger: false })
  app.decorate('redis', redis as any)
  app.decorate('supabase', { from: (t: string) => new FakeQuery(t) } as any)
  const { authRoutes } = await import('../src/routes/auth.js')
  await app.register(authRoutes, { prefix: '/auth' })

  const post = (url: string, payload: any) => app.inject({ method: 'POST', url, payload })
  users = [{ id: 'u1', email: KNOWN, password_hash: await bcrypt.hash('correct-horse-battery', 4), role: 'shipper', email_verified: true }]

  // Every request runs under the capture and every assertion after it is torn down —
  // check() writes to console.log too, and asserting against a buffer it is still
  // appending to would count its own output as delivered mail.
  const cap = captureConsoleLog()
  let evilMagic: any, okMagic: any, plainMagic: any, evilForgotKnown: any, evilForgotGhost: any, okForgot: any
  const links = (kind: string) => cap.lines.filter(l => l.includes(`[DEV] ${kind}`))
  let linksAfterEvil = 0, usersAfterEvil = 0
  try {
    evilMagic = await post('/auth/magic-link/send', { email: GHOST, callback_url: 'https://evil.example/steal' })
    linksAfterEvil = links('Magic link').length
    usersAfterEvil = users.length
    okMagic = await post('/auth/magic-link/send', { email: KNOWN, callback_url: `${SHIPPER_APP}/auth/callback` })
    plainMagic = await post('/auth/magic-link/send', { email: KNOWN })
    evilForgotKnown = await post('/auth/forgot-password', { email: KNOWN, callback_url: 'https://evil.example/steal' })
    evilForgotGhost = await post('/auth/forgot-password', { email: GHOST, callback_url: 'https://evil.example/steal' })
    okForgot = await post('/auth/forgot-password', { email: KNOWN, callback_url: `${SHIPPER_APP}/auth/reset` })
  } finally {
    cap.restore()
  }

  check('magic-link/send refuses a foreign callback_url', evilMagic.statusCode === 400, `(got ${evilMagic.statusCode})`)
  check('the refused request mailed nothing', linksAfterEvil === 0, `(got ${linksAfterEvil} links)`)
  // The refusal must land before the upsert that would otherwise create the account —
  // a row appearing here is proof the check ran too late to be side-effect free.
  check('the refused request created no account', usersAfterEvil === 1, `(got ${usersAfterEvil} users)`)
  check('an allowed callback_url still works', okMagic.statusCode === 200, `(got ${okMagic.statusCode})`)
  check('the allowed callback_url is the link base', links('Magic link').some(l => l.includes(`${SHIPPER_APP}/auth/callback?token=`)), `(got ${JSON.stringify(links('Magic link'))})`)
  check('no callback_url still falls back to the env base', plainMagic.statusCode === 200 && links('Magic link').some(l => l.includes(`${SHIPPER_APP}/auth/callback?token=`)), `(got ${plainMagic.statusCode})`)

  check('forgot-password refuses a foreign callback_url', evilForgotKnown.statusCode === 400, `(got ${evilForgotKnown.statusCode})`)
  // The point of refusing before the lookup: a known and an unknown address must be
  // indistinguishable, or the new 400 becomes the enumeration oracle the generic
  // success response on this route exists to prevent.
  check('refusal is identical for a known and an unknown address',
    evilForgotGhost.statusCode === evilForgotKnown.statusCode && evilForgotGhost.body === evilForgotKnown.body,
    `(got ${evilForgotGhost.statusCode}/${evilForgotGhost.body} vs ${evilForgotKnown.statusCode}/${evilForgotKnown.body})`)
  check('no reset link was mailed to a foreign origin', !links('Password reset link').some(l => l.includes('evil.example')), `(got ${JSON.stringify(links('Password reset link'))})`)
  check('an allowed reset callback_url still works', okForgot.statusCode === 200, `(got ${okForgot.statusCode})`)
  check('the allowed reset origin is the link base', links('Password reset link').some(l => l.includes(`${SHIPPER_APP}/auth/reset?token=`)), `(got ${JSON.stringify(links('Password reset link'))})`)

  await app.close()
  console.log(`\n${failures.length ? 'RESULT: FAIL' : 'RESULT: PASS'} — ${passed} checks passed, ${failures.length} failed`)
  if (failures.length) { failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1) }
}
main().catch(err => { console.error(err); process.exit(1) })
