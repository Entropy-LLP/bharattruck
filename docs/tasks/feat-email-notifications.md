# Task: `feat/email-notifications`

**Relates to:** `docs/BIBLE.md §5.9` (Notifications — "at least one channel"), `§5`'s open-decision #6
(notification channel: SMS vs WhatsApp vs both — **this branch closes it for MVP by shipping email**),
`§5.4` item 10 + `docs/tasks/feat-pod-email-smtp.md` (the POD-OTP-never-delivered incident), and
`Appendix A.3` (email deliverability flagged as a risk with "no bounce/retry plan").

## What this branch adds

Platform-wide transactional email. Before it, the only mail in the system was four inline
`sendMail()` calls — three in `bt-auth-service` (verify OTP, magic link, password reset) and one in
`bt-cargo-ledger` (POD receiver OTP). Auctions, trip lifecycle, payments and fleet invites notified
nobody: `bt-booking-service/src/lib/jobs.ts` held `notifyDriver` / `notifyShipper` / `notifyNewQuote`
as TODO no-ops that had been called from five live code paths since the service was written.

### The split: synchronous vs queued

The design decision everything else follows from.

- **Synchronous, inline** — login OTP, magic link, password reset, POD receiver OTP. A human is
  sitting on a screen waiting for that code. Routing it through a polled queue would add the poll
  interval to every login. **Unchanged by this branch.**
- **Queued through the outbox** — everything else. Nobody is blocked on it, and it must never be able
  to fail the business operation that triggered it. An SMTP timeout while awarding an auction
  previously would have had to either fail the award or lose the notification silently.

The test is "is a human blocked on this arriving right now", not the message type.

### Pieces

| Piece | Where |
|---|---|
| `notification_outbox` + `notification_preferences` | `supabase/migrations/0021_notification_outbox.sql` |
| SMTP transport, event catalogue, `enqueueNotification()` | `packages/shared/src/notifications.ts` |
| Template registry (15 events, HTML + text) | `bt-booking-service/src/lib/notifications/templates.ts` |
| Recipient resolution (the `drivers.id` → `users.id` hop) | `.../notifications/recipients.ts` |
| Outbox dispatcher (claim, retry, dead-letter) | `.../notifications/dispatcher.ts` |
| Domain-event API (replaces `jobs.ts`) | `.../notifications/emit.ts` |
| Public unsubscribe endpoint | `bt-booking-service/src/routes/notifications.ts` |

`bt-booking-service/src/lib/jobs.ts` is **deleted** — its four stubs were dead, and the blockchain
anchor stub it also carried is a committed MVP cut (`CLAUDE.md`).

### Events wired

Marketplace: `quote_received`, `quote_countered`, `quote_awarded`, `quote_lost` (award **and**
explicit reject), `quote_withdrawn`.
Lifecycle: `booking_accepted`, `trip_started`, `trip_completed` (shipper + carrier + fleet driver),
`booking_cancelled`, `ops_override` (force-complete + reassign).
Payments: `payment_settled` (receipt), `payout_recorded`.
Fleet: `fleet_invite`, `fleet_invite_answered`.
Account: `password_changed`.

## Design notes worth keeping

- **Idempotency is a unique index on `dedupe_key`**, and a duplicate insert is treated as success.
  Keys include the recipient role wherever one event mails several people
  (`trip_completed:<id>:shipper` vs `:carrier`) — a key that omitted the role would let the first
  insert win and silently swallow the second person's email.
- **Claiming is an optimistic compare-and-swap** on `(id, attempts, status)`. There is no
  `SELECT ... FOR UPDATE SKIP LOCKED` through PostgREST, and two drains legitimately overlap in
  production (a Cloud Scheduler tick landing while an in-process interval is mid-drain).
- **Claiming pushes `next_attempt_at` forward by a lease**, so retry backoff and crash recovery are
  the same mechanism — a process that dies mid-send simply makes the row due again. No separate reaper.
- **Sends are sequential, not parallel.** SMTP providers throttle hard on concurrent connections from
  one account; tripping that would take the login OTPs down with the notifications.
- **Preferences are per-category, and `transactional` has no opt-out column at all** — by construction
  a payment receipt cannot be muted. Optional categories exist because a fleet owner drowning in
  marketplace mail who cannot mute it will mark the domain as spam, which costs deliverability on the
  mail that must arrive.
- **Payload is snapshotted at emit time.** A "you won this load at ₹36,483" email must still say
  ₹36,483 after the booking changes, and it keeps the dispatcher free of domain queries.
- **Unknown `event_type` is retryable, not fatal.** `event_type` is free text by design, so a producer
  may deploy ahead of the renderer; the backoff window doubles as a grace period for the template to
  ship, and it dead-letters normally once attempts are spent.
- **Unsubscribe is unauthenticated.** The token is the authorization. Asking someone to log in from a
  mail client is how you get "mark as spam" instead.

## Acceptance criteria

- [x] Outbox + preferences migration, RLS service-role only, dedupe unique index, dispatcher claim index.
- [x] 15 events rendered as HTML + plain text, all interpolation HTML-escaped.
- [x] Retry with exponential backoff and dead-lettering after `max_attempts`.
- [x] Per-category opt-out honoured; transactional mail always sends; RFC 8058 one-click unsubscribe.
- [x] `jobs.ts` TODO stubs deleted, all five call sites now emit real notifications.
- [x] `GET /health` reports `email: smtp|console` so a mis-set prod value is visible.
- [x] `tsc` clean across all five touched services; 40 new unit checks; every existing suite unchanged
      (booking 117, payment 31, cargo-ledger 34, fleet 40, pricing 17).
- [x] **Migration applied to the live Supabase project** (2026-07-31, as
      `20260731…_notification_outbox_and_preferences`). `notification_outbox` and
      `notification_preferences` exist with RLS enabled. Renumbered 0019 → **0021** on the way in:
      0020 was taken by the fleet-auction work while this was in flight.
- [x] Branch reviewed + merged (PR #29), deployed to Cloud Run. `GET /health` returns the `email`
      field; `POST /internal/notifications/dispatch` is secret-gated (401 without); the public
      unsubscribe page renders.
- [x] **App-URL env set** on the live service: `SHIPPER_APP_BASE_URL`, `DRIVER_APP_BASE_URL`,
      `NOTIFICATIONS_PUBLIC_BASE_URL`.
- [ ] **SMTP env set on the live `bt-booking-service`** — `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`,
      `EMAIL_DEV_MODE=false`. **Founder action: these are credentials.** `deploy.yml` sets no env by
      design, so this is a one-time `gcloud run services update --update-env-vars`.
      `/health` currently reports `"email":"console"`, which is how you can tell it is still missing.
- [ ] **Cloud Scheduler job created** → `POST /internal/notifications/dispatch` every minute with the
      `x-internal-secret` header. **Without this nothing is ever sent on Cloud Run**, because the
      container is frozen between requests and the in-process timer does not fire. Command in
      `docs/BIBLE.md §7.1`. **Create it AFTER the SMTP env**, not before — until then the dispatcher
      deliberately 503s (see below) and the job would just alarm.

### Why the dispatcher refuses to run right now (by design, PR #31)

With no SMTP configured, `defaultEmailSender()` resolves to `ConsoleEmailSender` — and a dispatcher
using it would claim every due row, "send" it to stdout and mark it `sent`, **consuming the queue and
destroying notifications nobody received**. Precisely the POD-OTP failure again. So in production
without SMTP the dispatcher refuses: the route returns `503 EMAIL_NOT_CONFIGURED` and the in-process
loop does not arm. Rows stay `pending` and drain for real once credentials land. The guard goes quiet
on its own then — no follow-up needed.

## Deliberately NOT in this branch

- **`bt-auth-service` and `bt-cargo-ledger` still have their own inline SMTP senders.** Migrating them
  onto `@bharattruck/shared/notifications` means adding the `file:` dependency + regenerating their
  lockfiles, and `packages/shared/README.md` mandates that be done one service at a time, CTO-sequenced.
  They already use the identical `SMTP_*` contract, so there is still one mail config to operate. The
  real defect in `bt-auth-service` — a fresh transport (and TLS handshake) built per send, on the login
  path — **is fixed here**, without touching its dependency graph.
- **Digests and reports** (weekly fleet P&L, shipper statements, ops daily digest). The rails carry
  them — `digest` is already a category with an opt-out column, and `delaySeconds` supports scheduling —
  but no digest events are emitted yet. "Your report is ready" additionally has no artifact to point
  at: there is no report-generation feature in the codebase today, only the fleet analytics endpoints.
- **Bounce/complaint handling.** Gmail SMTP gives no webhook. This lands with the provider swap.

## Follow-ups

1. Move to a real transactional provider with a verified sending domain before pilot volume
   (`Appendix A`, ex-`T-CTO-1`, is still formally open). Config-only change.
2. Migrate `bt-auth-service` + `bt-cargo-ledger` onto the shared mailer, CTO-sequenced.
3. Emit the digest events; add report-ready once report generation exists.
4. Rate-limit `register` / `magic-link` (`§5.4` item 2 — SMTP-quota drain) — more urgent now that the
   same SMTP account carries notification volume.
