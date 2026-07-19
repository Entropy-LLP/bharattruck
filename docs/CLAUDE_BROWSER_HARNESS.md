# Claude Browser Testing Harness — BharatTruck

> **READ THIS FIRST, before opening a browser tab to test anything.** This doc exists so every
> session doesn't re-pay the token cost of rediscovering how to test this app in Claude Browser —
> which URLs to hit, how login works, what's already known-broken, and where the landmines are.
> Companion doc: **`docs/CLAUDE_BROWSER_CREDS.md`** (links + demo credentials, kept separate on
> purpose — see that file's header for why).

---

## 0. The update rule — read this even if you skip everything else

**This is a living document. If you learn something it doesn't say — a new Claude Browser gotcha,
a feature that broke or got fixed, a URL that changed, a credential that stopped working — you
MUST update this file (or `CLAUDE_BROWSER_CREDS.md` for links/creds) before your session ends.**

- Append, don't silently overwrite. If a "known issue" you logged got fixed, move it to the
  changelog as fixed rather than deleting it silently — that's useful history.
- Date every addition (`YYYY-MM-DD`, matching the project's date convention).
- If you *reverify* an existing entry and it's still accurate, you don't need to touch it. If it's
  now wrong, correct it in place and note in §8 that you did.
- A stale harness costs the next session more tokens re-discovering context than the two minutes
  it takes you to add a line. **Do not skip this because the session is "just testing."**
- This file is a normal tracked doc, not append-only like `MAPS_TRACKING_DECISIONS.md` — keep it
  *current*, not exhaustive. Prune dead/superseded advice instead of letting it accumulate.

---

## 1. Aim / scope

The recurring job this harness supports: **open the shipper and/or driver app in Claude Browser
and verify the UI actually works** — renders, connects to the backend, and the *core* features
function — not just that `next build` succeeds or an endpoint returns 200. Definition of done for
a pass: every core screen loads without a blank/broken render, console errors are triaged (infra
vs. real bug), and anything GPS/Maps-related is checked with extra care since it's the feature
most likely to silently degrade (wrong key, missing Map ID, stale cache).

**Standing scope rule, unless the user in a given session says otherwise:** the booking
creation/negotiation/auction flow (shipper "New Booking", driver "Browse"/submit-quote) is
considered already verified and is **out of scope** for a routine pass — don't spend a session
re-clicking through it. Test *around* it: existing-booking views, tracking, POD, payments,
profile, ops overrides, and anything GPS/Maps. If a session's actual assignment is different
(e.g. explicitly asked to test the booking flow), that instruction wins — this is a default, not
a hard rule.

---

## 2. Where the app lives

Full URL table + demo logins are in `docs/CLAUDE_BROWSER_CREDS.md`. Short version:

- **Test against the live Cloud Run deployment, not local dev.** The whole stack (7 backend
  services + gateway + 3 apps) is already deployed to `project-aa0faf06-c115-438a-a36` /
  `asia-south1` and reachable over HTTPS. Standing up docker-compose + every service's env locally
  is far more expensive than it looks and is almost never necessary just to check the UI.
- Open apps directly: `mcp__Claude_Browser__preview_start({ url: "<app-url>" })` — no dev server
  needed. Use `navigate` on the same tab to move between apps instead of opening a new
  `preview_start` each time.
- Local dev is only worth it if you need to iterate on a *fix* (change code, see it live) rather
  than just observe. If you do run local dev: `NEXT_PUBLIC_API_URL` can point at the **live prod
  gateway** (no local backend needed) — see creds doc for the exact value. Neither app has an
  `.env.local` checked in (gitignored, and none exists on disk as of 2026-07-18) — you'll need to
  either export the vars before `npm run dev` or write a throwaway `.env.local` (don't commit it).
- **Do not attempt to redeploy, `gcloud run deploy`, or change Cloud Run env vars yourself.** Prod
  mutations are reserved for the founder (see `FOUNDER_ACTIONS.md` and `CLAUDE.md`). Diagnose and
  report; draft the fix command if useful; don't run it.

---

## 3. Claude Browser tool notes (gotchas learned the hard way)

- **`tabId` is not optional in practice.** The tool schemas say some calls default to "the fronted
  tab," but in this session the very first `computer`/`read_console_messages` call right after
  `preview_start` errored (`expected string, received undefined`) until `tabId` was passed
  explicitly. Call `tabs_context` right after `preview_start` to get the real `tabId` (it was
  `"seed"` this session, but don't hardcode that assumption) and pass it on **every** subsequent
  call.
- **Prefer `read_page` → `ref_N` clicks over raw coordinate clicks.** A coordinate click on a tab
  button (e.g. the login page's "Email" tab) silently no-op'd once — likely a toast/overlay
  shifting layout. The `ref`-based click on the same element worked immediately. When a click
  seems to do nothing, re-run `read_page` and click by `ref` instead of nudging coordinates.
- **Both apps' login screens default to the "Phone" tab.** Phone OTP has no SMS provider wired
  (see `CLAUDE.md` — console-logs only), so it's a dead end for testing. Click the **"Email"** tab
  and use the demo email/password creds. There's also a "Dev: Paste JWT directly" collapsible on
  both login pages — faster than the UI form if you already have a raw JWT from a prior check.
- **To see which runtime config is actually baked into a live bundle** (e.g. which Maps API key
  shipped), don't rely on `read_network_requests` alone — the Maps JS loader's own request didn't
  show up in one session's recorded network log at all. Instead run `javascript_tool` and read
  `document.querySelectorAll('script')` `src` attributes directly; the API key is a visible query
  param on the `maps.googleapis.com/maps/api/js?...&key=...` script tag. (This is fine to do for
  the browser key specifically — it's referrer-restricted and meant to be public; never do this to
  go hunting for a *secret* key, there isn't one client-side to find.)
- **A broken Google Maps key surfaces as Google's own modal**, layered over the app UI: "This page
  can't load Google Maps correctly / Do you own this website?" That text alone doesn't tell you
  *why* — always cross-check `read_console_messages` for the real reason (`InvalidKeyMapError`,
  `RefererNotAllowedMapError`, "initialised without a valid Map ID", etc.).
- **Check mobile viewport, not just desktop.** `resize_window` presets: `mobile` = 375×812,
  `tablet` = 768×1024, `desktop` = 1280×800. Both apps are PWAs aimed primarily at phones — driver
  especially (truck drivers use phones, not desktops) — so a desktop-only pass misses real bugs.
- **Local dev servers work, but two separate things will trip you up — fix both, in order.**
  (2026-07-18, corrected after a second attempt — the first write-up of this gotcha was an
  incomplete diagnosis, see below.)
  1. **Node version.** This machine's default `node` (nvm) resolves to **v16.20.2**, but Next 16
     needs `>=20.9.0` — `npm run dev` fails immediately with a clear version error. `nvm list`
     shows several v20+ options are installed (`v20.17.0`, `v20.20.0`, `v22.x`, `v23.x`); v20.20.0
     is the one already proven to work for this repo's builds (see `[[bharattruck-frontend-node]]`
     memory / `docs/CLAUDE_BROWSER_HARNESS.md` history). Fix in `.claude/launch.json`: point
     `runtimeExecutable` at the absolute binary
     (`/Users/<user>/.nvm/versions/node/v20.20.0/bin/npm`) **and** set `env.PATH` to a literal
     string with that bin dir first — don't rely on `$PATH` expansion inside the JSON env value,
     it isn't guaranteed to expand; write out the full resolved PATH. Once fixed, `preview_logs`
     shows a clean `▲ Next.js ... Ready in Nms` with no version error.
  2. **The "Policy check in progress" / navigation-denied error from the first attempt was a
     transient hiccup, not a real sandbox restriction** — a later attempt against the same kind of
     `localhost` preview tab loaded fine after one retry. Don't preemptively avoid local dev
     because of that alone; retry once or twice before concluding it's broken.
  3. **The real, structural blocker: local dev pointed at the prod gateway can never complete an
     authenticated call.** `bt-gateway/nginx.conf.template`'s CORS map
     (`map $http_origin $cors_origin`) hardcodes
     `~^https://bt-(shipper|driver|ops-web)-[^/]+\.run\.app$` as the *only* allowed origin
     pattern — `http://localhost:<any port>` never matches, so the gateway sends no
     `Access-Control-Allow-Origin` header and the browser blocks the response. Login (and every
     other gateway call) fails with a generic "Login failed"/network-error toast and **no
     visible network-log entry for the blocked request** — that absence is itself the tell,
     don't mistake it for "the request was never sent." (Aside: the Dockerfile sets
     `CORS_ALLOWED_ORIGINS=*` and `docker-entrypoint.sh` envsubst's it into the template, but the
     var is never actually referenced in the template's CORS logic — it's dead/vestigial, so
     don't bother trying to override it.) **Consequence: local dev against the live gateway is
     only useful for checking that a page/component renders and compiles — not for exercising any
     real login/data flow.** To actually exercise a flow locally you'd need the whole backend
     running locally too (out of scope per §2's guidance) or a founder-approved temporary CORS
     change (don't make that call yourself). For verifying a small code fix, default to: clean
     `tsc --noEmit`/`build`/`lint` + careful code review, or wait for the next live deploy.
- **Geolocation can't be exercised through these tools.** The driver app's GPS push
  (`ActiveTripSection` in `driver/src/app/(app)/bookings/[id]/page.tsx`) calls
  `navigator.geolocation.watchPosition`; there is no way to grant/mock browser geolocation
  permission via Claude Browser. Treat this as a hard coverage limitation, not a bug, when you
  can't verify a GPS feature end-to-end — say so explicitly rather than guessing at behavior.
- **Demo data is asymmetric — verify before assuming a shipper-side booking has a matching driver-side view.** The seeded "in transit" demo booking is visible and clickable from the
  `demo-shipper` account, but `demo-driver` has **no quotes/assigned trips at all** (empty "My
  Quotes", no truck registered on the profile). Don't assume logging into the driver app with the
  documented demo creds will land you on an active-trip/GPS screen — as of 2026-07-18 it won't.
  See §6.

---

## 4. Per-app test checklist (core features, booking flow excluded)

### Shipper (`bt-shipper`)
- [ ] Login (Email tab) with demo-shipper creds
- [ ] Dashboard / "My Bookings" list loads and shows existing bookings
- [ ] Open an existing booking's detail page — route/load/price details render
- [ ] Trip Status stepper reflects the booking's real status
- [ ] Live tracking map (`LiveTrackMap`) — renders pins + route, or degrades to the
      "map unavailable" placeholder without crashing the page
- [ ] Quotes panel — only relevant/visible copy for the booking's actual type/status
- [ ] Payment/POD section appears once status is `completed`/`paid`
- [ ] Mobile viewport layout
- Out of scope by default: "New Booking" creation flow

### Driver (`bt-driver`)
- [ ] Login (Email tab) with demo-driver creds
- [ ] "Available Bookings" (Browse) list loads
- [ ] "My Quotes" tab
- [ ] Profile tab — truck type / vehicle reg / license fields
- [ ] PWA basics: manifest (`/manifest.webmanifest`), service worker registered
- [ ] Screen Wake Lock activates during an active trip (code-level: `useScreenWakeLock`,
      D-008 — can't be visually confirmed without an active trip, see §6)
- [ ] Active-trip GPS section (`ActiveTripSection`) — GPS status indicator, "Mark as
      Delivered" → POD-OTP send, deep-link "Navigate" button — **requires a booking this
      account is actually assigned to and `in_transit`**; not reachable with documented demo
      creds as of 2026-07-18, see §6
- [ ] Mobile viewport layout (primary — this app is used on phones in a truck cab)
- [ ] Onboarding wizard (`/onboarding/personal`, `/vehicle`, `/license`, `/insurance`,
      `/bank-account`, `/review`) — reachable only by direct URL as of 2026-07-18, see §6 item 8;
      re-check whether it's been wired into the nav yet before re-reporting this
- Out of scope by default: submitting a quote / the auction bidding flow

### Backend dependency map (read before blaming the frontend)
A blank panel or failed action may be an **infra** problem, not a UI bug. Check `/health` first:

| Symptom in the UI | Likely backend dependency |
|---|---|
| Price/quote figures missing or erroring | `bt-pricing-service` |
| Payment status / payout not showing | `bt-payment-service` |
| POD / "Mark as Delivered" failing | `bt-cargo-ledger` |
| Live map / ETA / pumps / fuel / alerts failing | `bt-tracking-service` |
| Anything failing app-wide | `bt-gateway`, or the specific service it proxies to |

---

## 5. Booking-flow scope note

Per standing instruction, the booking creation/auction/negotiation flow is treated as already
verified and is skipped by default (§1). This harness still documents its routes/behavior when a
session happens to observe them in passing (e.g. landing on a quote-submission screen because a
demo account isn't assigned elsewhere) — that's fine to note, just don't go out of your way to
exercise it.

---

## 6. Known issues (as of last verification below — RE-VERIFY, don't trust blindly)

*Last verified: 2026-07-18, against the live Cloud Run deployment (see creds doc for exact
revision/URLs). If you're reading this more than a couple weeks later, or after a redeploy,
re-check before relying on any of these.*

1. **Shipper live-tracking map is broken in prod.** Console shows Google's own
   `InvalidKeyMapError`-class failure ("This page can't load Google Maps correctly") plus "The map
   is initialised without a valid Map ID." Confirmed root cause: the deployed bundle has the
   **leaked SERVER key** baked in as the browser key (same value `FOUNDER_ACTIONS.md`'s security
   section already flags for rotation), which isn't authorized for the Maps JavaScript API, and
   `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` is empty. This is an infra/deploy issue (stale build), not a
   code bug — the current `shipper/Dockerfile` on this branch correctly has no hardcoded default;
   the *live* revision predates that fix. Fix = redeploy shipper (and driver, same Dockerfile
   pattern) with the correct `--build-arg NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` /
   `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`. **Founder action, not agent-executable** (prod deploy).
   **UPDATE 2026-07-18:** the founder supplied both correct values (now in
   `docs/CLAUDE_BROWSER_CREDS.md` §5 — browser key `bt-browser-maps-js`, Map ID corrected to
   `…174c310f`) and was handed the exact `docker build --build-arg … + gcloud run deploy --image`
   command for shipper+driver. **Awaiting the founder's redeploy** — until then the live map stays
   broken. Next session: once redeployed, verify the live map renders pins + route + moving-truck
   marker on the real `bt-shipper-*.run.app` URL (the ONLY place the referrer-restricted key can be
   validated — it will `gm_authFailure` from localhost/file:// by design).
2. **`LiveTrackMap.tsx` only degrades gracefully when the key is *missing*, not when it's
   *invalid*.** (`shipper/src/components/maps/LiveTrackMap.tsx:58-60`) checks
   `if (!GOOGLE_MAPS_BROWSER_KEY)` and shows a clean "map unavailable" placeholder — good. But a
   present-but-rejected key (issue #1's exact case) isn't caught, so Google's raw, user-hostile
   error modal renders instead of the app's own placeholder. Small resilience gap, worth a
   follow-up (e.g. listen for `gm_authFailure`).
3. ~~Shipper's booking detail page renders the "Quotes" panel unconditionally~~ **FIXED
   2026-07-18** — `shipper/src/app/bookings/[id]/page.tsx` now gates the whole panel on
   `booking.booking_type === 'auction'`, so `direct` bookings no longer show "Waiting for drivers
   to respond..." Verified via a clean `tsc --noEmit`; NOT verified visually in-browser — local dev
   got the login page rendering fine, but couldn't get far enough to log in and reach the booking
   detail page at all, because the prod gateway's CORS policy hard-blocks localhost (see §3's
   local-dev gotcha, part 3). A future session should confirm on next deploy that a `direct`
   booking's page no longer renders the panel at all, and that `auction` bookings are unaffected.
4. **`demo-driver@bharattruck.dev` has no seeded active trip.** "My Quotes" is empty and the
   profile has no truck registered. The shipper-visible in-transit demo booking
   (`55555555-5555-5555-5555-555555555555`) is not owned by this account — visiting it as
   demo-driver renders the pre-award "Submit Your Quote" screen instead of the active-trip/GPS
   view. **This means the driver-side GPS/active-trip screen has not been visually verified live**
   — only confirmed by reading `ActiveTripSection` in
   `driver/src/app/(app)/bookings/[id]/page.tsx`, which does look functionally complete
   (geolocation watch + push, GPS status indicator, deep-link nav button, POD-OTP send). To truly
   verify it, either seed a trip demo-driver is assigned to and `in_transit`, or get a
   founder-provided account/booking pair that already has one.
5. **Driver app has no Maps/GPS *rendering* UI at all (by design, not a bug)** — no
   `@vis.gl/react-google-maps` dependency, no map component. Navigation is purely the D-004
   deep-link handoff (`driver/src/lib/nav.ts` → opens the phone's Google Maps app), which needs no
   API key. The **insights panel** CLAUDE.md describes ("navigation view + insights: pumps / fuel
   / alerts") is **not built yet** in the driver app — matches `bt-tracking-service`'s own status
   (`/pumps`, `/fuel`, `/alerts`, `/history` are Phase 3+, not built; only `/route /eta /track
   /health` exist). Don't report this as a regression if you see it again — it's a known gap, not
   new breakage. Cross-check against `docs/PROJECT_STATE.html`, which currently overstates this
   ("Both PWAs... live tracking") — that claim is accurate for shipper only.
6. **Shipper has no PWA manifest/service worker.** `driver/src/app/manifest.ts` +
   `driver/src/components/register-sw.tsx` exist; shipper has neither (`/manifest.webmanifest` and
   `/sw.js` both 404 on the live shipper URL). D-008 nominally called for both apps to get one;
   low priority since shipper doesn't need Wake Lock (that's driver's rationale), but the
   installable-PWA part is still a gap.
7. **Three backend services are 503 on the live deployment**: `bt-pricing-service`,
   `bt-payment-service`, `bt-cargo-ledger`. Root cause and exact fix commands are already written
   up in `docs/runbooks/W1-8-503-env-fix-and-migrations.md` — needs a human with `gcloud` access to
   run it (a prod Cloud Run env mutation). Until that lands, expect price figures, payment status,
   and POD/"Mark as Delivered" to fail in the UI — that's this, not a new frontend bug. Re-check
   `/health` on these three before assuming a related UI failure is novel.
8. **The driver app's full onboarding wizard is orphaned — built, working, but unreachable from
   any in-app link or redirect.** `driver/src/app/onboarding/{personal,vehicle,license,insurance,
   bank-account,review}` is a real, richer multi-step flow (RC number, body type, axle config,
   insurance, **bank account for payouts**) hitting `bt-auth-service`'s `/onboarding/*` endpoints.
   Visited directly by URL it renders cleanly with no console errors (spot-checked `/personal` and
   `/vehicle` 2026-07-18) — so it isn't broken code, just disconnected. But: post-login always
   goes to `/available` (`driver/src/app/login/page.tsx:25`), the bottom nav is only
   Browse/My Quotes/Profile (`driver/src/components/app-shell.tsx`), and the reachable "Profile"
   tab (`driver/src/app/(app)/profile/page.tsx`) is a **different, shallower** form that calls
   `registerProfile()` → `/auth/register` (not `/onboarding/*` at all) — it only collects
   truck_type/truck_number/license_number. **Net effect: there is currently no way for a real
   driver to enter insurance or bank-account info through the live app**, which matters because
   driver payouts (T-BE-4) need a bank account and CLAUDE.md calls the KYC gate a "never cut" item.
   This is a product/wiring gap, not a rendering bug — needs a founder/PM call on whether to wire
   the full wizard in (redirect-when-incomplete + nav entry) or intentionally keep the lightweight
   version for MVP and drop the unreachable wizard code.
9. **The tracking data pipeline itself works — the Maps problem (item 1) is isolated to frontend
   rendering, not the backend.** Verified by curling `/api/tracking/*` directly against the live
   gateway with a real JWT: `route` returns a real computed polyline + `distance_m` (772,780 m,
   consistent with the Mumbai→Nagpur demo route) with `cached:true`; `track` (the locked #8
   aggregate) returns a well-formed response that degrades gracefully to `location:null`/`eta:null`
   when there's no live driver position, rather than erroring; `eta` correctly 404s with a typed
   `NO_LOCATION` error in the same no-live-position case. `history`/`pumps`/`fuel`/`alerts` all
   404 with Fastify's generic "Route not found" — confirms they're genuinely unbuilt (Phase 3+),
   not broken. So `GOOGLE_MAPS_SERVER_KEY` on `bt-tracking-service` is valid and working — the bug
   is specifically that the *wrong* key (the server one) got baked into the *browser* bundle.

---

## 7. The self-iteration rule, in detail

This section exists because a harness that goes stale is worse than no harness — it actively
wastes the next session's tokens on wrong assumptions. Concretely, before you end a session that
touched Claude Browser testing for this project:

1. Did you find a new gotcha with the Claude Browser tools themselves (not the app)? → add it to
   §3.
2. Did you find a bug, or confirm/refute one already in §6? → update §6 (add with today's date, or
   correct/remove a stale entry with a note in §8).
3. Did a URL, port, credential, or key change? → update `CLAUDE_BROWSER_CREDS.md`, not this file.
4. Did the *scope* of what "core features" means change (e.g. the founder says the booking flow is
   now in scope too)? → update §1 and §4.
5. Add one line to §8 (Changelog) summarizing what you touched and why, even if the answer is "ran
   a full pass, nothing changed."

If you're a session with no time/budget to do a full pass, it's still worth 30 seconds to skim §6
and confirm nothing you personally observed contradicts it.

---

## 8. Changelog

- **2026-07-18** — Initial version. Full pass against the live Cloud Run deployment (shipper +
  driver, demo creds, desktop + mobile viewport). Found: shipper Maps key broken in prod (leaked
  server key baked in, no Map ID), `LiveTrackMap` degrades only on missing-not-invalid key,
  shipper Quotes panel renders unconditionally, demo-driver has no seeded active trip (driver GPS
  screen unverified live), driver has no Maps/insights UI yet (by design/roadmap, not a bug),
  shipper missing PWA manifest/SW, pricing/payment/cargo-ledger are 503 (tracked separately in the
  W1-8 runbook). Created this harness + `CLAUDE_BROWSER_CREDS.md` + a pointer in `CLAUDE.md`.
- **2026-07-18 (same session, follow-up)** — Fixed the Quotes-panel bug (item 3 in §6) at the
  user's request. Attempted to verify the fix live via a local `next dev` server through
  `preview_start`/`.claude/launch.json`; hit a sandbox limitation (localhost navigation denied
  after the server started) — documented as a new gotcha in §3 rather than silently giving up.
  Fix is type-check-clean but not yet visually re-verified; flagged above for the next session
  that has a working path to check it (next live deploy, or local dev outside this tool).
- **2026-07-18 (same session, second follow-up)** — Went deeper on the two things a Maps-key
  handoff didn't block: (a) curled `/api/tracking/*` directly with a real JWT to isolate whether
  the Maps bug was frontend-only or a backend problem too — confirmed backend/data pipeline is
  fully healthy (item 9); (b) found the driver onboarding wizard is built and functional but has
  no reachable path from the live app (item 8) — a real product gap around KYC/payout info, not
  a rendering bug. Both added to §6.
- **2026-07-18 (same session, fourth follow-up)** — Founder provided the correct Maps values.
  Confirmed the browser key matches 3 prior docs; found the Map ID had drifted (`…607b2ec5` →
  founder's fresh `…174c310f`) and corrected it in `FOUNDER_ACTIONS.md` + `CLAUDE_BROWSER_CREDS.md`
  §5 (old kept as documented fallback). Confirmed via the deployed `deploy.yml` that the referrer
  allowlist (`*.run.app/*`) already covers the app domains, so no referrer change needed. Handed the
  founder the exact `docker build --build-arg` + `gcloud run deploy --image` command for
  shipper+driver. Updated §6 item 1 with the resolution + the post-deploy verification the next
  session should run. Also learned (and can't locally test): the browser key is referrer-locked to
  `*.run.app`, so a Maps key can ONLY be validated on the live deployed URL — `file://`/localhost
  always `gm_authFailure`. Added `demo-ops` creds to CREDS §2.
- **2026-07-18 (same session, third follow-up)** — User hit the local-dev Node version error
  directly (`preview_start` failed: node 16.20.2 < required 20.9.0). Fixed via `.claude/launch.json`
  (absolute v20.20.0 npm binary + literal full `PATH`) and confirmed clean via `preview_logs`. Tried
  again to visually verify the Quotes-panel fix — got further this time (login *page* rendered,
  and the earlier "policy check"/navigation-denied error did NOT recur) but hit a new, harder wall:
  actually logging in failed against the prod gateway from `localhost`, root-caused to the
  gateway's hardcoded CORS origin allowlist (§3 part 3). **Corrected §3's local-dev gotcha** — the
  first write-up wrongly attributed the failure to a Claude Browser sandbox restriction; the real
  mechanism is CORS, and it's structural (no env var fixes it), not a retry-and-it-works flake like
  the navigation error actually was.
