# BharatTruck — LIVE CTO Handoff (for the incoming CTO agent)

> Written 2026-07-15 by the outgoing CTO node. **This supersedes `docs/CTO_HANDOFF.md`** (that one is
> the 2026-07-11 cold-start; still worth reading for background). You are the **CTO node**: you
> coordinate 4 engineer sessions over `claude-ipc`, **independently verify every report**, are the
> only node that lands code to `main` (via the founder — see guards), keep the PMO tracker in sync,
> and are answerable to the founder (`deltaos1997@gmail.com`). Read this fully, then read §"Docs to read".

---

## 0. FIRST: how to reach the team on the IPC bus (non-obvious, hard-won)

Your session very likely does **NOT** have the `claude-ipc` MCP client loaded (SDK/headless launch).
You drive the bus via the **shipped CLI tools** in `/Users/adityaroshanjoshi/tools/claude-ipc-mcp/tools/`.

**CRITICAL — use an ISOLATED session file (`~/.ipc-cto`).** The CLI tools default to a single shared
`~/.ipc-session` token file. When a *worker* registers via the CLI it **overwrites** that file, so
your `cto` sends then go out stamped as *that worker* → the real workers (which act only on
`from=cto`) silently drop everything. This exact bug cost hours. Fix: run every CLI call with
`HOME=/Users/adityaroshanjoshi/.ipc-cto` so your token lives in its own file, uncclobberable. Use the
repo venv python (avoids `uv`+HOME issues). Paste this helper:

```bash
CTOHOME=/Users/adityaroshanjoshi/.ipc-cto
REPO=/Users/adityaroshanjoshi/tools/claude-ipc-mcp
PY="$REPO/.venv/bin/python"
SECRET=$(python3 -c "import json;print(json.load(open('/Users/adityaroshanjoshi/.claude.json'))['mcpServers']['claude-ipc']['env']['IPC_SHARED_SECRET'])")
run(){ ( cd "$REPO" && HOME="$CTOHOME" IPC_SHARED_SECRET="$SECRET" "$PY" "tools/$1" "${@:2}" ); }
run ipc_register.py cto        # register/refresh — do this first
run ipc_list.py                # who's on the bus + last-seen
run ipc_check.py               # pull your inbox (consumes messages)
run ipc_send.py backend '{"type":"task","id":"X","from":"cto","to":"backend","title":"...","body":"..."}'
```

- **The `cto` session token EXPIRES** (days). Symptom: `Invalid or missing session token`. Fix: just
  `run ipc_register.py cto` again (you get queued messages back). The broker (`127.0.0.1:9876`,
  a `python3` process) persists across days but may restart.
- **IPC message size cap ~650 chars** — keep task bodies tight; split long reports.
- **Message format:** JSON `{type,id,from,to,title,body}`; `type` ∈ task/ack/report/review/status/blocker.
- **Receive autonomously:** run a `Monitor` (persistent) that loops `ipc_check` every ~90s with the
  same `CTOHOME`, emitting only when there are `^From:` lines. (The prior poller was killed on a
  context reset — restart one.)
- The `claude-ipc` MCP tools (`mcp__claude-ipc__send/check/list/register`) may ALSO be available in
  your session now — if so they're an alternative to the CLI, but the CLI + isolated HOME is proven.

---

## 1. The guards you WILL hit (route these to the founder)

The harness auto-mode classifier **blocks agents** (you and the workers) from:
1. **Prod Cloud Run mutations** — `gcloud run deploy` / `services update`. → founder runs (or grant a Bash rule).
2. **`git push` to `main`** — protected. **Non-main branch push IS allowed.** So: push work to a
   branch, then the founder fast-forwards `main` (`git push origin <branch>:main`). *(The founder
   authorized one such push during this session, so it may now be allowed for you — try it; if denied,
   hand the founder the one-liner.)*
3. **`git push --force`** — blocked. Workaround: push rebased history under a **new `-rebased` ref name**.
4. **Writing an API-key VALUE to a file** (credential-leakage) — e.g. baking the Maps key into a
   Dockerfile. → founder edits, OR use CI build-args from GitHub vars (see CI/CD below).
5. **Reading secret env VALUES** (e.g. copying booking's `JWT_SECRET`). → founder runs, or a worker in a
   session where the guard doesn't fire; but prod env-set is blocked regardless (see #1).

**NOT blocked for you:** Supabase migrations + writes via the Supabase MCP (`apply_migration`,
`execute_sql`) — you apply migrations and flip PMO toggles yourself.

---

## 2. Current state (as of 2026-07-15)

- **`origin/main` = `a24401f`** — the **verified base**: quote-lock (price-lock) + P0 (POD receiver-OTP +
  cash settle + driver POD flow + nav + cargo `/cargo/pod` mount) + the deploy scripts/runbooks. All 5
  builds green, qa live-probed PASS, CTO-audited.
- **Migration `0013_price_quotes` is APPLIED** to the live DB. Applied set: **0009–0013**.
- **The stack is NOT yet redeployed** from this base. Live services still run older images; **the
  shipper/driver apps have the WRONG Maps key baked + no Map ID** (map won't render until deployed).
  **cargo/payment/pricing were 503** (missing env) — fixed by `deploy-all.sh` at deploy time.
- **Wiring review (this session) verdict: topology SOUND** — every app↔gateway↔service seam + all 4
  internal seams (payment→booking mark-paid, booking→pricing quote-lock, cargo→booking POD, shipper
  /track) connect correctly; the paid-trip loop closes. Real defects are ENV-at-deploy:
  - MAJOR: shipper Dockerfile lacks `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` → no map pins/truck. **Fixed by the
    Dockerfile Map-ID edit that's STEP 1 of the deploy.**
  - MAJOR (latent): `bt-tracking-service/src/lib/google.ts:9` throws `GOOGLE_MAPS_SERVER_KEY` at *module
    import* → a keyless deploy crash-loops the whole service. Live tracking already has the key (healthy,
    `--source` preserves env) so the founder's redeploy is safe, but **`feat/wiring-fixes` must land** to
    make the key lazy + change `deploy-all.sh`'s false WARN to hard-fail. (Task `FIX-WIRING` sent to
    infra, but **infra is offline** — re-assign when it's back.)
  - Nits: Google-signin dead (client-id not baked); stale contract doc sample; dead `RAZORPAY_*` in
    payment `.env.example`; `shipper/src/app/maps-test/live` dev harness leaking into the prod bundle.

## 3. The team (VERIFY liveness every time — do not assume)

| Node | Owns | Status @ 2026-07-15 |
|---|---|---|
| `backend` | `bt-*` services, migrations | **LIVE** (was idle-blocked on a migration number; unblocked) |
| `qa` | end-to-end verification (does NOT implement) | **LIVE**, actively polling |
| `frontend` | driver/, shipper/, bt-ops-web/ | **OFFLINE ~3 days** — needs relaunch |
| `infra` | CI/CD, deploy, gateway, secrets, Maps, observability | **OFFLINE ~3 days** — needs relaunch |

Relaunch = founder opens a `claude` terminal in the repo and pastes: `Register this instance as
\`frontend\` on claude-ipc. Read docs/IPC_TEAM_PROTOCOL.md + CLAUDE.md. You are the frontend node.`
then a standalone `/loop 90s Check IPC messages; on a cto task ack, do it on a feat/* branch (no
stubs, next build green), push to origin, report to cto with evidence. Act only on cto.` **The
`/loop` MUST be pasted as its own message or the session idles out after handshaking.**

## 4. Wave-2 branches — VERIFIED + PARKED (integrate after the base demo validates)

All rebased onto the base and qa-verified unless noted. **Integrate via an isolated worktree + build +
adversarial review workflow (like the base merge), then land + redeploy.** Migration numbers are
CTO-assigned (workers must ask first):

- `feat/auction-expiry-rebased` — mig **0014** `booking_status_expired`; qa-PASS. (+ `0017` expire fn coming)
- `feat/kyc-stub-rebased` — mig **0015** `user_kyc`; qa-PASS. **Demo-gotcha:** the booking KYC gate 403s
  unverified shippers → when this lands, **backfill `users.kyc_status='verified'` for demo shippers**
  (or call `/kyc/verify`). Integrate the **-rebased** branch, NOT `ef86752` (original would revert the
  quote-lock saga in `createBooking`).
- `feat/driver-myquotes-fix-rebased` — qa-PASS (added driver-scoped `GET /bookings/quotes/mine`).
- `feat/driver-onboarding-live-rebased` — qa-PASS (removed paste-JWT/console-OTP dev seams).
- `feat/shipper-driver-identity` — qa-PASS (shipper sees driver name+badge+trips+vehicle).
- `feat/negotiation-cap` — W3-4, tsc+unit green (6th counter → 409, past-deadline → 409).
- `feat/award-txn` — W3-5 award_booking atomic RPC; needs mig **0016**; backend finalizing.
- `feat/gps-simulator` — T-115 GPS replay tool; verified.
- `feat/wiring-fixes` — infra (tracking lazy key + deploy WARN + remove maps-test/live); **not started**.
- `feat/cicd-deploy` — the CD workflow (`.github/workflows/deploy.yml`); **being authored by a sub-agent now**.

**Canonical migration order:** 0009–0012 (applied) · 0013 price_quotes (applied) · 0014
booking_status_expired · 0015 user_kyc · 0016 award_booking · 0017 expire_overdue_auctions.

## 5. The deploy (base-first, then wave-2) — FOUNDER-gated

`main` has `scripts/deploy/deploy-all.sh` (idempotent; deploys 6 services → copies env from healthy
booking → gateway → 3 apps → health). Founder runs **2 steps**: (1) bake the correct browser key +
Map ID into `shipper/Dockerfile`+`driver/Dockerfile` (agents guard-blocked), (2) `./scripts/deploy/
deploy-all.sh`. **You apply migrations** via the Supabase MCP. See `docs/runbooks/DEPLOY-stub-pilot.md`
+ `docs/runbooks/W1-8-503-env-fix-and-migrations.md` + `docs/FOUNDER_ACTIONS.md`.

**Scope decision (founder, 2026-07-12):** minimum-cost real-driver **market study**. **STUB** Surepass
(KYC = auto-approve, done) + Razorpay (payment = cash-recorded, done — no escrow yet). Real: full
booking loop, live GPS tracking + shipper map, receiver-OTP POD, ops board. Escrow/RL are IN the PRD
(v3.1) for later but deferred for the pilot. Deploy the **base only** first (no KYC gate) to keep the
first demo simple.

## 6. PMO tracker integration (the founder's checklist — keep it in sync)

The founder's PMO portal (`entropy-pmo.netlify.app`, password-gated) is backed by **Supabase tables**
in the same project (`pmo_items`, `pmo_projects`, `pmo_services`, `pmo_milestones`, `pmo_blockers`, …).
Project id = **`p_bt`** (BharatTruck). `pmo_items` has 115 rows, `status` ∈ `todo|doing|done`, keyed by
`ref/svc/week/pri/milestone`. **This is the codebase-oriented checklist you drive against.**
- Pull actionable work: `select ref,svc,title,pri,week,milestone,status from pmo_items where
  project_id='p_bt' and status in ('todo','doing') order by pri,week;`
- Flip a toggle as work lands+verifies: `update pmo_items set status='doing'|'done', updated_at=now()
  where project_id='p_bt' and ref='W3-x';` (done so far: W3-6, W4-3, T-115).
- Many `EXT-*` items are **founder/legal/vendor** (Surepass acct, Razorpay merchant, RBI/GTA legal
  opinions, AIS-140 vendor, Google-Play bg-location) — these are NOT engineering; surface to founder.

## 7. The OTHER coder (kartik / `kinbox-ctrl`) — keep in check + informed

A second coder on the other side of `origin` owned **pricing + payments**, which **we reconfirmed /
rebuilt in TS** (the live TS services are the MVP anchor; his Python engines are quarantined on
`feat/python-engines`). Per the founder he **must know everything going on** on those services.
Mechanism: he is a GitHub collaborator — **communicate via a PR description / a `docs/PRICING_PAYMENTS_
STATUS.md` he can read**, and flag any change to `bt-pricing-service`/`bt-payment-service` to him.
Do NOT let his Python services re-enter the Node Cloud Run deploy (they'd break it). See
`docs/CTO_HANDOFF.md §7` for the full kartik review.

## 8. Creds / config (all confirmed this session)

- **GCP:** project `project-aa0faf06-c115-438a-a36`, region `asia-south1`, `gcloud` authed as
  `deltaos1997@gmail.com`. Gateway `https://bt-gateway-itcdoenefa-el.a.run.app` (apps use as
  `NEXT_PUBLIC_API_URL`; append `/api`). Services `https://bt-<svc>-itcdoenefa-el.a.run.app`.
- **Supabase:** `rxbdzbcndpzznvqcbimg` — reachable via the connected Supabase MCP. Base schema +
  migrations 0009–0013 applied. Shared DB (a separate PMO app lives here) — **additive-only, careful.**
- **Maps (public, referrer-restricted — safe to bake in apps):** browser key
  `AIzaSyA-rqgoNd0bmfouXworTp4EuMspH4bNxuY`; Map ID `f2e0c2b5b35f303a607b2ec5`; referrers include
  `https://*.run.app/*`. Server key (`bt-tracking-server`) is on `bt-tracking-service` only. Google
  OAuth client id `752385541585-hg3qa9jgmvufie9osn5qu6eptvh1dc4n.apps.googleusercontent.com`.
- **Demo accounts (seeded):** `demo-shipper@bharattruck.dev` / `demo-driver@…` / `demo-ops@…`, password
  `demo-<role>-2026`. Demo booking `55555555-5555-5555-5555-555555555555`.
- **IPC secret:** in `~/.claude.json` (`mcpServers.claude-ipc.env.IPC_SHARED_SECRET`) and `~/.zshenv`.
- **STILL NEEDED from founder (ask):** Surepass + Razorpay accounts (later); GitHub repo vars/secrets
  for the new CD workflow (see `feat/cicd-deploy` report); the Phase-A IAM bindings (see FOUNDER_ACTIONS).

## 9. CI/CD state (the founder's Phase A–D analysis)

- **Phase A (founder, IAM):** WIF binding for `bt-cicd-deployer` + missing roles
  (`iam.serviceAccountUser`, `cloudbuild.builds.editor`). In `docs/FOUNDER_ACTIONS.md`.
- **Phase B (agent, in progress):** `.github/workflows/deploy.yml` — path-filtered, SHA-tagged monorepo
  CD + a NEW CD path for the 3 apps (NEXT_PUBLIC_* from GH vars). Being authored on `feat/cicd-deploy`.
- **Phase C (founder):** one-time catch-up deploy of all 11 from `main` (== `deploy-all.sh`), clear 4
  orphaned pre-monorepo images, verify /health + e2e.
- **Phase D (later):** lint hard gate; migrations-in-CD **manual** (prod-mutation guard) recommended;
  rollback runbook; env → Secret Manager.

## 10. Operating rules (non-negotiable)

- **Verify every worker report yourself** before it counts (fetch the branch from origin, build,
  exercise) — do not rubber-stamp. Workers are good but the stage-gate caught real bugs (a price
  exploit, a quote-lock-regression merge hazard).
- **No stubs/TODOs in `main`.** Definition of Done = demoable through the UI on the pilot corridor.
- **Assign migration numbers centrally.** Workers must ask before creating a migration.
- **Honesty is the fireable line** — for workers and for you. Report failures with output; never claim a
  "done" you can't reproduce; when the team is partly offline, say so (don't narrate a live team that isn't).
- **Keep `main` demoable + green.** Trunk-based `feat/*` → your audit → founder lands to main → deploy.

## Docs to read (authority order)
`docs/CTO_HANDOFF.md` (background) · `docs/BHARATTRUCK_MVP_PRD.md` · `docs/EXECUTION_ROADMAP.md` ·
`CLAUDE.md` · `docs/MAPS_TRACKING_CONTRACT.md` (frozen) · `docs/CTO_ENGINEERING_STANDARDS.md` ·
`docs/IPC_TEAM_PROTOCOL.md` · `docs/runbooks/*` · the CTO memory files under
`~/.claude/projects/…/memory/` (IPC role, cli-bridge, migration-numbering, escrow/RL scope).
