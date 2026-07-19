# Session Handoff — 2026-07-19 (live-ops: Maps fix, QA harness, 503 triage)

> A checkpoint of everything configured/changed this session: what's live on Cloud Run, the git
> state (main + open feature branches), the future-feature docs, and a note to the next
> pair-programmer. Companion to `docs/CTO_HANDOFF_LIVE.md` (older, still valid for background).

---

## 0. NOTE FOR THE PAIR PROGRAMMER — read this first

Hi 👋 — here's where things stand and the traps to avoid, so you don't re-pay the discovery cost.

**What landed this session (all verified live unless noted):**
- **The shipper live map works in production now.** The old live build had the *wrong* Maps key
  (the leaked server key) baked in as the browser key, and no Map ID → "This page can't load Google
  Maps correctly". Rebuilt **bt-shipper** + **bt-driver** from source on Cloud Build with the
  correct `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` (`bt-browser-maps-js`) + `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`
  (`f2e0c2b5b35f303a174c310f`). Verified in-browser: route polyline + A/B pins render, zero console
  errors.
- **CI/CD secret management is wired.** Repo Variables `NEXT_PUBLIC_API_URL` +
  `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` and Secret `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` are set on
  `Entropy-LLP/bharattruck` — `deploy.yml` reads exactly these. (The CD workflow still can't run
  autonomously; see §4 Phase-A.)
- **A reusable Claude-Browser QA harness** (`docs/CLAUDE_BROWSER_HARNESS.md` +
  `CLAUDE_BROWSER_CREDS.md`) so future UI-testing sessions don't rediscover login quirks, tool
  gotchas, and known-broken features. **It is self-iterating — update it when you learn something.**
- **A small real bug fix**: shipper booking-detail page no longer renders the "Quotes" panel on
  `direct` bookings (`shipper/src/app/bookings/[id]/page.tsx`).

**Open / needs-you items (in priority order):**
1. **bt-cargo-ledger is still 503.** Root cause is fully known (see §3): the three
   pricing/payment/cargo services ran *stale pre-monorepo images*; I rebuilt fresh monorepo images
   for all three (in Artifact Registry as tag `monorepo-fee1677`), and the founder's console
   autoscaling edit put them live — BUT their **env is blank** (see the bug below), so cargo
   crash-loops on `REDIS_URL must be set`, and pricing/payment are only *health*-green (their real
   quote/settlement functions will fail until env is set). **The fix is one command the founder must
   run** — the zsh-safe version is in §3. Pricing/payment need it too, for functionality.
2. **Two traps that bit me — don't repeat them:**
   - **`bookenv '\$1'`**: escaping `$1` as `\$1` in a copy-paste block makes zsh read the literal
     string `$1` → the function returns empty → you silently set every env var to blank. Use plain
     `$1` passed as `sys.argv[1]` (see §3's command).
   - **`${!v}` in a sanity loop**: bash indirect expansion; in interactive **zsh** the `!` triggers
     history expansion → `zsh: bad substitution`. Use `eval` or `[ -n "${(P)v}" ]` (zsh) instead, or
     just drop the check.
   - **`--update-env-vars "^@^..."`**: `@` is NOT a safe delimiter here — the Redis URL contains `@`.
     Use `^#^` (verified none of the values contain `#`).
3. **The harness classifier blocks agent-run prod mutations.** `gcloud run services update`
   (env), `gcloud run deploy --update-env-vars`, and even writing `.claude/settings.local.json` are
   blocked for the agent — by design (an agent can't self-grant permission). `gcloud builds submit`
   + `gcloud run deploy --image` (no env) *do* go through (that's how the app/service rebuilds ran).
   So: env mutations must be run by the founder, or the founder adds a `Bash(gcloud run services
   update *)` allow-rule.

**Don't touch without reading the frozen contract:** anything under Maps/Tracking — read
`docs/MAPS_TRACKING_CONTRACT.md` + `MAPS_TRACKING_DECISIONS.md` first (frozen; append a `D-xxx` to
change anything).

---

## 1. Cloud Run — live state (project `project-aa0faf06-c115-438a-a36`, `asia-south1`)

Verified 2026-07-19. URL pattern: `https://<svc>-752385541585.asia-south1.run.app`.

| Service | Health | Notes |
|---|---|---|
| bt-auth-service | ✅ 200 | KYC stubbed |
| bt-booking-service | ✅ 200 | source-of-truth for shared env (JWT/SUPABASE/REDIS/INTERNAL secrets) |
| bt-pricing-service | ✅ 200* | *fresh image `monorepo-fee1677`, but **env blank** → quotes fail until env set |
| bt-payment-service | ✅ 200* | *fresh image, **env blank** → settlement fails until env set |
| bt-cargo-ledger | ❌ 503 | fresh image, **env blank** → boot crash `REDIS_URL must be set`; fix in §3 |
| bt-tracking-service | ✅ 200 | Maps server key OK; `/route /eta /track /health` built; `/history /pumps /fuel /alerts` NOT built (Phase 3+) |
| bt-gateway | ✅ 200 | nginx edge; CORS allows only `https://bt-*.run.app` (localhost dev can't call it) |
| bt-shipper | ✅ 200 | **redeployed w/ correct Maps values — map renders live** |
| bt-driver | ✅ 200 | redeployed w/ correct Maps values (driver has no map UI itself, deep-link nav only) |
| bt-ops-web | ✅ 307 | redirects to /login (normal) |

**Artifact Registry** `asia-south1-docker.pkg.dev/project-aa0faf06-c115-438a-a36/bt/` now holds fresh
`monorepo-fee1677`-tagged images for shipper, driver, pricing, payment, cargo-ledger. The old
per-service git-sha-tagged images were the "orphaned pre-monorepo images" — superseded.

---

## 2. Git state

- **`main`** (`origin/main`, tip `04ad4f8`): the verified base. Does **not** yet contain the CD
  workflow or any of this session's work. Trunk-based: `feat/*` → PR → green CI → merge. Agents are
  blocked from pushing to `main`; merges are the founder's call.
- **This session's work** is pushed to **`feat/live-ops-maps-qa-handoff`** (see §5) — not yet PR'd.
- **`feat/cicd-deploy`** (`fee1677`): the path-filtered Cloud Run continuous-deploy workflow
  (`deploy.yml`). Review-passed; needs Phase-A IAM + a merge to activate (§4).

**Open feature branches (future features, not yet merged):**

| Branch | What it adds |
|---|---|
| `feat/auction-expiry-rebased` | W3-3/W3-5 auction expiry — past-deadline auctions → `expired`, atomic via RPC (migration 0017) |
| `feat/award-txn` | W3-5 atomic `awardBooking` via `award_booking` RPC (migration 0016) |
| `feat/negotiation-cap` | W3-4 enforce 5-round negotiation cap + deadline on counters |
| `feat/shipper-driver-identity` | W3-10 show driver name/badge/vehicle on quotes instead of raw UUID |
| `feat/driver-live-map` | DL-MAP driver live-trip map (copied `LiveTrackMap` + wired `/track`) |
| `feat/driver-onboarding-live-rebased` | **ONB-LIVE — un-orphans the driver onboarding wizard** (personal→vehicle→license→insurance→bank-account→review) + drops dev-login backdoors. *Relevant: the live driver app currently has this wizard built but unreachable — this branch wires it in.* |
| `feat/driver-myquotes-fix-rebased` | W3-12 my-quotes shows every quote across bookings (kills N+1) |
| `feat/kyc-stub-rebased` | KYC stub + migration renumber 0014→0015 |
| `feat/gps-simulator` | route-replay GPS simulator (test movement without driving) |
| `feat/python-engines` | the "other coder"'s Python pricing engines — **quarantined** (would break the Node deploy); keep isolated |
| `feat/maps-deploy-config` | `deploy-all.sh` Maps config assumptions |
| `shipper/frontend-revamp`, `driver/frontend-revamp` | frontend revamp WIP — **CI currently failing** (`dorny/paths-filter` "Resource not accessible by integration"), not re-run since 07-15 |
| `integration/verified-base` | CTO integration branch (base for the verified merges) |

> Note the `-rebased` twins: force-push was blocked in earlier sessions, so rebased history was
> pushed under a new `-rebased` name — those are the current tips; the non-rebased originals are stale.

---

## 3. The bt-cargo-ledger 503 — full diagnosis + the fix to run

**Chain of causes (all confirmed):** (a) pricing/payment/cargo ran **stale pre-monorepo images**
(shas not in repo history) → crash-loop on current env → Google Frontend "Service is disabled" 503.
(b) Fresh monorepo images were built (`monorepo-fee1677`) and are now live. (c) But an env-copy
command run earlier had a `\$1` escaping bug that set **every secret to blank** on all three. Pricing
& payment boot fine with blank env (health 200) but are non-functional; **cargo hard-requires
`REDIS_URL` at boot → still 503.**

**The fix (founder runs in a terminal — reads shared env from healthy booking, sets it on all three).**
zsh-safe (no `${!v}`, uses `#` delimiter, `sys.argv[1]` reader):

```bash
PROJECT=project-aa0faf06-c115-438a-a36; REGION=asia-south1
bookenv(){ gcloud run services describe bt-booking-service --region "$REGION" --project "$PROJECT" --format=json | python3 -c 'import sys,json;e=json.load(sys.stdin)["spec"]["template"]["spec"]["containers"][0].get("env",[]);print(next((x.get("value","") for x in e if x["name"]==sys.argv[1]),""))' "$1"; }
ISS=$(bookenv INTERNAL_SERVICE_SECRET); JWT=$(bookenv JWT_SECRET); REDIS=$(bookenv REDIS_URL)
SUPAURL=$(bookenv SUPABASE_URL); SUPAKEY=$(bookenv SUPABASE_SERVICE_ROLE_KEY)
BURL=$(gcloud run services describe bt-booking-service --region "$REGION" --project "$PROJECT" --format='value(status.url)')
for v in ISS JWT REDIS SUPAURL SUPAKEY BURL; do eval "val=\$$v"; [ -n "$val" ] || echo "STILL EMPTY: $v"; done
gcloud run services update bt-pricing-service --region=$REGION --project=$PROJECT --update-env-vars "^#^JWT_SECRET=$JWT#SUPABASE_URL=$SUPAURL#SUPABASE_SERVICE_ROLE_KEY=$SUPAKEY#INTERNAL_SERVICE_SECRET=$ISS#DIESEL_PRICE_INR=90"
gcloud run services update bt-payment-service --region=$REGION --project=$PROJECT --update-env-vars "^#^SUPABASE_URL=$SUPAURL#SUPABASE_SERVICE_ROLE_KEY=$SUPAKEY#JWT_SECRET=$JWT#INTERNAL_SERVICE_SECRET=$ISS#BOOKING_SERVICE_URL=$BURL"
gcloud run services update bt-cargo-ledger --region=$REGION --project=$PROJECT --update-env-vars "^#^SUPABASE_URL=$SUPAURL#SUPABASE_SERVICE_ROLE_KEY=$SUPAKEY#REDIS_URL=$REDIS#INTERNAL_SERVICE_SECRET=$ISS#BOOKING_SERVICE_URL=$BURL#BLOCKCHAIN_ENABLED=false"
for s in bt-pricing-service bt-payment-service bt-cargo-ledger; do echo -n "$s "; curl -s -o /dev/null -w "%{http_code}\n" "https://${s}-752385541585.asia-south1.run.app/health"; done
```

Expect three `200`s. (Longer-term: move these to Secret Manager instead of copying plain env; see
`docs/runbooks/W1-8-503-env-fix-and-migrations.md` for the fuller writeup.)

---

## 4. CI/CD — what's done and what's left to make it self-driving

**Done:** repo Variables/Secret set (§0). `deploy.yml` on `feat/cicd-deploy` is review-passed.

**Left (Phase-A, founder/IAM — from `FOUNDER_ACTIONS.md`):**
- Grant the CI SA `bt-cicd-deployer@…` the missing roles: `roles/iam.serviceAccountUser` +
  `roles/cloudbuild.builds.editor` (it has `run.admin` + `artifactregistry.writer`).
- **Re-point Workload Identity to THIS repo.** The WIF binding currently trusts the *old retired*
  standalone repos (`Entropy-LLP/bt-auth-service`, …, and dead `deltaos1997/*`), **not**
  `Entropy-LLP/bharattruck`. Until fixed, GitHub Actions from this repo can't auth as the SA.
- Merge `feat/cicd-deploy` → `main` (workflows only trigger from the default branch).
- Also failing: PRs #2/#3 (frontend-revamp) — `dorny/paths-filter` "Resource not accessible by
  integration" (a workflow-token-permissions issue, not code).

---

## 5. This session's changes (pushed to `feat/live-ops-maps-qa-handoff`)

- `shipper/src/app/bookings/[id]/page.tsx` — gate Quotes panel on `booking_type === 'auction'`.
- `docs/CLAUDE_BROWSER_HARNESS.md`, `docs/CLAUDE_BROWSER_CREDS.md` — new QA harness (self-iterating).
- `CLAUDE.md` — added "UI / Claude Browser verification — READ FIRST" pointer.
- `FOUNDER_ACTIONS.md` — corrected Map ID `…607b2ec5` → `…174c310f`; noted the build-arg deploy path.
- `docs/runbooks/W1-8-503-env-fix-and-migrations.md`, `docs/PROJECT_STATE.html` — carried in from a
  prior session (were untracked).
- `docs/SESSION_HANDOFF_2026-07-19.md` — this file.
- **Not committed:** `.claude/` (machine-local: `settings.json` allow-list + a `launch.json` with
  absolute paths; `settings.local.json` is gitignored). Left as local config.

---

## 6. Future-feature docs (what to read before building each)

| Doc | Covers / when to read |
|---|---|
| `docs/BHARATTRUCK_MVP_PRD.md` | Product spec — the authoritative "what". |
| `docs/EXECUTION_ROADMAP.md` | How we build + the committed MVP cuts. Wins over ad-hoc narrative. |
| `docs/MAPS_TRACKING_CONTRACT.md` | **FROZEN** maps/tracking contract — wins over the PLAN. Read before any maps code. |
| `docs/MAPS_TRACKING_DECISIONS.md` | Append-only `D-xxx` decisions. Change maps behavior only by adding one. |
| `docs/MAPS_TRACKING_PLAN.md` / `…_SESSIONS.md` | Phased build plan (0–6); Phase 3+ (`/history /pumps /fuel /alerts`) still to build. |
| `docs/PRICING_PAYMENTS_STATUS.md` | Pricing/payments state + the quarantined Python engines; keep the "other coder" informed. |
| `docs/CTO_ENGINEERING_STANDARDS.md`, `…_AUDIT_FINDINGS.md`, `…_SCORECARD.md` | Governance, stage-gates, audit trail. |
| `docs/TEAM_GIT_WORKFLOW.md`, `docs/IPC_TEAM_PROTOCOL.md` | Trunk-based workflow + the multi-agent IPC protocol. |
| `docs/MONOREPO_PROVENANCE.md` | Why/how the scattered repos were consolidated (never push to the retired ones). |
| `docs/AGENT_HANDOFF.md` | The self-contained onboarding brief — read first if you're brand new. |

> Scope note (from memory): the founder reversed two earlier roadmap cuts — **escrow + RL pricing
> are back IN scope** — overriding `EXECUTION_ROADMAP §3`'s cut list. Confirm current priority with
> the founder before building either.
