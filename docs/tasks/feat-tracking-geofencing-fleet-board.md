# feat/tracking-geofencing-fleet-board

**Started** 2026-07-31 · **Branch** `feat/tracking-geofencing-fleet-board` ·
**Worktree** `WIP/.tracking-wt` (isolated per §4.4 — the shared `WIP` checkout is on another
session's branch) · **Spec** `docs/BIBLE.md` §3.1 (CONTRACT), §3.2 (D-014/D-015/D-016/D-019)

## What this is

Founder ask, 2026-07-31: make the GPS/mapping/geofencing layer real, with the **fleet owner** as
the primary persona ("he has to have the map view to know every driver, where the driver is,
what the fuel consumption is, and everything wired to the vehicles"), then a map for the driver.

Three bodies of work:

1. **Close the Maps contract.** `/history`, `/pumps`, `/fuel`, `/alerts` were specified in §3.1
   and never built (Phase 3+ never ran).
2. **Add the event layer (D-014).** Everything was computed on read, which cannot express an
   event — which is why `route_alerts` had **0 rows in production** despite predating the
   migrations directory. Nothing had ever been in a position to write one.
3. **Two new surfaces:** the vehicle-centric fleet board (D-016) and the driver map + insights
   (D-019).

## Acceptance criteria

- [x] All 8 §3.1 contract endpoints exist and are JWT-gated, snake_case, `:bookingId`
- [x] Geofence enter/exit with dwell timing, persisted durably
- [x] Alerts have an open→resolved lifecycle and cannot spam (partial unique index)
- [x] Fleet board shows **every** truck an owner has, with a stated reason for absent data
- [x] Fuel resolves from `vehicle_cost_norms` per model, with labelled fallback tiers
- [x] Driver app renders a live map + pumps/fuel/alerts
- [x] No Google call on the ingest path; driver never polls `/track`
- [x] A Maps failure cannot take down the page around it
- [x] `npm run build` clean: bt-tracking-service, bt-booking-service, fleet, driver
- [x] Tests pass (25 new in bt-tracking-service; all existing booking tests still green)
- [ ] **PR opened + CI green + merged** — not done
- [ ] **Prod env set** (see Blocked below) — not done

## Verification evidence

**Backend, against the live DB (2026-07-31).** Replayed a synthetic drive along the real
Nagpur→Delhi polyline (7,471 vertices, 1,134 km) through `POST /internal/evaluate`:

```
1 at pickup yard         +     0m  open=[]          fence=[enter:pickup]
2.1 rolling out          +   710m  open=[]          fence=[exit:pickup]
4 speeding at 95 km/h    +  6945m  open=[speeding]  fence=[]
5 detour 2.2km off route +  7159m  open=[off_route] fence=[]
6 rejoined the route     +  3117m  open=[]          fence=[]
7.2 still stopped, 25min +     0m  open=[idle]      fence=[]
8 arrived at drop        +     0m  open=[near_drop] fence=[enter:drop]

summary: driven 98.5 km · moving 1.37h · idle 0.08h · night 1.37h
         avg 59.1 km/h · max 95 · stops 2 · dwell{pickup:120s}
alerts:  OPEN info near_drop · RESOLVED idle · RESOLVED off_route · RESOLVED speeding
```

Two bugs that run exposed, both fixed here: `night_seconds` counted **parked** time as night
driving, and `near_drop` never resolved once fired.

**Fleet board.** `GET /tracking/fleet/overview` as `balaji@bharattruck.in`: 12 trucks, 3 on
trips, 9 parked — the 9 parked ones are exactly what `/fleet/live` omits entirely. Rendered and
screenshotted; per-model kmpl correct (7.31 / 6.23 / 4.13 / 3.22 / 3.36 / 4.98).

**Driver app.** Live `in_transit` booking `5555…5555`: map slot renders in position, fuel shows
₹20,666 / 220.79 L with the DEF split and correctly states it fell back to a platform default
(that truck has no `model_category`), pumps returned real Places results with the honest
"searched from your last known position" note. Only console error is the expected
`RefererNotAllowedMapError` — localhost is not on the browser key's referrer allowlist (§6.7),
and the page does **not** crash.

## Bugs found and fixed while building

| Where | Bug |
|---|---|
| `repository.ts` | Selected `dest_address`; the column is `destination_address`. PostgREST 42703 fails the **whole** query, so every in-transit truck rendered as "assigned to a trip that is still unknown". |
| `evaluator.ts` | `night_seconds` counted stopped time — an overnight halt looked like a hard night run. |
| `evaluator.ts` | `near_drop` opened but never resolved; a route passing within 2 km early would pin the banner for the whole trip. |
| `fleet.ts` | "Last reported 73 min ago" rendered directly above a live "58 km/h" — it quoted telemetry when a fresher Redis position existed. |
| `fleet/map-guard.tsx` | A Maps rejection **crashed the whole React tree**, taking the truck list with it. |
| `LiveTrackMap.tsx` (driver) | `AdvancedMarker` anchors bottom-centre, so the driver's own round puck floated a marker-height above their true position. |
| `LiveTrackMap.tsx` (driver) | Route polyline rebuilt on **every GPS fix** (object-identity deps) — 7,471 vertices, several times a minute, with visible flicker. |

## Blocked — needs the founder

**Production env, two vars.** The evaluator is inert until these are set; the harness classifier
blocks agent-run `gcloud run services update`, so this must be run by a human. Both services are
pinned to immutable SHA tags, so the §5.3 image-roll-forward trap does **not** apply here.
`--update-env-vars` (merge) is load-bearing — `--set-env-vars` would wipe SUPABASE/JWT and
crash-loop the service.

```
gcloud run services update bt-tracking-service --region asia-south1 \
  --update-env-vars INTERNAL_SERVICE_SECRET=<booking-service's existing value>

gcloud run services update bt-booking-service --region asia-south1 \
  --update-env-vars TRACKING_SERVICE_URL=https://bt-tracking-service-itcdoenefa-el.a.run.app
```

The secret must MATCH the value already on `bt-booking-service` — read it with
`gcloud run services describe bt-booking-service --region asia-south1`.

## Notes / follow-ups

- Migration **0019 is already applied to the live DB** (additive + idempotent; verified).
- `feat/driver-live-map` @ `8f5f54f` is a **superseded** earlier driver map — ~53 commits behind,
  pre-dark-theme, adds a duplicate `NavigateButton`. Close it, do not rebase it.
- `shipper/src/components/maps/LiveTrackMap.tsx` is the last copy without the map guard
  (§5.4 item 10). Copy it across per D-013.
- Known issue §5.4 #3 confirmed again while testing: fleet-assigned bookings have no `quotes`
  row, so `ActiveTripSection` never renders for that driver and they cannot see the trip at all.
  The driver map is invisible on those bookings for that reason, not a map bug.
