# FOUNDER ACTION ITEMS — BharatTruck

> Things only **you** can do (the harness blocks agents from prod Cloud Run mutations, prod IAM, git
> push to `main`, and writing API-key values to files). Ordered by priority. The CTO agent does
> everything else. Updated 2026-07-15.

---

## 🔴 NOW — get a testable app live (base-first, ~15 min)

`main` (`a24401f`) is verified and ready. Two steps:

**1. Bake the correct Maps values into the app builds** (agents are guard-blocked from writing the key):
```bash
cd /Users/adityaroshanjoshi/Desktop/VS_Code/StartUps/WIP
git checkout main && git pull origin main
for f in shipper/Dockerfile driver/Dockerfile; do
  perl -0pi -e 's/NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY=\S+/NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY=AIzaSyA-rqgoNd0bmfouXworTp4EuMspH4bNxuY/' "$f"
  grep -q NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID "$f" || perl -0pi -e 's/(NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY=\S+\n)/${1}ENV NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=f2e0c2b5b35f303a607b2ec5\n/' "$f"
done
grep -n GOOGLE_MAPS shipper/Dockerfile driver/Dockerfile   # verify BOTH show the new key + Map ID
```
> The Map ID is **essential** — without it the live map shows the route but no pins / no moving truck.

**2. Deploy the whole stack** (~10–15 min; idempotent; folds in the 503 fix):
```bash
./scripts/deploy/deploy-all.sh
```
Expect `/health` = **200** for the 6 services + gateway, and `/` = 200 for the 3 apps; it prints each
app URL. Then open the shipper + driver URLs and test with `demo-shipper@bharattruck.dev` /
`demo-driver@bharattruck.dev` (pw `demo-<role>-2026`). **Paste me the health table.**

> Known latent bug (safe for this redeploy — tracking already has its key + `--source` preserves env):
> `bt-tracking-service` crash-loops if `GOOGLE_MAPS_SERVER_KEY` is ever missing. Fix is on
> `feat/wiring-fixes` (make the key lazy); land it before any *fresh* tracking deploy.

---

## 🟠 Phase A — CI/CD IAM (so GitHub Actions can deploy; ~30 min)

Grant the CI/CD service account the missing roles + the Workload-Identity binding:
```bash
PROJECT=project-aa0faf06-c115-438a-a36
PROJECT_NUM=752385541585
SA=bt-cicd-deployer@$PROJECT.iam.gserviceaccount.com

# missing roles (Cloud Run deploy needs actAs on the runtime SA; --source needs Cloud Build)
gcloud projects add-iam-policy-binding $PROJECT --member="serviceAccount:$SA" --role="roles/iam.serviceAccountUser"
gcloud projects add-iam-policy-binding $PROJECT --member="serviceAccount:$SA" --role="roles/cloudbuild.builds.editor"

# WIF: let GitHub Actions for Entropy-LLP/bharattruck impersonate the SA.
# First find your pool/provider:
gcloud iam workload-identity-pools list --location=global --project=$PROJECT
gcloud iam workload-identity-pools providers list --location=global --workload-identity-pool=<POOL> --project=$PROJECT
# then bind the repo (replace <POOL>):
gcloud iam service-accounts add-iam-policy-binding $SA --project=$PROJECT \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUM/locations/global/workloadIdentityPools/<POOL>/attribute.repository/Entropy-LLP/bharattruck"
```

**GitHub repo variables/secrets for the new CD workflow** (`feat/cicd-deploy`, being authored — exact
list will be in that branch's report; set them under repo Settings → Secrets and variables → Actions):
- Variable `NEXT_PUBLIC_API_URL` = `https://bt-gateway-itcdoenefa-el.a.run.app`
- Variable `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` = `f2e0c2b5b35f303a607b2ec5`
- Secret `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` = `AIzaSyA-rqgoNd0bmfouXworTp4EuMspH4bNxuY`
- (WIF) Variable `GCP_WORKLOAD_IDENTITY_PROVIDER` = the full provider resource name + `GCP_SERVICE_ACCOUNT` = the SA email.

---

## 🟡 Phase C — one-time catch-up (~1 hr, after Phase A + the CD workflow merges)

Deploy all 11 from current `main` so **live == main** and the 4 orphaned pre-monorepo images are
cleared. `./scripts/deploy/deploy-all.sh` already does this; or, once `deploy.yml` is merged, a push to
`main` triggers it. Then verify `/health` + walk the e2e loop on the deployed stack.

---

## 🟢 Creds still needed (when you have them)

- **Surepass** account + API key — to replace the KYC *stub* with real verification (post-pilot).
- **Razorpay** merchant + RazorpayX + Smart Collect — to add real escrow/payout (post-pilot; PRD v3.1).
- Confirm the **PMO netlify password** only if you want the CTO verifying the rendered UI (it edits the
  underlying Supabase `pmo_items` directly regardless).

---

## ⚪ Phase D — hardening (later)

Make lint a hard CI gate · keep DB migrations **manual** (not in CD — prod-mutation guard) · write a
rollback runbook · move secrets → Secret Manager (off inline env).

---

## The "other coder" (pricing/payments)

He owned pricing + payments (we reconfirmed/rebuilt them in TS). Per your instruction he must stay
informed — I'll keep `docs/PRICING_PAYMENTS_STATUS.md` current and flag any change to those services so
he's never surprised. His Python engines stay quarantined on `feat/python-engines` (they'd break the
Node deploy).
