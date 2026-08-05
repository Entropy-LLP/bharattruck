# BLOCKERS

External dependencies that engineering **cannot unblock by writing code** — registrations,
approvals, credentials and accounts that run on someone else's clock. They are tracked here, with
stable `B-n` ids, because the lead times are long enough that the code has to be built around them
rather than waiting on them: every entry says what has been built *inert* in the meantime, and the
exact switch that turns it on when the blocker clears.

Ids are never reused. Entries are added as blockers are found and kept after they clear (marked
resolved), so a later reader can tell why a seam is shaped the way it is.

---

## B-2 — TRAI DLT registration for transactional SMS

**Status:** not started. Blocks real phone-OTP delivery.
**Owner:** not engineering — DLT registration is filed against the company's legal identity (GSTIN,
authorised signatory, letterhead), so it needs the founder, not a code change.

**What it is.** India does not let an application send commercial SMS on its own say-so. Before an
operator will carry a message, the sender must be registered on a TRAI DLT (Distributed Ledger
Technology) portal, which produces three things:

1. a **principal entity id** for the company,
2. a **registered sender header** (the 6-character id the SMS appears from, e.g. `BHTRUK`),
3. one or more **pre-approved templates** — the exact message text, with variable slots. Text that
   does not match an approved template is rejected by the operator, and a run of rejections is what
   gets a header suspended.

Approval runs weeks, and template approval is a separate round-trip from entity approval.

**Consequence today.** `POST /auth/send-otp` mints a real 6-digit code with `crypto.randomInt`,
stores it in Redis under its TTL, and **prints it to the server log**. Phone login therefore works
only for someone who can read the service log — the pilot operators. No SMS is sent by anything in
this repo.

**What now exists (2026-08-03).** The provider seam from decision **D-14**
(`docs/ARCHITECTURE_UNIFIED_IDENTITY.md`) is built: `bt-auth-service/src/lib/sms.ts`. Every phone-OTP
send goes through one `SmsProvider`, resolved once at boot:

- **`ConsoleSmsProvider` — the default**, and what runs on every environment today. It prints the
  same two lines this service printed before the seam existed, so nothing about the pilot changes.
- **`Msg91SmsProvider`** — a real MSG91 flow-API call, **unreachable without env vars**. No
  credentials exist in any environment, and the resolver will not construct it from a partial
  config.

**The switch.** Live SMS is opt-in *and* all-or-nothing — `SMS_PROVIDER` must select a provider and
every credential it needs must be non-empty, or the service logs one warning at boot and stays on
the console. Setting some but not all of these changes nothing except that warning:

| Env var | Source | Required |
|---|---|---|
| `SMS_PROVIDER=msg91` | ours — the opt-in | yes |
| `MSG91_AUTH_KEY` | MSG91 dashboard | yes |
| `MSG91_SENDER_ID` | **DLT** — the registered header | yes |
| `MSG91_TEMPLATE_ID` | **DLT** — a *pre-approved* template | yes |
| `MSG91_TEMPLATE_VAR` | **DLT** — variable name in that template (default `otp`) | no |
| `MSG91_DLT_TE_ID` | **DLT** — template entity id, when the operator wants it echoed | no |
| `MSG91_BASE_URL`, `SMS_TIMEOUT_MS` | ours — overrides | no |

Documented in `bt-auth-service/.env.example`; pinned by `bt-auth-service/test/sms-provider.e2e.mts`.

**When it clears:** set the vars on the `bt-auth-service` Cloud Run service and redeploy. No code
change, no migration. Confirm the boot line reads `[sms] provider=msg91` rather than the
`SMS_PROVIDER is unset` warning — that line is the difference between codes being delivered and
codes being logged.
