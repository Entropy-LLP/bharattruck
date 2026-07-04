# Driver/Fleet App (bt-driver-app) — Development Roadmap

> **Part of [BharatTruck](https://github.com/CodeMongerrr/LogisticOS-pathway).** The **Driver + Fleet Owner** PWA (PRD §6.2). Master PRD: `LogisticOS-pathway/docs/BHARATTRUCK_MVP_PRD.md`.
> **MVP deadline:** 31 Aug 2026 · **North Star:** Completed Paid Trips · _Living doc — update checkboxes as work lands._

**Role:** The **primary audience's** app (optimize for near-zero friction; users may be non-literate → icon-led, vernacular-ready). Combined Driver + Fleet Owner persona — role is truck-derived. Web/PWA now → **Capacitor Android** for native background GPS before the real pilot.

**Status legend:** ✅ done · 🟡 partial · ⬜ to do · ⛔ broken · `(Wx-y)`/`(D-z)` tags = Entropy PMO work-item refs (auto-synced to the tracker — keep them on the line when you flip a checkbox)

---

## ✅ What's done
- ✅ Login (custom JWT access+refresh, single-flight refresh mutex, 401 retry), auth/callback (magic link).
- ✅ Available loads, my-quotes, booking detail (auction countdown + negotiation history), profile.
- ✅ Direct vs Auction handling; quote/booking states polled (10s detail, 30s countdowns).
- ✅ `{success, data, code, message}` envelope via one gateway base (`NEXT_PUBLIC_API_URL`).

## ⛔ Broken / in-progress
- ⛔ **`next build` fails** — the onboarding wizard (`src/app/onboarding/*`) imports ~11 undefined API fns + ~6 types not exported in `src/lib`.
- ⛔ Onboarding is **unreachable** — nothing routes to `/onboarding`; new drivers only capture a name → land on `/available`.
- 🟡 Two parallel profile systems: working `/profile` (POST /auth/register) vs broken `/onboarding` wizard — not reconciled.
- ⛔ GPS not field-ready: no wake-lock, no background/store-forward; single in-component watch dies on background/lock; push failures swallowed.

## ⬜ To do (MVP / P0)
- ⬜ **Fix the build:** define/export the missing onboarding api fns + types (or rewire onboarding to the working data path). (W1-2)
- ⬜ **One coherent driver-KYC path** — connect onboarding (personal/vehicle/license/insurance/bank/review) into the live journey (`is_new_user` routing) against bt-auth-service. (W2-12)
- ⬜ **Truck & fleet management:** add truck (RC→Vahan), see role flip to Fleet Owner on 2nd truck, affiliate drivers, see assigned fleet trucks. (W2-13)
- ⬜ **Field-ready GPS:** wake-lock + IndexedDB store-and-forward queue + reconnect (web PWA). (W5-5)
- ⬜ **Trip execution:** pickup confirm, checkpoint photo capture (EXIF GPS) → bt-cargo-ledger, deep-link nav to Google Maps, delivery via receiver OTP. (W6-15)
- ⬜ **Payout/bank** link in a working path (currently only in the broken wizard) + earnings view (advance + balance). (W6-16)
- ⬜ Remove dev seams from production login ("Dev: paste JWT", "check server console for OTP"). (W8-3)
- ⬜ Fix `my-quotes` N+1 fan-out (shows only first quote per booking). (W3-12)
- ⬜ Assisted-KYC field-agent onboarding (agent capture + regional-language audio/video + dummy-order activation). (W2-15)
- ⬜ Background-geolocation plugin (Transistorsoft) + OEM autostart/battery-whitelist onboarding for Xiaomi/Vivo/Oppo/Realme. (W5-8)
- ⬜ Vernacular pass: Hindi-first UI + regional languages + voice prompts for key confirmations. (W8-7)
- ⬜ Document wallet: surface DL/RC/PUC/insurance/permit from KYC data with expiry alerts. (W8-8)

## ⬜ To do (P0* for real pilot)
- ⬜ **Capacitor Android wrap** for native background GPS (use a battle-tested geolocation plugin; handle OEM battery-killers). _Web screen-on is acceptable for the very first feasibility trip._ (W8-1)

## 🔮 Deferred / out of MVP
- Supabase Auth migration (keep custom JWT); driver insights (petrol pumps/fuel); ratings (fleet reviews only).

## 🎯 Definition of done (this app)
A fleet owner/driver signs up → adds a Vahan-verified truck → completes KYC → (once ops-approved) browses loads → bids/accepts → runs the trip with live GPS + checkpoint photos + deep-link nav → closes via receiver OTP → sees payout. Runs as a Capacitor Android app with native GPS.

_Last updated: 2026-07-01_
