# Claude Browser Testing — Links & Credentials

> Companion to `docs/CLAUDE_BROWSER_HARNESS.md` (read that one first — this file is just the
> reference data it points to). Kept **separate on purpose**: links/creds churn independently of
> testing methodology, and separating them means a session that only needs a URL doesn't have to
> read the whole harness, and a session updating a URL doesn't risk clobbering the harness prose.

**Rule for this file — read before adding anything:** demo/test account creds and *public,
referrer-restricted* keys are fine to keep here in plain text (this project already commits
equivalents in `FOUNDER_ACTIONS.md`). **Never write a true secret's VALUE here** — server-only API
keys, `JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `INTERNAL_SERVICE_SECRET`, etc. Reference the env
var *name* and where to read it from (§4) instead. This project's harness explicitly blocks agents
from writing API-key values to files for a reason — don't route around that by stashing them here.

---

## 1. Deployed apps & services (live, Cloud Run, `asia-south1`, project `project-aa0faf06-c115-438a-a36`)

Two equivalent hostnames exist per service (Cloud Run gives every service both a legacy hash-style
URL and a project-number-style URL) — either works, both confirmed live 2026-07-18. The
project-number style is used below since it's what `gcloud run services list` returns directly.

| Service | URL | Purpose |
|---|---|---|
| `bt-shipper` | https://bt-shipper-752385541585.asia-south1.run.app | Shipper PWA |
| `bt-driver` | https://bt-driver-752385541585.asia-south1.run.app | Driver/Fleet-Owner PWA |
| `bt-ops-web` | https://bt-ops-web-752385541585.asia-south1.run.app | Internal ops console (redirects to `/login`) |
| `bt-gateway` | https://bt-gateway-752385541585.asia-south1.run.app (also `bt-gateway-itcdoenefa-el.a.run.app`) | Edge — apps' `NEXT_PUBLIC_API_URL` points here |
| `bt-auth-service` | https://bt-auth-service-752385541585.asia-south1.run.app | Auth/identity |
| `bt-booking-service` | https://bt-booking-service-752385541585.asia-south1.run.app | Bookings, auction, lifecycle, GPS ingest |
| `bt-pricing-service` | https://bt-pricing-service-752385541585.asia-south1.run.app | Quotes/pricing — **503 as of 2026-07-18**, see harness §6 |
| `bt-payment-service` | https://bt-payment-service-752385541585.asia-south1.run.app | Payments — **503 as of 2026-07-18** |
| `bt-cargo-ledger` | https://bt-cargo-ledger-752385541585.asia-south1.run.app | POD/ledger — **503 as of 2026-07-18** |
| `bt-tracking-service` | https://bt-tracking-service-752385541585.asia-south1.run.app | Maps/tracking proxy — healthy |

Quick health sweep:
```bash
for s in bt-auth-service bt-booking-service bt-pricing-service bt-payment-service \
         bt-cargo-ledger bt-tracking-service bt-gateway; do
  u="https://${s}-752385541585.asia-south1.run.app"
  printf '%-22s %s\n' "$s" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$u/health")"
done
for s in bt-shipper bt-driver bt-ops-web; do
  u="https://${s}-752385541585.asia-south1.run.app"
  printf '%-22s %s\n' "$s" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$u/")"
done
```
To refresh this table (services get added/removed): `gcloud run services list --region=asia-south1 --project=project-aa0faf06-c115-438a-a36` (read-only, safe for any session with `gcloud` auth).

---

## 2. Demo credentials

Login screens default to the **Phone** tab — switch to **Email** (phone OTP has no SMS provider
wired, it's a dead end). Password pattern is `demo-<role>-2026`.

| App | Email | Password | Notes |
|---|---|---|---|
| Shipper | `demo-shipper@bharattruck.dev` | `demo-shipper-2026` | Has one seeded booking, `55555555-5555-5555-5555-555555555555`, status `in_transit` |
| Driver | `demo-driver@bharattruck.dev` | `demo-driver-2026` | **No assigned trips, no truck on profile** as of 2026-07-18 — see harness §6 item 4 before assuming you can reach an active-trip screen |

Both login pages also have a "Dev: Paste JWT directly" collapsible for reusing a raw JWT instead
of re-running the form (useful across repeated checks in one session).

Ops console (`bt-ops-web`): `demo-ops@bharattruck.dev` / `demo-ops-2026` (same `demo-<role>-2026`
pattern; sourced from `CTO_HANDOFF_LIVE.md`, **not yet exercised in-browser** — confirm on first
ops-console test).

---

## 3. Local dev reference

Neither `shipper/` nor `driver/` has an `.env.local` checked in (gitignored; none present on disk
as of 2026-07-18). The Dockerfiles' `NEXT_PUBLIC_API_URL` build-arg defaults to the live prod
gateway, so local dev needs **no local backend** just to render the page shell:

```bash
cd shipper   # or driver
NEXT_PUBLIC_API_URL=https://bt-gateway-itcdoenefa-el.a.run.app npm run dev   # → localhost:3000
```

**Two gotchas, both covered in detail in `docs/CLAUDE_BROWSER_HARNESS.md` §3:**
- This machine's default `node` is v16 (nvm), but Next 16 needs `>=20.9.0` — point
  `runtimeExecutable`/`PATH` at an installed v20+ version (v20.20.0 confirmed working) if using
  `.claude/launch.json`, or `nvm use 20` first if running `npm run dev` by hand.
- **Login and every other gateway call will fail from `localhost`.** The prod gateway's CORS
  policy (`bt-gateway/nginx.conf.template`) only allows the three `bt-*.run.app` origins by a
  hardcoded regex — there's no env var that opens it up for local dev. Local dev against the live
  gateway is good for "does this render/compile," not for exercising a real login/data flow.

Add the Maps vars only if testing map rendering locally (see §5 for the candidate values and the
caveat on them). Local port map (from `docs/AGENT_HANDOFF.md`): gateway `8080`, auth `3001`,
booking `3002`, pricing `3003`, payment `3004`, cargo-ledger `3005`, tracking `3006`, any single
Next app's dev server `3000`.

---

## 4. Where the real secrets live (not here)

| Var | Lives in | How to read it (read-only) |
|---|---|---|
| `GOOGLE_MAPS_SERVER_KEY` | `bt-tracking-service` Cloud Run env | `gcloud run services describe bt-tracking-service --region=asia-south1 --project=project-aa0faf06-c115-438a-a36 --format=json` |
| `JWT_SECRET`, `INTERNAL_SERVICE_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`, `SUPABASE_URL` | `bt-booking-service` Cloud Run env (source of truth — copied from here to other services on deploy) | same `describe` pattern against `bt-booking-service` |

These are prod secrets. Reading them (describe) is fine for diagnosis; **writing/rotating them is
a founder action**, not something to do from a session. See `FOUNDER_ACTIONS.md` and
`docs/runbooks/W1-8-503-env-fix-and-migrations.md` for the exact commands already drafted for the
founder to run.

---

## 5. Public Maps config (browser-safe, referrer-restricted — NOT the secret above)

The **live shipper/driver deployment currently has the wrong value baked in** (the leaked server
key, mistakenly used as the browser key — see harness §6 item 1; rotation is flagged in
`FOUNDER_ACTIONS.md`). **Founder-confirmed correct values (2026-07-18, pulled fresh from the GCP
console):**

- `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY=AIzaSyA-rqgoNd0bmfouXworTp4EuMspH4bNxuY`
  — the console key named **`bt-browser-maps-js`** (restrictions: HTTP referrers + Maps
  JavaScript API only). Do **not** use `bt-tracking-server` (2 APIs) or `Maps Platform API Key`
  (33 APIs, unrestricted).
- `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=f2e0c2b5b35f303a174c310f`
  — **corrected 2026-07-18.** Earlier docs (this file's prior version, `FOUNDER_ACTIONS.md`,
  `CTO_HANDOFF_LIVE.md`) recorded `f2e0c2b5b35f303a607b2ec5`; the founder's fresh console pull gave
  `…174c310f`, so that's now the primary. `…607b2ec5` is the **fallback** — if a deploy renders the
  base map but no markers (console: "initialised without a valid Map ID"), the Map ID is wrong;
  swap to the fallback and rebuild. The Map ID is not a secret and is self-verifying at deploy.

Referrer allowlist on the browser key is `https://*.run.app/*` (per `CTO_HANDOFF_LIVE.md`), which
covers both Cloud Run hostname styles for the apps — so no referrer change is needed on redeploy.

---

## Changelog

- **2026-07-18** — Initial version, built alongside `docs/CLAUDE_BROWSER_HARNESS.md` from a live
  pass against the deployed stack.
- **2026-07-18 (follow-up)** — Expanded §3 with the two local-dev gotchas actually hit this
  session: the Node version mismatch (fixable) and the gateway CORS allowlist (structural, not
  fixable from a session — see harness §3 for the full diagnosis).
- **2026-07-18 (Maps keys resolved)** — Founder supplied the correct Maps values from the console.
  §5 rewritten: browser key = `bt-browser-maps-js`; **Map ID corrected `…607b2ec5` → `…174c310f`**
  (fresh pull superseded 3 docs' stale value; old kept as fallback). Added the `demo-ops` account to
  §2. Redeploy command handed to founder; live-map verification pending their deploy.
