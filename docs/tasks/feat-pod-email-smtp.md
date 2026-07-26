# Task: `feat/pod-email-smtp`

> Worked example of the per-branch task-MD convention — see `docs/BIBLE.md §0.4`. Delete this file on
> merge; git history + `docs/BIBLE.md Appendix B` (scorecard) preserve the permanent record.

**Relates to:** `docs/BIBLE.md §5.1` (service health table), `§5.4` item 10 (known issue), `§7.1`
(deploy runbook's `bt-cargo-ledger` env table), `Appendix A.3` (POD email deliverability was already
flagged as a risk with "no bounce/retry plan").

## What this branch fixes

`bt-cargo-ledger`'s receiver-OTP email (the mechanism that closes a trip on POD, per the frozen
"Never cut" list in `docs/BIBLE.md §2`) was reaching for a **Resend** API key that was never
provisioned on any Cloud Run service and appears in no `.env.example`. `defaultEmailSender()` silently
fell through to `ConsoleEmailSender`, so receiver OTPs were `console.log`'d to Cloud Run stdout and
**never actually delivered** — POD looked wired up (the code path ran, no error surfaced) but wasn't.
The file's header claimed a "CTO decision: Resend as the transactional provider" that was never
actually recorded — the email-provider choice (`docs/BIBLE.md Appendix A`, ex-`T-CTO-1`) is still
formally open.

**Fix:** replace `ResendEmailSender` with `SmtpEmailSender` (nodemailer), reusing the exact `SMTP_*`
env contract `bt-auth-service` already uses for every login OTP/verification/magic-link email — one
mail config to operate instead of two. From-address precedence: `POD_EMAIL_FROM` → `SMTP_FROM` →
`SMTP_USER` (dropped the old hardcoded `@bharattruck.in` default, which the live Gmail SMTP transport
would refuse to send as an unverified From). `.env.example` corrected to list the SMTP vars as
required, not optional — that mislabeling is exactly how this shipped looking green while being
undeliverable. `scripts/ops/fix-blank-env.py` separately repairs the blank-env outage on
`bt-payment-service`/`bt-cargo-ledger` by copying shared secrets from the healthy `bt-booking-service`,
argv-list based so the earlier zsh-quoting bug that zeroed those values can't recur.

## Acceptance criteria

- [x] `SmtpEmailSender` replaces `ResendEmailSender`; transport is injectable (testable without the
      network).
- [x] Sender selection mirrors `bt-auth-service` exactly (`EMAIL_DEV_MODE`/`SMTP_USER`).
- [x] `.env.example` documents the full contract, including `REDIS_URL` (was missing entirely — the
      one var whose absence hard-crashes the service at module load).
- [x] Both runbook docs corrected (now folded into `docs/BIBLE.md §7.1`'s env table).
- [ ] **New env vars actually set on the live `bt-cargo-ledger` Cloud Run service** — `deploy.yml`
      preserves existing env and sets none, so `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/
      `SMTP_FROM` + `EMAIL_DEV_MODE=false` must be set once, or POD mail stays in console-log mode even
      after this branch merges. **This is the actual live-deliverability blocker, not the code.**
- [ ] Branch reviewed + merged to `main` (per `docs/BIBLE.md §4.2`'s stage-gate — not yet audited/
      merged as of this writing).

## Files changed

`bt-cargo-ledger/src/lib/email.ts`, `.env.example`, `package.json`/`package-lock.json` (adds
`nodemailer`), `bt-cargo-ledger/test/email.unit.mts` (new), `docs/runbooks/DEPLOY-stub-pilot.md` +
`docs/runbooks/W1-8-503-env-fix-and-migrations.md` (now superseded stubs pointing at `BIBLE.md §7`,
still correct at their old path too until this branch merges), `scripts/ops/fix-blank-env.py` (new).

## Verification evidence (from the branch, self-reported — not yet CTO-audited)

- `tsc` build green.
- `npm ci` clean (lockfile in sync — the Dockerfile's `npm ci --omit=dev` requires this).
- `test/email.unit.mts`: 18/18 (new).
- `test/pod.e2e.mts`: 16/16 unchanged (real Redis, real cross-service HTTP) — no regression.

## Status

Code-complete on this branch as of 2026-07-20. **Not yet merged to `main`, not yet deployed.** Per
`docs/BIBLE.md §4.2`, this needs a CTO audit (independent reproduction, not a rubber-stamp) before
merge, and per the DEPLOY NOTE above, a founder/infra action to set the new SMTP env vars on the live
service before the fix has any effect in production — merging the code alone does not fix live
deliverability.
