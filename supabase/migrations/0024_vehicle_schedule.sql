-- migration 024: the truck carries the schedule (locked decision D-19).
--
-- THE HOLE THIS CLOSES: a driver may be affiliated to several fleets (D-8), and an
-- owner-driver also self-selects work off the marketplace. One truck therefore has
-- up to three independent sources of commitment — fleet A, fleet B, and its own
-- driver — and none of them can see the others' calendar. Anchoring the schedule on
-- the VEHICLE is what collapses them into one calendar: whoever accepted the work,
-- the truck is the thing that can only be in one place at a time. A driver with no
-- truck cannot be double-booked at all, because assignment is to a truck.
--
-- WHY EXTEND vehicle_assignments RATHER THAN ADD A vehicle_schedule TABLE:
-- an assignment row ALREADY *is* the commitment. It is written when work is accepted
-- and released_at is stamped when the trip ends — precisely the lifecycle a schedule
-- entry needs. A parallel table would have to be written in the same breath as every
-- assignment and released in the same breath as every release, across services, with
-- no transaction spanning the two writes; the first missed write leaves a truck
-- either blocked forever or silently double-bookable, and nothing would ever detect
-- the drift. Two columns on the row that already exists cannot drift from it.
--
-- WHY THE WINDOW IS NULLABLE: 677 live bookings and the seeded assignments predate
-- this. A row with no window means UNKNOWN, never "free all year" — the overlap check
-- in bt-fleet-service treats an unknown window as non-blocking and falls straight
-- back to the 0016 partial-unique indexes, which is exactly today's behaviour.
--
-- WHY NO GIST EXCLUSION CONSTRAINT: 0016's vehicle_assignments_one_live_per_vehicle
-- already refuses ANY second live assignment on a truck, overlapping or not. An
-- exclusion on (vehicle_id WITH =, tstzrange(window_start, window_end) WITH &&) is
-- strictly weaker than that index while the index stands, so it would add no refusal
-- and would cost a btree_gist extension. Relaxing that index so a truck committed for
-- next week is still bookable today LOOSENS a live guard against a live DB, so it
-- belongs in its own migration with its own decision, not smuggled in here.

-- ---------------------------------------------------------------
-- (1) The window itself. Half-open [window_start, window_end): a truck released on
-- the 5th and picking up again on the 5th is not double-booked, and back-to-back
-- loads are the fleet's normal business rather than a conflict.
-- ---------------------------------------------------------------
alter table public.vehicle_assignments
  add column if not exists window_start timestamptz,
  add column if not exists window_end   timestamptz;

comment on column public.vehicle_assignments.window_start is
  'D-19: start of the truck''s commitment, anchored at IST start-of-day of bookings.pickup_date. NULL = unknown (pre-0024 row), which never blocks.';
comment on column public.vehicle_assignments.window_end is
  'D-19: expected end of the commitment, exclusive. NULL = open-ended — occupied until released_at is stamped.';

-- An inverted window is not a conservative guess, it is a window that matches
-- nothing: it would report the truck free for its own trip.
alter table public.vehicle_assignments drop constraint if exists vehicle_assignments_window_ordered;
alter table public.vehicle_assignments add constraint vehicle_assignments_window_ordered
  check (window_start is null or window_end is null or window_end > window_start);

-- The overlap probe is always "live rows for THIS truck", never fleet-scoped — the
-- point of D-19 is that a commitment blocks the truck whoever made it.
create index if not exists vehicle_assignments_vehicle_window_idx
  on public.vehicle_assignments (vehicle_id, window_start, window_end)
  where released_at is null;

-- ---------------------------------------------------------------
-- (2) Backfill the LIVE rows only.
--
-- Released rows are history and are never consulted by the overlap check, so
-- rewriting them would be churn against a live table for no read.
--
-- window_end is deliberately left NULL rather than guessed here: the transit
-- estimate lives in bt-fleet-service (haversine x circuity / km-per-day) and
-- re-deriving it in SQL would fork the formula. NULL means open-ended, which errs
-- toward refusing an assignment on a truck that is already out — the safe direction,
-- since a false refusal is visible to a dispatcher and a false allow is a trip that
-- physically cannot run.
-- ---------------------------------------------------------------
update public.vehicle_assignments va
   set window_start = (b.pickup_date::timestamp at time zone 'Asia/Kolkata')
  from public.bookings b
 where b.id = va.booking_id
   and va.released_at is null
   and va.window_start is null
   and b.pickup_date is not null;
