# Task: `fix/subcontract-seam-and-payee`

**Relates to:** `docs/ARCHITECTURE_UNIFIED_IDENTITY.md` **D-24** (sub-contracting: the seam stays
open even though the flow is post-MVP) — sequencing row 9, *"closes the ₹0 payout hole"*. Two
defects that share one root assumption: *the executing driver and truck belong to the winning
carrier*.

## Defect 1 — MONEY (`bt-payment-service`)

`resolvePayees` derived payees from the booking, then looked the D-7 revenue split up with
`getDriverRevenueSharePct(fleet_owner_id, driver_id)`. That returned **0 when no `fleet_drivers`
row existed at all** — the same value it returns for a genuinely salaried driver. So a driver
executing a trip for a fleet they are not affiliated with was recorded as salaried and **paid
nothing**: no payout row, no error, no log line, and a ledger that agrees the trip settled in full.
The only party who would ever notice is the one who drove.

**Fix.** `getDriverShare()` replaces the bare number with a three-state answer:

| `affiliation` | Means | Payout |
|---|---|---|
| `affiliated` | a `fleet_drivers` row governs the pairing; `share_pct` may be 0 | salaried / split — **unchanged** |
| `none` | no row pairs this driver with this carrier | carrier is paid the whole freight, **plus an anomaly** |
| `unknown` | pre-0022 schema, no `revenue_share_pct` column | unchanged, and silent |

`resolveSettlement()` (pure, beside `resolvePayees`) returns `{ payees, anomalies }`. The
`UNAFFILIATED_EXECUTING_DRIVER` anomaly is logged at `warn` with booking / driver / carrier / amount
/ actor, **and** returned on the settle response as `anomalies[]`.

**No payout policy was invented.** What a sub-contracted driver is owed is post-MVP. The contract
payee stays the winning carrier (correct — the platform pays whoever won the work), the paise-exact
split and the owner-absorbs-rounding rule are untouched, and no ₹0 row is ever written. The only
change is that the settlement now says out loud which fact it was missing.

## Defect 2 — THE SEAM (`bt-fleet-service`), pure refactor

`assignDriverAndVehicle` enforced the coupling as guards scattered down the function: booking
belongs to this fleet, truck is this fleet's, driver holds an ACTIVE affiliation. Correct policy
today, but relaxing it later meant re-deriving the rule.

`mayExecuteFor(carrier, assets, lookups?)` is now the one named predicate: *may this truck and this
driver execute work won by this carrier?* It returns the refusal rather than throwing, so both
ownership facts and their deliberately different refusals (404 for the truck, 403 for the
affiliation) sit side by side and can be asserted on without a database.

**Authorization is byte-for-byte unchanged**: same two reads, same order, same status codes, same
messages. `vehicle_assignments`' insert remains the mutual-exclusion authority (the 23505 catch);
D-19's `assertVehicleAvailable` read in front of it is untouched; `vehicle-schedule.ts` changes only
a comment that named the function that moved.

## Acceptance criteria

- [x] A missing affiliation is distinguishable from a share of 0, in the store and in the resolver.
- [x] The anomaly is logged AND returned; a salaried (`share 0`) trip and a pre-0022 schema stay silent.
- [x] Split arithmetic, rounding direction, reconciliation and the pre-0016/pre-0023 paths unchanged.
- [x] Assignment authorization unchanged — same refusals, same order, same codes.
- [x] Both services `npm run build` clean; both suites green.

## Verification

```
bt-payment-service   npm run build → tsc clean
bt-payment-service   npm test      → 105/105 (payment.e2e, was 87) + 7/7 (payout-wire-shape)
bt-fleet-service     npm run build → tsc clean
bt-fleet-service     npm test      → 46/46 economics, 25/25 vehicle-schedule, 15/15 assignment-seam (new)
```

New coverage: an unaffiliated executing driver raises the anomaly, is logged with every id needed to
chase the money, and writes no ₹0 row; an affiliated driver on 0 is still salaried; an affiliated
driver on 30 still splits 70/30; and every assignment authorization case — including which refusal
wins when both facts fail — asserted through the new predicate.

## Risk

Low. The payment change adds a field to a response and a branch that only fires on a state no
production booking should be in; the fleet change is a move with no new or removed condition.

**Migrations: none.** Both services keep running against every schema state they already tolerated.
