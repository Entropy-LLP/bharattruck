# Task: `feat/personas-relation-set`

**Relates to:** `docs/ARCHITECTURE_UNIFIED_IDENTITY.md` (the locked model — §1.1 commercial
visibility, **D-10** direct-attach, **D-13** POD = OTP) and the unified-app plan on
`docs/unified-app-plan`. Unblocks the unified front door; ships no user-visible behaviour itself.

## What this branch adds

`packages/shared/src/personas.ts` gains one function and one relation, and nothing else changes.

### 1. A viewer can hold MORE THAN ONE relation to a booking

`relationToBooking()` returns a single value with shipper winning. That is the right answer for
"which view do I render", and the wrong answer for "may this human do X", because it silently drops
every weaker relation the same human holds.

The case it drops is not exotic — it is **D-10 direct-attach**: a distributor posts a load AND wins
it with their own fleet. They are shipper *and* carrier on one booking. The single value says
`shipper`, so anything gated on "is this viewer the carrier" locks the distributor out of their own
trip.

`relationsToBooking(booking, snapshot): BookingRelation[]` returns every relation that holds, in the
precedence order the single-value function has always applied: `shipper → carrier → driver →
consignee`. An **empty array is observer-only** — `'observer'` is deliberately never an element,
because a set containing it would make `.includes('observer')` read as a permission.

The driver/carrier interaction is preserved exactly: a **solo** driver (no fleet on the booking) IS
the carrier — they bid, they won, they carry the economics — while a driver on a fleet-owned booking
is staff and holds `driver`.

### 2. The consignee is a relation

The consignee (receiver) is a first-class freight party, the same kind of entity as a shipper. Most
are **unclaimed**: a record with a name and a phone, no login. `ViewerBooking` therefore carries
`consignee_user_id?: string | null` — `users.id`, populated only once that party claims an account.

An unclaimed consignee has **no viewer relation**, because there is no session to resolve. Their
access path is the POD OTP (D-13), not a logged-in read. Resolving by `users.id` makes that fall out
for free: the relation does not match until they claim, and their inbound shipment then appears with
no backfill.

`seesCommercialsOnBooking()` returns **false** for a consignee. They are a stakeholder in the
shipment, not in the carriage economics — never the carrier's margin, never the fleet↔driver split.
What they legitimately see is what *they* owe on a "To Pay" consignment, and that is a per-document
disclosure the documents layer makes on the LR/invoice they are handed, not a booking-wide unmask.

## Acceptance criteria

- [x] `'consignee'` in `BookingRelation`; `consignee_user_id` on `ViewerBooking`.
- [x] `relationsToBooking()` exported (via the existing `export * from './personas.js'` barrel).
- [x] `relationToBooking()` is `relationsToBooking()[0] ?? 'observer'` and its truth table is
      **unchanged** — pinned as an explicit table in the test file, not left to prose.
- [x] `seesCommercialsOnBooking()` unchanged for shipper / carrier / driver / observer.
- [x] No caller changes. Every field added is optional; every existing signature is identical.
- [x] `packages/shared/dist` rebuilt and committed (Option-C `file:` wiring — see
      `packages/shared/.gitignore`), so the two consuming services typecheck against the new types.

## Verification

```
packages/shared      npm run build   → tsc clean
packages/shared      npm test        → 41/41 pass (personas.test.mts 34/34, was 23)
bt-booking-service   npm ci && npm run build → tsc clean   (rebuilt by CI on a shared change)
bt-tracking-service  npm ci && npm run build → tsc clean   (same)
```

New tests (`packages/shared/test/personas.test.mts`): direct-attach returns `['shipper','carrier']`;
solo driver returns `['carrier']`, not `driver`; fleet-employed driver returns `['driver']`; fleet
owner driving their own truck returns `['carrier','driver']`; claimed consignee returns
`['consignee']`; unclaimed consignee and unrelated user both return `[]`; shipper-who-is-also-
consignee returns both and still sees their freight; consignee alone does not.

## Risk

Low, and bounded to the type surface. The only behavioural risk was the `relationToBooking()`
refactor, which is why the regression test asserts the pre-change value for all eight rows of the
truth table rather than sampling it.
