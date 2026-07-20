# DEPLOY — stub pilot (all services + apps from main)

> Owner: infra. One-shot deploy runbook to stand up the full stack on Cloud Run from `main`
> (stub-pilot: cash-recorded payments, KYC manual, Maps live). Uses `gcloud run deploy --source`
> so each build uses the service's own Dockerfile. **No secret/key values appear in this doc** —
> env values copy from the already-healthy `bt-booking-service` (see the W1-8 runbook) or are the
> Phase-0 restricted keys held by the founder.

## 0. Preconditions

```bash
export PROJECT=project-aa0faf06-c115-438a-a36
export REGION=asia-south1
gcloud config set project "$PROJECT"
gcloud config set run/region "$REGION"
# APIs: run.googleapis.com, cloudbuild.googleapis.com, artifactregistry.googleapis.com enabled.
# Maps Phase-0 (CONTRACT §6.5): Maps JS + Routes + Places(New) enabled; 2 restricted keys created.
```

Deploy order follows the dependency chain: **backend services → gateway → apps**. Services carry a
circular URL dependency (booking needs pricing/payment/cargo URLs; those need booking's URL), so we
deploy all services first to mint their URLs, then set the cross-service env, then the edge + apps.

## 1. Backend services (6) — `gcloud run deploy --source`

Run each from its own directory. `--source .` builds via that dir's Dockerfile.

```bash
deploy_svc () {  # $1=service name  $2=source dir
  gcloud run deploy "$1" --source "$2" --region "$REGION" --project "$PROJECT" \
    --platform managed --allow-unauthenticated --port 8080
}
deploy_svc bt-auth-service     bt-auth-service
deploy_svc bt-booking-service  bt-booking-service
deploy_svc bt-pricing-service  bt-pricing-service
deploy_svc bt-payment-service  bt-payment-service
deploy_svc bt-cargo-ledger     bt-cargo-ledger
deploy_svc bt-tracking-service bt-tracking-service
```

### 1a. Service env (set AFTER first deploy mints the URLs)

Env **values** copy from the healthy `bt-booking-service` (see
`docs/runbooks/W1-8-503-env-fix-and-migrations.md` §2 for the copy-from-booking helper). Required env
by service (NAMES only — values are shared secrets already on booking, or Phase-0 keys):

| Service | Required env (beyond NODE_ENV/PORT) |
|---|---|
| bt-auth-service | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY` |
| bt-booking-service | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`, `JWT_SECRET`, `INTERNAL_SERVICE_SECRET`, `PRICING_SERVICE_URL`, `PAYMENT_SERVICE_URL`, `CARGO_LEDGER_URL` |
| bt-pricing-service | `JWT_SECRET` — **post-quote-lock-merge ALSO:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `INTERNAL_SERVICE_SECRET` (price_quotes persistence) |
| bt-payment-service | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `INTERNAL_SERVICE_SECRET`, `BOOKING_SERVICE_URL` |
| bt-cargo-ledger | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`, `INTERNAL_SERVICE_SECRET`, `BOOKING_SERVICE_URL`, `BLOCKCHAIN_ENABLED=false` (POD email — **required for POD to work**, same SMTP contract as bt-auth-service: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `EMAIL_DEV_MODE=false`; optional `POD_OTP_PEPPER`, `POD_EMAIL_FROM`, `RECEIVER_APP_BASE_URL`) |
| bt-tracking-service | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`, `JWT_SECRET`, `GOOGLE_MAPS_SERVER_KEY`, `BOOKING_SERVICE_URL`, `DIESEL_PRICE_INR=90` |

> Cross-service URLs: after the first deploy, read each with
> `gcloud run services describe <svc> --format='value(status.url)'` and set them via
> `gcloud run services update <svc> --update-env-vars "^@^KEY=URL@..."` (merge; see W1-8 §3).
> `GOOGLE_MAPS_SERVER_KEY` is the server-only Phase-0 key — set on `bt-tracking-service` ONLY, never
> in a browser/app bundle.

## 2. Gateway (edge)

```bash
gcloud run deploy bt-gateway --source bt-gateway --region "$REGION" --project "$PROJECT" \
  --platform managed --allow-unauthenticated --port 8080
```
The nginx upstreams must resolve to the deployed service URLs (see `bt-gateway/nginx.conf.template`);
confirm `/api/{auth,bookings,quotes,location,tracking,pricing,payments,cargo}` route to the right
service and `GET /health` is 200.

## 3. Apps (3) — deploy LAST (they bake the gateway URL + Maps keys at build)

The app Dockerfiles bake `NEXT_PUBLIC_*` at build time (public, inlined into client JS):
`NEXT_PUBLIC_API_URL` (gateway root), `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` (referrer-restricted
Phase-0 browser key), `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`.

> ⚠️ **BLOCKED PRECONDITION:** `driver/Dockerfile` and `shipper/Dockerfile` must first have the
> correct **browser** key + Map ID baked (they currently bake a wrong/placeholder key and lack the
> Map ID). That edit embeds the Maps key value, which is a founder-gated action — see the DEPLOY-PREP
> blocker. Apply that two-line-per-Dockerfile change (founder) BEFORE building the apps, else the map
> renders with the wrong key.

```bash
deploy_app () { # $1=service name  $2=source dir
  gcloud run deploy "$1" --source "$2" --region "$REGION" --project "$PROJECT" \
    --platform managed --allow-unauthenticated --port 8080
}
deploy_app bt-driver   driver
deploy_app bt-shipper  shipper
deploy_app bt-ops-web  bt-ops-web
```
`bt-ops-web` also needs its own server env (ops auth/data) — set per its README before traffic.

## 4. Verify (per phase)

```bash
for s in bt-auth-service bt-booking-service bt-pricing-service bt-payment-service \
         bt-cargo-ledger bt-tracking-service bt-gateway bt-driver bt-shipper bt-ops-web; do
  u=$(gcloud run services describe "$s" --region "$REGION" --project "$PROJECT" --format='value(status.url)')
  echo -n "$s -> "; curl -s -o /dev/null -w "%{http_code}\n" "$u/health" 2>/dev/null || echo "n/a"
done
```
Backend + gateway `/health` = 200. Apps: load the driver/shipper PWAs and confirm the map renders and
a `/api/tracking/track/:bookingId` call returns route+ETA. Smoke the slice end-to-end (use the T-115
GPS simulator, `scripts/gps-simulator/`, to move the truck without a real drive).
