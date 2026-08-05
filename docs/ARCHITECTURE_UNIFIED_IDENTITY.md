# Unified Identity & Emergent Personas — locked architecture

> **Status:** LOCKED 2026-08-03 by founder decision. Supersedes the one-role-per-account model.
> Changing anything here needs an explicit dated reversal note in this file, the way `BIBLE.md §2`
> handles scope reversals — do not silently overwrite.
>
> **Companion:** `docs/INDIA_FREIGHT_COMPLIANCE.md` — several decisions below exist because of a
> legal constraint documented there, and are cross-referenced.

---

## 1. The one idea

**A persona is not a flag on an account. It is a view over what you own and who you are connected to.**

```
what you OWN         (trucks)              → carrier capability
who you HOLD         (drivers / fleets)    → fleet capability
what you DO          (post a load)         → shipper capability
```

Nobody "becomes" a fleet owner. They buy a second truck, and the fleet surfaces become *relevant*.
Nothing is switched on; something became true. That is what makes the app feel like it is taking the
shape of the user's business rather than asking them to pick a costume.

### 1.1 The single rule that replaces three special cases

> **Commercial visibility follows ASSET OWNERSHIP, not affiliation.**
> Own a truck → you are a stakeholder in its economics → you see the money.
> Assetless driver → you are an employee → you do not.

This one rule resolves what used to be three separate behaviours:

| Case | Old behaviour | New behaviour |
|---|---|---|
| Solo driver | sees money | sees money (owns the truck) |
| Fleet driver, no assets | masked by `stripCommercialFields` | masked — unchanged |
| **Owner-driver affiliated to a fleet** | **masked (wrong)** | **sees money — they are a stakeholder** |

### 1.2 The second rule — affiliation ADDS work, it does not replace it

An affiliated driver who **owns a truck** keeps full marketplace access. Affiliation is an additional
source of work, not a substitute for self-selection.

An affiliated driver who owns **nothing** does not self-select work — their owner bids and assigns.

> This retires the `driver/src/lib/fleet-affiliation.tsx` "two products" split, which keyed the whole
> driver app off `is_fleet_affiliated`. That discriminator is now wrong.

---

## 2. Decisions locked

| # | Decision | Consequence |
|---|---|---|
| **D-1** | Account = **one human**. No organisations, no shared logins. | A distributor with dispatch clerks cannot delegate. Accepted for pilot; §7 leaves the seam. |
| **D-2** | Auth identifies the **user**, not a role. `users.role` demotes to `primary_persona`. | Every service that authorizes on `role` must move to capability checks. Back-compat kept — see §4.3. |
| **D-3** | Personas are **emergent**, computed from assets + relationships + actions. Never stored as an authorization flag. | No "add persona" settings screen. Emergence moments are the growth loop (§5.3). |
| **D-4** | **One KYC identity.** Documents are typed and shared across personas. | PAN/Aadhaar verify the person; GST the business; DL the driver; RC the truck. All hang off `users.id`. |
| **D-5** | **KYC does not gate use at MVP.** | Founder call — cannot onboard and test the full KYC surface before 31 Aug. Verification badges are informational. Revisit post-MVP. |
| **D-6** | Trucks are assets of a **person** (driver or fleet owner) and behave identically either way. | `vehicles` already supports both (`driver_id` / `fleet_owner_id`). Normalised in 0022. |
| **D-7** | **Revenue split** on the fleet↔driver relationship; the fleet owner sets it. | `fleet_drivers.revenue_share_pct`. Default 0 (salaried). |
| **D-8** | A driver may affiliate to **multiple fleets**. | Availability is owned by the **truck**, not the driver (§6.2). |
| **D-9** | Trip history is **jointly owned** and retained in full, for legal reasons. | Never delete on affiliation end. Read access survives `status='left'`. |
| **D-10** | **Same person on both sides → direct-attach**, bypassing the auction. | New lifecycle path. Still gets a real invoice with real freight (D-15). |
| **D-11** | Platform runs a pricing engine at auction start — **reference only for the shipper, never a compulsion.** | Also a legal protection: platform *setting* price is a GTA red line (`INDIA_FREIGHT_COMPLIANCE.md §1.3`). |
| **D-12** | Platform **moves money** via Razorpay Route when wired, using **stakeholder-owned** accounts. **No platform cut.** Falls back to record-only. | No credentials exist today → built inert (§8). Money never rests with the platform — that is what keeps the collection-agent framing. |
| **D-13** | **POD = OTP + photo evidence. The QR is scrapped.** | Founder call. §6.3. |
| **D-14** | **Phone OTP stubbed everywhere**, ready for DLT registration. | Every send site goes through one provider seam so DLT wiring is a config change. |
| **D-15** | Direct-attach bookings still produce an invoice; freight is real, **not zero**. | Internal cost accounting, external correctness. |
| **D-16** | **Multi-truck consignments supported** (SKD/CKD). | One invoice, per-truck delivery challan, original with the last truck. Breaks one-invoice-one-truck. |
| **D-17** | **In-platform e-way bill generation is OUT of MVP.** Record + upload an externally-generated one. | Removes the GSP + ISO 27001 critical path. The full API contract is documented for later. |
| **D-18** | Shippers **≥ ₹5 cr turnover**: invoices handled in-house. | Their e-way bills must go through the IRN path — deferred with D-17. |
| **D-19** | **Truck carries the schedule.** Accepting work locks the truck for the window. | Prevents double-booking across multiple fleets + self-selected loads. |
| **D-20** | Reputation is **per persona**, and deferred. | A bad shipper is not automatically a bad carrier. Keep it simple until there is data. |

---

## 3. What "one app" means

Founder: *"There is no destination in this application. A user logs into BharatTruck, that's all."*

### 3.1 What it is NOT

- ❌ A persona switcher / slider / dropdown
- ❌ Three apps behind one login with a router picking one
- ❌ A settings screen where you tick which personas you want

All three make the user do the platform's filing.

### 3.2 The shape

**One home surface that answers a single question: *what needs me right now?***

A unified action feed where **each item carries its own persona** and renders in its own idiom. The
user never selects a context — the *object* supplies it:

```
┌─────────────────────────────────────────────┐
│  Needs you                                  │
├─────────────────────────────────────────────┤
│  🟠 3 bids on Mumbai → Nagpur     [shipper] │  ← you posted this
│  🟢 Trip to Pune starts tomorrow  [driver]  │  ← you're driving this
│  🔵 Ravi accepted your invite     [fleet]   │  ← you employ him
│  🟠 Delivery code needed           [shipper] │  ← your consignee hasn't confirmed
└─────────────────────────────────────────────┘
```

For a single-persona user this is indistinguishable from today's app — the feed just contains one kind
of thing. **That is the property that makes it safe to ship**: it degrades gracefully to the current
product and gets richer as the user's business does.

### 3.3 Navigation appears as capability becomes true

Nav is derived, never chosen:

| Tab | Appears when |
|---|---|
| **Home** | always |
| **My Loads** | you have ever posted a load, or have `ship` capability |
| **Find Work** | you own a truck (`carry`) |
| **My Fleet** | you own ≥2 trucks, **or** you have ≥1 driver |
| **Trips** | you have `drive` capability |
| **Profile** | always |

A solo driver sees Home / Find Work / Trips / Profile. They add a second truck; **My Fleet appears**.
Nothing was configured.

### 3.4 Context comes from the object

Opening a booking resolves *your* relationship to **that** booking:

```
GET /bookings/:id  →  { ...booking, viewer: { relation: 'shipper' | 'carrier' | 'driver' | 'observer',
                                              sees_commercials: bool,
                                              actions: [...] } }
```

Same URL, same screen component, different truth. This is what makes the distributor case work: they
open a load they posted and see the shipper view; they open a load they won and see the carrier view.
**No mode, no switch.**

### 3.5 Emergence moments — the growth loop

Each is a call-to-action at the moment the fact becomes true, not a settings toggle:

| Trigger | Moment |
|---|---|
| Adds a 2nd truck | *"You now run 2 trucks. Assign a driver to the second?"* → fleet surfaces unlock |
| Invites a driver | *"You're now managing a fleet."* → fleet surfaces unlock |
| Posts a first load | shipper surfaces unlock silently |
| Owner-driver joins a fleet | keeps Find Work; **gains** assigned Trips |
| Distributor with trucks | all three live at once; the feed interleaves |

### 3.6 Interim (pre-31 Aug)

The three deployed apps stay. The **backend becomes persona-aware now** — `/auth/me` returns
capabilities, bookings return a `viewer` block, authorization moves off `role`. Each app renders the
slice it already renders, but reads capability instead of assuming a role.

**This is deliberate sequencing, not a compromise:** the one-app frontend is a rewrite that cannot land
by 31 Aug, and every backend change above is required for it either way. When the single app is built
it consumes an API that is already correct.

---

## 4. The identity model

### 4.1 Capabilities

```ts
type Capability =
  | 'ship'     // may post loads
  | 'drive'    // may be assigned trips  (has a drivers row)
  | 'carry'    // may bid / self-select   (owns ≥1 vehicle)
  | 'operate'  // fleet surfaces          (owns ≥2 vehicles OR has ≥1 driver)
```

`ship` is ungated — posting a load is the act that emerges the persona (D-5: no KYC gate at MVP).

### 4.2 Resolution (single source of truth, `@bharattruck/shared/personas`)

```
drives      := exists drivers where user_id = $user
fleets_led  := fleet_owners where user_id = $user
vehicles    := vehicles where driver_id in (drives) or fleet_owner_id in (fleets_led)
drivers_held:= fleet_drivers where fleet_owner_id in (fleets_led) and status in ('pending','active')

carry   := count(vehicles) >= 1
operate := count(vehicles) >= 2 or count(drivers_held) >= 1
```

### 4.3 Backward compatibility

The JWT keeps `role` **and** gains `personas`. Nothing breaks on deploy; services migrate to
capability checks one at a time. `users.role` becomes the **primary persona** and keeps its existing
job of deciding where emailed links land (`DRIVER_MAGIC_LINK_URL` etc.) — a multi-persona user still
needs one correct destination for a password-reset email.

---

## 5. Money

### 5.1 The split

`fleet_drivers.revenue_share_pct` — the fleet owner's call (D-7). `0` = salaried employee, which is
today's behaviour and the default, so nothing changes for existing rows.

`resolvePayee` becomes `resolvePayees` and returns **1..n** payees:

```
fleet-won, share = 0    → [fleet_owner: 100%]                  (today's behaviour, unchanged)
fleet-won, share = 30   → [fleet_owner: 70%, driver: 30%]
solo                    → [driver: 100%]
```

### 5.2 Razorpay Route — built inert

No credentials exist (`.env.example` declares them; Cloud Run has none). So:

- `RAZORPAY_KEY_ID` unset → `disbursement_mode = 'recorded'`, exactly today's behaviour
- set → `disbursement_mode = 'route'`, transfers to **stakeholder-owned linked accounts**

**No platform cut** (D-12). The platform is a conduit; the money never rests with it. That is
deliberate — taking freight as principal is a GTA red line
(`INDIA_FREIGHT_COMPLIANCE.md §1.3`).

### 5.3 Pricing

The engine stays and runs at auction start, but the quote is **advisory**. The shipper is shown a
reference, and the binding number is the carrier's accepted bid. `price_quotes` stops being a *lock*
for auction bookings and becomes a *reference snapshot*.

---

## 6. Operations

### 6.1 Direct-attach

Shipper and carrier are the same human → skip the auction, assign directly. Still produces: a real
booking, a real LR, a real invoice with **real freight** (D-15), and a real POD. The trip is not
special — only its *award path* is.

### 6.2 Availability

The **truck** carries the schedule (D-19). Accepting any work — a self-selected load, a fleet
assignment from either of two fleets — locks that truck for the window. A driver with no truck cannot
be double-booked because assignment is to a truck, not a person.

### 6.3 POD — OTP + evidence, no QR

Scrapped: QR (D-13). Kept and hardened:

| Control | Why |
|---|---|
| **OTP to the consignee**, gated on **geofence entry** | The secret sits off the driver's device. The geofence gate closes the "driver phones ahead from 40 km away" hole |
| **Camera-only photos, SHA-256 hashed on device, never re-encoded** | `INDIA_FREIGHT_COMPLIANCE.md §5.4`. Re-compressing destroys the evidence |
| **Server-authoritative timestamps** + retained clock skew | Device clocks are trivially reset; large skew is itself a signal |
| **Continuous GPS trail** | Far harder to forge than a point fix — must stay internally consistent for hours |
| **Expected-vs-actual counts** against a **server-held** quantity the driver cannot edit | This is what defeats strategic pilferage; free-text remarks do not |
| **Append-only audit log** | Makes every other control credible in a dispute |
| **Idempotent state machine**, no artificial ordering | Founder: *"no first this then this unless that's how it works"* |

**The receiver path assumes zero app installation** — OTP over SMS/email, works on a feature phone.
That is the mainstream path in Indian logistics, not the fallback.

**When the receiver cannot confirm at all** (my call, delegated): the driver captures evidence, the
trip moves to `delivery_asserted` — not `delivered` — and ops can close it. The record carries
`pod_strength = 'asserted'` so a weaker proof is never silently indistinguishable from a confirmed one.

### 6.4 Documents

| Document | MVP |
|---|---|
| **LR / consignment note** | Generated, **per-fleet-owner series**, Rule 46(b) format. Never a platform-wide counter (`INDIA_FREIGHT_COMPLIANCE.md §3.3`) |
| **E-way bill** | **Record + upload** an externally-generated one (D-17). Number, `valid_upto`, portal, and a file |
| **Invoice** | Generated in-house, incl. ≥₹5 cr shippers (D-18) |
| **Multi-truck (SKD/CKD)** | One invoice, per-truck delivery challan, original with the last truck (D-16) |

---

## 7. Deliberately deferred

| Item | Why | Revisit |
|---|---|---|
| Organisations / staff accounts | D-1. Painful past ~50 shippers | Post-MVP. Seam: nothing assumes `users.id` is the only actor — authorization goes through capability resolution, so an org actor slots in there |
| In-platform e-way bill generation | GSP + ISO 27001 lead time | Post-MVP. API fully documented |
| Reputation | D-20 | Post-MVP |
| Single-app frontend | Cannot land by 31 Aug | Post-MVP; backend is being made ready now (§3.6) |
| KYC gating | D-5 | Post-MVP |

---

## 8. Migration path

**Migrate, do not reset.** `users.role` is preserved as `primary_persona`; persona rows backfill from
it. The 620 seeded fleet assignments and every demo account keep working.

Ordering, each behind its own PR:

1. **0022** — `fleet_drivers.revenue_share_pct`, vehicle-ownership constraint, persona backfill
2. Shared capability resolver + `/auth/me` capabilities *(no behaviour change)*
3. Commercial-visibility rule moves to asset ownership
4. Documents: LR series, e-way bill record, invoice, multi-truck
5. POD rebuild
6. Payouts split + Razorpay Route (inert)
7. Pricing repositioned to advisory

Steps 1–2 are strictly additive: nothing reads the new columns until step 3.
