# feat/fleet-auction-bidding

**Started** 2026-07-31 · **Branch** `feat/fleet-auction-bidding` (off `main` @ `8749be5`) ·
**Worktree** `WIP/.auction-wt` (isolated per §4.4) · **Founder ask:** wire bidding into the fleet
console, handle many auctions cleanly, keep the history, match the existing console styling.

## What this is

The Auctions page shipped with a banner reading *"Placing a bid is not wired into this console
yet."* The service side already accepted a fleet owner as a bidder; the console had no client
function for it and no fleet-scoped list of open loads.

**The structural reason it was stuck:** the console's only booking call was `GET /fleet/bookings`,
scoped to `bookings.fleet_owner_id` — a column bt-booking-service writes in exactly one place,
`awardBooking()`, when a shipper *accepts* a quote. So the endpoint could only ever return auctions
already won. Bidding is anchored on `quotes.fleet_owner_id`, written at bid time, which is what the
two new reads use.

## Acceptance criteria

- [x] Fleet can see open loads from shippers
- [x] Fleet can place, replace and withdraw a bid
- [x] Fleet can reply to a shipper counter-offer
- [x] Full price history per bid
- [x] Many auctions handled cleanly — board sorted by time pressure, bid state inline per row,
      counter-offers surfaced at the top with a banner
- [x] Matches the existing fleet-console visual language (white cards, gray borders, blue accents,
      `Stat` tiles, same table classes)
- [x] Builds clean: `fleet`, `bt-fleet-service`, `bt-booking-service`
- [x] `bt-booking-service` tests pass (11 checks)
- [ ] **PR opened + CI green + merged** — not done
- [ ] **Deploy** — not done (migration 0020 IS already applied to live, see below)

## Endpoints added

| Method | Path | Service | Notes |
|---|---|---|---|
| GET | `/api/fleet/auctions` | bt-fleet-service | Open loads + this fleet's bid + `bid_count`. Excludes `target_driver_id` loads and expired ones by default. |
| GET | `/api/fleet/bids` | bt-fleet-service | Every bid this fleet has, load joined. |

Writes reuse the **existing** bt-booking-service routes — `POST /bookings/:id/quotes`,
`PATCH …/counter`, `PATCH …/withdraw`, `GET …/history`. They already accept a fleet owner and
already own the deadline, duplicate-bid and fleet-affiliated-driver rules; proxying or
reimplementing them in the fleet service would fork the auction rules across two services.

## Bugs found and fixed

**1. Tenant isolation — `GET /bookings` leaked every booking to any fleet account (security).**
`repository.listBookings()` branched on `'shipper'` and `'driver'`. `fleet_owner` matched neither
and fell through to the unfiltered path commented `// admin: no additional filter`, so a fleet
account received **every booking on the platform** — other shippers' loads, addresses and prices
included. The role was added in migration 0014 and this function was never widened with it. Fleet
owners now see the open board only. The `admin` comment was tightened to say a new role must add
its own branch rather than silently inherit a full-table read.

**2. Fleet bid history was never recorded — migration 0020.**
`negotiations.actor_role` carried `CHECK (actor_role IN ('shipper','driver'))`, predating the fleet
persona. Every fleet bid and counter writes `actor_role='fleet_owner'` and was therefore rejected —
**silently**, because `recordNegotiation()` catches it for the fleet branch on purpose (failing a
real bid over an audit row is the worse trade) and its own comment says *"widen the
negotiations.actor_role check"*. Confirmed live before the fix: both of Shree Balaji Roadlines'
quotes had `neg_rows = 0`, so the Price history dialog could only ever say "No history yet".

## Verification evidence (live stack, 2026-07-31)

```
GET /fleet/auctions  -> 13 open loads, real shippers/asks, existing bid inline on
                        Pune→Bangalore (₹47,800, Submitted, −₹1,700 vs ask), bid_count correct
GET /fleet/bids      -> the fleet's bids, each with its booking joined
```

Placed two real bids through the UI: **₹43,500** (Andheri East → Connaught Place, ask ₹45,000) and
**₹19,200** (Jaipur Depot → Delhi Market, ask ₹16,000). Live bids went 1 → 3; deltas vs ask
rendered; the bid dialog surfaced the shipper's `special_instructions` ("Keep cool") and a live
delta as the price was typed.

Price history after migration 0020:

```
Your fleet   ₹19,200
Can pick up on the 8th, 2.5t no problem.
31 Jul, 05:20 pm
```

## Notes / follow-ups

- **Migration 0020 is already applied to live** (additive; widening a CHECK cannot invalidate an
  existing row). The code change is NOT deployed, so nothing depends on it yet.
- **Three test bids are live** on the demo tenant (Shree Balaji Roadlines) against demo shipper
  loads. They are real rows; withdraw them from **My bids → Withdraw** if you want them gone.
- The two bids placed *before* migration 0020 have no negotiation rows and cannot get them
  retroactively — their Price history will stay empty. Only a cosmetic gap on demo data.
- **Not built:** accepting a shipper's counter-offer outright at the shipper's price. The fleet can
  counter back or withdraw. `PATCH /quotes/:id/accept` exists but is shipper-side (it awards the
  booking); a fleet-side "accept their price" needs either a product decision or a counter at the
  shipper's exact number, which is what the Reply dialog already allows.
- `bid_count` counts live bids only (withdrawn/rejected excluded) so it cannot be inflated by a
  rival repeatedly re-bidding.
