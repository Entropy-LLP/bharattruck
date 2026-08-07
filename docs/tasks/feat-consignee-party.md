# Task: `feat/consignee-party`

**Relates to:** `docs/ARCHITECTURE_UNIFIED_IDENTITY.md` **§9.1 D-22** (the consignee is a
shipper-kind party), **§9.2** (the model in full), **D-29** (`ship` is write-gated by contact
completeness) and **§9.5 row 6**. Builds on `feat/personas-relation-set`, which supplies the
`consignee` relation and `relationsToBooking()`.

## What this branch adds

Makes the receiver of a shipment a first-class freight party, replacing the single nullable
`bookings.receiver_email` string.

### The model (locked, not redesigned here)

A consignee is a **shipper-KIND party** — a `public.users` row — in one of two states:

- **UNCLAIMED**: created by whoever posted the load, with **no credential at all**. Not an account
  with a weak password; it cannot be logged into, only claimed. Never mint a password for one.
- **CLAIMED**: the same row, after the human authenticates (phone OTP), inheriting the shipment
  history already attached to it.

Documents need a RECORD; actions need a LOGIN. One entity kind covers both, which is why a separate
`freight_parties` table was considered and rejected: the moment a consignee ships outbound it would
give one human two identities, and claiming would need a merge migration.

### Migration `0026_consignee_party.sql`

Strictly additive, and **not applied to production**.

- `users.gstin` — nullable, format-checked against the 15-character GSTIN shape. NULL = unregistered
  (renders as `URP`); the literal `'URP'` is never stored.
- `users.claimed_at` — nullable timestamptz. NULL = an unclaimed party record. **Backfilled from
  `created_at`** for all 48 existing rows (every one is a real signup), guarded so a re-run cannot
  silently claim records created since. The column then takes `default now()`, so every existing
  writer stays correct without knowing it exists; the consignee upsert is the one writer that passes
  an explicit NULL.
- `bookings.consignee_user_id` — nullable uuid → `users(id)`, partially indexed. Nullable because
  672 legacy bookings have no consignee and must keep working.
- `bookings.receiver_email` is **kept and still populated** — the live POD path in `bt-cargo-ledger`
  reads it. Dropping it is a later migration, once POD sends to the consignee's phone (D-26).

### `bt-booking-service`

- `POST /bookings` accepts a `consignee` object: **name and phone required** (D-29), email / GSTIN /
  address optional. Phone is normalised to the 10-digit form `bt-auth-service` already stores,
  because the unique index that dedups parties can only dedup values spelled the same way.
- The party is resolved by phone: an existing `users` row is **linked**, otherwise a credential-less
  record is inserted with `ON CONFLICT DO NOTHING` (concurrency-safe — two simultaneous bookings
  naming one new consignee produce one party, not a 500).
- 🔴 **Linking never writes to the row it matched.** A caller supplies the phone, so they can always
  name a stranger's. DO UPDATE here would make booking creation an unauthenticated write to any
  profile on the platform.
- Booking reads carry a `consignee` projection of **name / phone / city only**, gated on
  `relationsToBooking()` from `@bharattruck/shared/personas` — an observer (a driver browsing the
  open load board) gets no block at all.
- A claimed consignee may now `GET` the booking consigned to them. Their inbound *list* is not here:
  it needs a filter on a column a pre-0026 database does not have.

## Acceptance criteria

- [x] Migration 0026, additive, with the `claimed_at` backfill and no drop of `receiver_email`.
- [x] `consignee` accepted on create; name + phone required; a create with neither `consignee` nor
      `receiver_email` is still refused exactly as before.
- [x] Existing phone links; the linked row is byte-identical afterwards.
- [x] Legacy `receiver_email`-only creates work unchanged and write no 0026 column.
- [x] Pre-0026 database: reads degrade to no consignee block; a create naming a consignee 503s with
      the migration in the message.
- [x] Non-sensitive projection, relation-gated on reads (`getBooking` + `listBookings`).

## Verification

```
packages/shared      npm run build   → tsc clean (unchanged by this branch)
bt-booking-service   npm run build   → tsc clean
bt-booking-service   npm test        → 14 files, all pass (2 new: 65 + 44 checks)
```

New tests: `test/consignee-party.e2e.mts` (real routes via `app.inject()`, in-memory Supabase,
stubbed pricing) and `test/consignee-rules.unit.mts` (pure rules, plus a character-for-character pin
of the GSTIN regex against the migration's CHECK).

## Out of scope

- The **claim flow** (phone OTP → set password → stamp `claimed_at`) — `bt-auth-service`.
- **Re-pointing POD OTP** at the consignee's phone — lands with the Twilio work (D-26).
- **Deleting `receiver_email`** — a later migration, after POD is re-pointed.
- The consignee's **inbound shipment list**.

## Risk

Medium, and concentrated in one place: booking creation is the top of the funnel. Bounded by the
consignee path being reachable only when the caller actually sends a `consignee` — every existing
client keeps the exact column set and code path it has today, on a pre-0026 database included.
