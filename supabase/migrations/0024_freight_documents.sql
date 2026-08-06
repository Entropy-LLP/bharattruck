-- migration 024: freight documents — LR / consignment note, tax invoice, e-way bill record.
--
-- WHY THIS EXISTS:
--   A trip that moves goods in India produces three documents (docs/INDIA_FREIGHT_COMPLIANCE.md §2):
--   the carrier's consignment note, the supplier's tax invoice, and the e-way bill. Today the
--   platform records none of them, so the "Completed Paid Trip" it can evidence is a database row,
--   not a transaction anyone's accountant or a checkpoint officer would recognise.
--
-- THE ONE THING THAT MUST NOT BE GOT WRONG — DOCUMENT NUMBERING:
--   §3.3. The LR series belongs to the FLEET OWNER, the invoice series belongs to the SHIPPER, and
--   both are per financial year. This is not a style preference. A platform-wide LR counter is
--   direct documentary evidence that the PLATFORM operates the numbering rather than the carrier,
--   which is precisely the fact that flips the GTA analysis under GST (§1.3, red line 1). That is a
--   tax-and-liability event, not a paperwork one. Rule 46(b) expressly permits "one or multiple
--   series", which is what makes a per-owner series lawful.
--
--   Rule 46(b) also fixes the FORM of the number, and the production specimens in §11.1 confirm the
--   statute is followed literally in practice ('2026-27/11', 'MA/4135/2526'):
--
--       ^[A-Za-z0-9/-]{1,16}$     16 chars MAX, alphanumerics + hyphen + slash ONLY
--       unique per (owner, financial year), consecutive, reset 1 April, never renumbered
--
--   A uuid or a 20-character slug is an INVALID GST document number. §3.3 flags this as a common
--   bug in logistics SaaS, so both the CHECK constraints and the allocator below enforce the regex
--   rather than trusting the caller.
--
-- STRICTLY ADDITIVE, AND NOT ON ANY DEPLOY-ORDERING CRITICAL PATH:
--   Everything here is a NEW table, enum or function. Not one existing column is altered and not one
--   existing query changes meaning, so the 677 live bookings behave identically whether or not this
--   file has been applied. Migrations are applied BY HAND while deploy.yml auto-deploys the service
--   on merge (CLAUDE.md), so the service side treats every object here as optional: reads tolerate a
--   missing relation and answer "no documents", and an issue attempt on a pre-0024 database fails
--   loudly with a 503 instead of corrupting anything. Nothing pre-existing reads these tables.
--
--   Independent of 0023 (`payout_split`), which is in the repo and NOT applied: nothing below
--   references payouts, payee_type, or revenue_share_pct.

-- ---------------------------------------------------------------
-- (1) Enums.
--
-- Enums rather than free text for exactly the values where a typo is a compliance defect and the
-- value set is fixed by statute or by the specimens. Everything genuinely open-ended (addresses,
-- descriptions, HSN/SAC) stays text.
-- ---------------------------------------------------------------
do $$
begin
  -- §5.8 + §11.1: "To Pay" is the informal sector's built-in escrow — the consignee pays before the
  -- goods are released and the carrier's s.170 lien is the leverage. Modelling it as a note on the
  -- LR would let a POD flow release goods before payment and quietly delete that leverage.
  if not exists (select 1 from pg_type where typname = 'freight_term') then
    create type public.freight_term as enum ('PAID', 'TO_PAY', 'TO_BE_BILLED');
  end if;

  -- The VRL specimens print delivery mode as a boxed field next to the freight term: a GODOWN
  -- delivery is collected by the consignee from the destination branch, a DOOR delivery is not.
  -- The POD geofence target differs between the two, which is why it is recorded, not implied.
  if not exists (select 1 from pg_type where typname = 'delivery_mode') then
    create type public.delivery_mode as enum ('GODOWN', 'DOOR');
  end if;

  -- §4.8, NIC errors 444/445/448/449: an e-way bill generated on NIC1 cannot be cancelled or
  -- extended on NIC2. Portal affinity is real and it is not recoverable after the fact, so the
  -- portal is captured at record time or not at all.
  if not exists (select 1 from pg_type where typname = 'ewb_portal') then
    create type public.ewb_portal as enum ('NIC1', 'NIC2');
  end if;

  -- The two series this migration allocates. Kept separate because they belong to DIFFERENT
  -- parties: the LR series is the carrier's, the invoice series is the shipper's.
  if not exists (select 1 from pg_type where typname = 'document_series_kind') then
    create type public.document_series_kind as enum ('lr', 'invoice');
  end if;

  -- Who owns a series. Polymorphic because the carrier on a trip is a fleet_owners row on a fleet
  -- booking and a drivers row on a solo owner-driver booking, while the supplier on an invoice is
  -- a users row — and all three issue their own documents under their own GSTIN. Collapsing them
  -- into one parent table would be a bigger change than this slice, and sharing one counter across
  -- them would recreate the platform-wide-counter problem in miniature.
  if not exists (select 1 from pg_type where typname = 'document_issuer_kind') then
    create type public.document_issuer_kind as enum ('fleet_owner', 'driver', 'shipper');
  end if;
end $$;

-- ---------------------------------------------------------------
-- (2) document_series — one counter row per (kind, issuer, financial year).
--
-- WHY A COUNTER ROW AND NOT A POSTGRES SEQUENCE — the decision this whole slice turns on:
--
--   nextval() is deliberately NON-TRANSACTIONAL. It does not roll back. Any failure after the
--   allocation and before the commit — a CHECK violation on the document row, a duplicate booking,
--   a client disconnect, a deploy killing the container — permanently BURNS that number. Rule 46(b)
--   requires a CONSECUTIVE series, and "we can explain the missing numbers" is not the standard an
--   assessing officer applies. A sequence would also need runtime DDL (one sequence per owner per
--   year), which needs elevated privileges and is itself not transactional.
--
--   A counter row incremented with `update ... returning` is transactional in both directions:
--
--     NO DUPLICATE — the UPDATE takes a row-level exclusive lock that is held to COMMIT. A second
--     transaction running the same UPDATE blocks on it; when the first commits, the second re-reads
--     the row under READ COMMITTED (EvalPlanQual) and increments from the NEW value. Two concurrent
--     allocations therefore cannot return the same number, and no amount of application-level
--     retrying changes that — the serialisation happens in the storage engine.
--
--     NO GAP — the increment lives in the same transaction as the INSERT of the document row (see
--     issue_lorry_receipt / issue_freight_invoice below, each of which is ONE function call and
--     therefore ONE implicit transaction). If the insert fails for any reason at all, the increment
--     rolls back with it and the number is returned to the pool. In particular a unique violation
--     on the document row — the retry case — aborts the allocation too, so a retried request
--     re-reads the SAME next_number instead of skipping one. This is why the unique indexes below
--     are safe to add: they can never manufacture a gap.
--
--   The cost is that concurrent issuance for ONE owner serialises. That is correct — a gapless
--   series is a serial object by definition — and the contention is per owner per year, so it is
--   invisible at any volume this platform will see.
--
-- THE 1 APRIL RESET IS STRUCTURAL, NOT A JOB. financial_year is part of the unique key, so the
-- first document issued on 1 April simply finds no row and creates one starting at 1. There is no
-- scheduled task to forget to run, and no window in which a stale counter can issue last year's
-- number.
-- ---------------------------------------------------------------
create table if not exists public.document_series (
  id              uuid primary key default gen_random_uuid(),

  series_kind     public.document_series_kind not null,

  -- Deliberately NO foreign key. issuer_id points at fleet_owners.id, drivers.id or users.id
  -- depending on issuer_kind, and a FK to any one of them would be wrong for the other two.
  -- The absence is also load-bearing on its own: a counter must survive the deletion of the party
  -- it belongs to, because "which numbers has this GSTIN already issued" has to stay answerable
  -- for the statutory retention period (§8.1) regardless of what happens to the account.
  issuer_kind     public.document_issuer_kind not null,
  issuer_id       uuid not null,

  -- Indian FY label, e.g. '2026-27'. Text rather than an int pair because it is printed verbatim
  -- inside the document number and must round-trip exactly.
  financial_year  text not null check (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),

  -- Optional per-owner series prefix ('MA' in the Maru specimen 'MA/4135/2526'). Capped at 4
  -- characters and to the Rule 46(b) charset MINUS the slash (the allocator adds the separator) so
  -- the assembled number cannot run past 16: 4 prefix + '/' + 7 FY + '/' leaves 3 digits of serial
  -- at worst, and 8 digits with no prefix at all.
  --
  -- Captured on the row rather than on the owner: the format of an ISSUED series must never change
  -- mid-year, so the first document of a financial year freezes it.
  prefix          text check (prefix ~ '^[A-Za-z0-9-]{1,4}$'),

  -- The NEXT serial to hand out. Never decremented, never reset within a year, never edited by
  -- hand — doing any of those reissues a number that is already printed on a document someone else
  -- is holding.
  next_number     bigint not null default 1 check (next_number >= 1),

  last_issued_at  timestamptz,
  created_at      timestamptz not null default now(),

  -- The uniqueness that makes the series per-owner rather than platform-wide. One counter per
  -- (kind, issuer, year); two fleet owners issuing on the same day touch different rows and do not
  -- block each other.
  constraint document_series_scope_key
    unique (series_kind, issuer_kind, issuer_id, financial_year)
);

comment on table public.document_series is
  'Per-owner, per-financial-year gapless counters for LR and invoice numbers (Rule 46(b)). NEVER a '
  'platform-wide counter — that is the fact that flips the GTA analysis (INDIA_FREIGHT_COMPLIANCE '
  'section 3.3 / 1.3). Incremented only inside allocate_document_number().';

-- ---------------------------------------------------------------
-- (3) lorry_receipts — the consignment note.
--
-- Field set from §3.2 (Rule 54(3) + Rule 46) and §11.2, which is the one that matters in practice:
-- the statute says what must be present, the specimens say what a consignee, a checkpoint officer
-- and an accounts team actually expect to see.
--
-- THE ISSUER IS THE CARRIER. Never BharatTruck. Red line 1 (§1.3): the platform must never be the
-- named issuer on an LR. The issuer_* columns are denormalised copies rather than a join for that
-- exact reason — a document is a snapshot of who issued it on the day, and it must keep saying so
-- after the fleet renames itself or changes GSTIN.
-- ---------------------------------------------------------------
create table if not exists public.lorry_receipts (
  id                     uuid primary key default gen_random_uuid(),

  -- One LR per booking at MVP. This UNIQUE is not just tidiness: it is the idempotency guard that
  -- makes a retried "issue LR" return the document already issued instead of minting a second one,
  -- and (see the allocator note above) it is what proves a retry cannot burn a serial.
  -- D-16 multi-truck consignments put a DELIVERY CHALLAN on each truck, not a second LR, so this
  -- holds there too; if that ever changes the key becomes (booking_id, vehicle_number).
  booking_id             uuid not null unique references public.bookings(id) on delete restrict,

  -- The number. The regex is the Rule 46(b) rule restated at the storage layer so that no future
  -- code path — a backfill, an ops script, a hand-written insert — can put a uuid in this column.
  lr_number              text not null
                           check (lr_number ~ '^[A-Za-z0-9/-]{1,16}$'),
  series_id              uuid not null references public.document_series(id) on delete restrict,
  financial_year         text not null check (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),

  -- Issuer = the carrier party (§1.3 red line 1). transporter_id IS the GSTIN for a registered
  -- transporter, or a TRANSIN for an unregistered one (§4.9) — one column because the EWB system
  -- takes one value in one field, and which of the two it is is derivable from its shape.
  issuer_kind            public.document_issuer_kind not null
                           check (issuer_kind in ('fleet_owner', 'driver')),
  issuer_id              uuid not null,
  issuer_legal_name      text not null,
  issuer_transporter_id  text,
  issuer_pan             text,
  issuer_address         text,

  -- Parties. GSTIN and PAN of both sides appear on the specimens and Rule 54(3) requires the GSTIN
  -- of whoever is liable to pay the tax, which may be either of them or the GTA.
  consignor_name         text not null,
  consignor_gstin        text,
  consignor_pan          text,
  consignor_address      text,
  consignee_name         text not null,
  consignee_gstin        text,
  consignee_address      text,

  -- Rule 54(3): place of origin and destination. delivery_address is Rule 46(o) — the address of
  -- delivery WHERE DIFFERENT from the place of supply, and it is the address the POD geofence must
  -- target (§5.4). Billing the consignee at their head office while delivering to a warehouse 400km
  -- away is ordinary, so these genuinely differ.
  origin_place           text not null,
  destination_place      text not null,
  delivery_address       text,

  -- Rule 54(3) names the registration number of the goods carriage explicitly. Nullable only
  -- because an LR can legitimately be raised at booking, before the truck is finally allotted.
  vehicle_number         text,
  articles_count         integer check (articles_count is null or articles_count > 0),

  -- §11.2, the trap a statute-only reading misses: freight bills on CHARGED weight, which is
  -- max(actual, volumetric). One weight column cannot reproduce a real freight bill — the actual
  -- weight is what was handed over and what Carriage by Road Act s.9 makes prima facie evidence,
  -- the charged weight is what the money is computed on, and they routinely differ.
  actual_weight_kg       numeric(12,3) not null check (actual_weight_kg > 0),
  charged_weight_kg      numeric(12,3) not null check (charged_weight_kg > 0),
  constraint lorry_receipts_charged_ge_actual
    check (charged_weight_kg >= actual_weight_kg),

  rate_inr               numeric(12,2) check (rate_inr is null or rate_inr >= 0),
  rate_type              text,

  -- "(said to contain)". The carrier's legal hedge, printed verbatim on the specimens: they never
  -- open the packaging, so the description is the consignor's assertion, not the carrier's. Stored
  -- as the bare description; the prefix is presentation.
  said_to_contain        text not null,

  -- SAC 996511 — transport of goods by road. Defaulted because it is the same code on every trip
  -- this platform will ever carry, and a wrong SAC on a GTA document is a real assessment problem.
  sac_code               text not null default '996511',

  -- §11.2: separate charge lines summing to a total, NOT one lump figure. The consignee disputes
  -- hamali far more often than freight, and a single total makes that dispute unanswerable.
  -- The total is GENERATED so the printed sum and the stored sum cannot drift apart.
  freight_charge_inr     numeric(12,2) not null default 0 check (freight_charge_inr    >= 0),
  stationary_charge_inr  numeric(12,2) not null default 0 check (stationary_charge_inr >= 0),
  handling_charge_inr    numeric(12,2) not null default 0 check (handling_charge_inr   >= 0),
  other_charge_inr       numeric(12,2) not null default 0 check (other_charge_inr      >= 0),
  total_charge_inr       numeric(12,2)
                           generated always as (freight_charge_inr + stationary_charge_inr
                                              + handling_charge_inr + other_charge_inr) stored,

  freight_term           public.freight_term not null,
  delivery_mode          public.delivery_mode,
  loading_by             text check (loading_by   is null or loading_by   in ('consignor', 'consignee')),
  unloading_by           text check (unloading_by is null or unloading_by in ('consignor', 'consignee')),

  -- Rule 46(n)/(p). Printed as their own labelled fields on every specimen, so they are columns,
  -- not derived at render time. RCM is the default GTA posture (§9.5).
  place_of_supply_state  text,
  place_of_supply_code   text check (place_of_supply_code is null or place_of_supply_code ~ '^[0-9]{2}$'),
  reverse_charge         boolean not null default true,

  -- Carriage by Road Act s.9(4)/s.10/s.11: the risk-rate election, printed on the VRL specimens as
  -- "BOOKED AT OWNER'S RISK". It is the carrier's liability undertaking and it changes what the
  -- carrier owes on a loss claim, so it is recorded rather than assumed.
  carriage_risk          text not null default 'owners_risk'
                           check (carriage_risk in ('owners_risk', 'carriers_risk')),

  -- §11.4: on paper these three are TRANSCRIBED from the other party's document by a booking clerk,
  -- and they drift — one specimen pair is out by Rs.63,776 on a hand-keyed invoice value, which
  -- matters because consignment value drives the e-way bill threshold. Generating both documents is
  -- what removes the entire class of error, so these are populated from our own invoice row.
  invoice_number         text check (invoice_number is null or invoice_number ~ '^[A-Za-z0-9/-]{1,16}$'),
  invoice_value_inr      numeric(14,2) check (invoice_value_inr is null or invoice_value_inr >= 0),
  eway_bill_number       text check (eway_bill_number is null or eway_bill_number ~ '^[0-9]{12}$'),

  issued_at              timestamptz not null default now(),
  created_at             timestamptz not null default now()
);

-- The backstop assertion that the series logic is right. It can never fire on the allocator's own
-- output (the counter serialises), so if it ever DOES fire, something wrote an LR number without
-- going through issue_lorry_receipt() — which is the thing that must never happen silently.
create unique index if not exists lorry_receipts_number_idx
  on public.lorry_receipts (issuer_kind, issuer_id, financial_year, lr_number);

create index if not exists lorry_receipts_series_idx
  on public.lorry_receipts (series_id, issued_at desc);

comment on table public.lorry_receipts is
  'Consignment note / lorry receipt. ISSUED BY THE CARRIER, never by the platform (red line 1). '
  'Numbering is per fleet owner per FY via document_series. Field set from '
  'INDIA_FREIGHT_COMPLIANCE.md sections 3.2 and 11.2.';

comment on column public.lorry_receipts.charged_weight_kg is
  'max(actual, volumetric) — the weight the freight is billed on. Distinct from actual_weight_kg by '
  'design; a single weight column cannot reproduce a real freight bill (section 11.2).';

-- ---------------------------------------------------------------
-- (4) freight_invoices — the supplier's tax invoice.
--
-- Field set from §11.3. Numbered per SHIPPER, in the shipper's own series — the invoice is the
-- shipper's document for the goods they sold, and it has nothing to do with the carrier's series.
--
-- D-18: shippers at or above Rs.5 cr turnover must obtain an IRN through the e-invoice system. We
-- do not generate one (that is a second integration, BLOCKERS B-3), but we record it when the
-- shipper supplies it, because its presence changes which e-way bill path is even legal for them
-- (§11.5) and an invoice that is missing an IRN it should have is not a valid tax invoice at all.
-- ---------------------------------------------------------------
create table if not exists public.freight_invoices (
  id                     uuid primary key default gen_random_uuid(),

  -- One invoice per booking, including a D-16 multi-truck consignment: ONE invoice, per-truck
  -- delivery challans. Same idempotency role as the LR's booking_id unique.
  booking_id             uuid not null unique references public.bookings(id) on delete restrict,

  invoice_number         text not null
                           check (invoice_number ~ '^[A-Za-z0-9/-]{1,16}$'),
  series_id              uuid not null references public.document_series(id) on delete restrict,
  financial_year         text not null check (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),

  -- The supplier is the shipper (users.id). Denormalised for the same snapshot reason as the LR's
  -- issuer block.
  supplier_user_id       uuid not null references public.users(id) on delete restrict,
  supplier_legal_name    text not null,
  supplier_gstin         text,
  supplier_address       text,

  -- §11.3: 'Billed to' and 'Shipped to' are SEPARATE blocks on every specimen. Rule 46(o)'s
  -- "address of delivery where different from the place of supply" is exactly this distinction,
  -- and §5.4 says the POD geofence targets the shipped-to address, not the billing one.
  billed_to_name         text not null,
  billed_to_gstin        text,
  billed_to_address      text,
  billed_to_state        text,
  billed_to_state_code   text check (billed_to_state_code is null or billed_to_state_code ~ '^[0-9]{2}$'),
  shipped_to_name        text,
  shipped_to_gstin       text,
  shipped_to_address     text,
  shipped_to_state       text,
  shipped_to_state_code  text check (shipped_to_state_code is null or shipped_to_state_code ~ '^[0-9]{2}$'),

  place_of_supply_state  text,
  place_of_supply_code   text check (place_of_supply_code is null or place_of_supply_code ~ '^[0-9]{2}$'),
  reverse_charge         boolean not null default false,

  -- Money. Split by head because the e-way bill formula needs the components, not a total.
  taxable_value_inr      numeric(14,2) not null check (taxable_value_inr >= 0),
  cgst_inr               numeric(14,2) not null default 0 check (cgst_inr  >= 0),
  sgst_inr               numeric(14,2) not null default 0 check (sgst_inr  >= 0),
  utgst_inr              numeric(14,2) not null default 0 check (utgst_inr >= 0),
  igst_inr               numeric(14,2) not null default 0 check (igst_inr  >= 0),
  cess_inr               numeric(14,2) not null default 0 check (cess_inr  >= 0),

  -- Rule 138 Explanation 2, third limb: subtracted ONLY where one invoice covers exempt and taxable
  -- goods together. On a wholly taxable invoice this stays 0.
  exempt_value_inr       numeric(14,2) not null default 0 check (exempt_value_inr >= 0),

  -- s.206C(1H) TCS and the round-off both appear on the specimens and both move the grand total,
  -- but NEITHER is part of consignment value — hence separate columns below the generated one.
  tcs_inr                numeric(14,2) not null default 0 check (tcs_inr >= 0),
  round_off_inr          numeric(14,2) not null default 0,

  -- §4.1, Rule 138 Explanation 2, VERBATIM: value under s.15 PLUS every tax charged, MINUS the
  -- exempt component on a mixed invoice. GENERATED, so no caller can accidentally threshold on the
  -- pre-tax figure: Rs.48,000 + 5% = Rs.50,400 requires an e-way bill and Rs.48,000 does not, and
  -- that difference is a s.129 detention.
  consignment_value_inr  numeric(14,2)
                           generated always as (taxable_value_inr + cgst_inr + sgst_inr + utgst_inr
                                              + igst_inr + cess_inr - exempt_value_inr) stored,

  grand_total_inr        numeric(14,2) not null check (grand_total_inr >= 0),

  -- §11.4 / the dispatch block: the invoice reserves space for the carrier's numbers and the LR
  -- reserves space for the invoice's. Both are transcribed on paper. We fill both from our own rows.
  lr_number              text check (lr_number is null or lr_number ~ '^[A-Za-z0-9/-]{1,16}$'),
  eway_bill_number       text check (eway_bill_number is null or eway_bill_number ~ '^[0-9]{12}$'),

  -- E-invoice fields, recorded not generated (D-17/D-18). The IRN is a 64-hex SHA-256.
  irn                    text check (irn is null or irn ~ '^[0-9a-fA-F]{64}$'),
  ack_no                 text,
  ack_date               timestamptz,

  issued_at              timestamptz not null default now(),
  created_at             timestamptz not null default now()
);

create unique index if not exists freight_invoices_number_idx
  on public.freight_invoices (supplier_user_id, financial_year, invoice_number);

create index if not exists freight_invoices_series_idx
  on public.freight_invoices (series_id, issued_at desc);

comment on table public.freight_invoices is
  'Shipper tax invoice. Numbered per SHIPPER per FY (a separate series from the carrier LR). '
  'consignment_value_inr is generated from the Rule 138 Explanation 2 formula and INCLUDES GST.';

comment on column public.freight_invoices.consignment_value_inr is
  'Rule 138 Explanation 2: taxable value + CGST + SGST + UTGST + IGST + cess - exempt component. '
  'GST-INCLUSIVE. Any e-way bill threshold check on the pre-tax value is simply wrong (section 4.1).';

-- ---------------------------------------------------------------
-- (5) eway_bill_records — RECORD ONLY. No API integration, by decision.
--
-- D-17 + §11.5: generating an e-way bill needs a GSP contract, ISO 27001 inside 90 days, AND a
-- second IRP integration for e-invoice-enabled shippers whose EWB the EWB API will simply refuse
-- (NIC errors 720/856). That is a quarter of lead time on the critical path for a document our
-- users can already produce in two minutes on the portal. So we record theirs.
--
-- 🔴 valid_upto IS STORED, NEVER DERIVED. §4.4 Explanation 1: a "day" of validity expires at
-- midnight of the day IMMEDIATELY FOLLOWING generation, so an e-way bill raised at 23:55 has about
-- 24 hours of life and one raised at 00:05 has about 48. Recomputing "generated_at + n days" gets
-- the second case wrong by a whole day in the DANGEROUS direction — we would tell a driver they are
-- covered while the bill is dead, and mid-transit expiry is the single most common cause of s.129
-- detention. There is deliberately no default, no trigger and no generated expression on this
-- column: the only way a value gets in is by being copied from the portal.
-- ---------------------------------------------------------------
create table if not exists public.eway_bill_records (
  id                uuid primary key default gen_random_uuid(),

  -- NOT unique per booking. A cancelled-and-regenerated bill (§4.5, cancellation is possible for 24
  -- hours) and a D-16 multi-truck consignment both legitimately produce several, and the history
  -- has to survive — "which e-way bill was live when the vehicle was stopped" is the question that
  -- actually gets asked.
  booking_id        uuid not null references public.bookings(id) on delete restrict,

  -- The 12-digit EWB number. Not a uuid, not free text.
  ewb_number        text not null unique check (ewb_number ~ '^[0-9]{12}$'),

  generated_at      timestamptz not null,
  valid_upto        timestamptz not null,
  constraint eway_bill_valid_upto_after_generation check (valid_upto > generated_at),

  issuing_portal    public.ewb_portal not null,

  -- 🔴 Rule 138(5A), the one-way door: once the transporter has entered Part B, the consignor or
  -- recipient may NOT assign the e-way bill to another transporter. Recording the timestamp is what
  -- lets the booking flow refuse a carrier swap after this point instead of desyncing the platform
  -- from the EWB system permanently. Nothing reads it yet — the block lands with the reassignment
  -- work (§9.4) — but the fact has to be captured at the moment it becomes true.
  part_b_entered_at timestamptz,

  -- The consignor document number the bill was raised against (NIC error 604: no two e-way bills on
  -- the same document number). Same Rule 46(b) shape as our own invoice numbers.
  document_number   text check (document_number is null or document_number ~ '^[A-Za-z0-9/-]{1,16}$'),
  consignment_value_inr numeric(14,2) check (consignment_value_inr is null or consignment_value_inr >= 0),

  -- D-17: "record + upload". The PDF the user downloaded from the portal.
  document_uri      text,

  recorded_by       uuid references public.users(id) on delete set null,
  recorded_at       timestamptz not null default now()
);

-- The alerting query: live bills sorted by how soon they die. §9.3 replicates the portal's 4-day
-- window as a driver-app push, and this index is what makes that sweep cheap.
create index if not exists eway_bill_records_expiry_idx
  on public.eway_bill_records (valid_upto)
  where part_b_entered_at is not null;

create index if not exists eway_bill_records_booking_idx
  on public.eway_bill_records (booking_id, generated_at desc);

comment on table public.eway_bill_records is
  'Externally generated e-way bills, RECORDED not generated (D-17). valid_upto is copied from the '
  'portal and never recomputed — the midnight rule (section 4.4) makes any local recomputation '
  'wrong by up to a day in the dangerous direction.';

-- ---------------------------------------------------------------
-- (6) indian_financial_year — the 1 April boundary, in IST.
--
-- The timezone is not a detail. The FY rolls over at midnight INDIA time; a document issued at
-- 2026-03-31 23:00 UTC is 2026-04-01 04:30 IST and belongs to FY 2026-27. Computing this off a UTC
-- date puts the first documents of every April into the previous year's series, which is a
-- duplicate number against a series that was already closed.
-- ---------------------------------------------------------------
create or replace function public.indian_financial_year(p_at timestamptz)
returns text
language plpgsql
stable
as $$
declare
  v_local date;
  v_start integer;
begin
  v_local := (p_at at time zone 'Asia/Kolkata')::date;
  v_start := case when extract(month from v_local) >= 4
                  then extract(year from v_local)
                  else extract(year from v_local) - 1
             end;
  -- '2026-27'. The two-digit tail is modulo 100 and zero-padded, so 1999 renders '1999-00' rather
  -- than '1999-0' and the ^[0-9]{4}-[0-9]{2}$ constraint holds at the century boundary.
  return v_start::text || '-' || lpad(((v_start + 1) % 100)::text, 2, '0');
end;
$$;

comment on function public.indian_financial_year(timestamptz) is
  'Indian financial year label (1 April - 31 March) evaluated in Asia/Kolkata, e.g. 2026-27.';

-- ---------------------------------------------------------------
-- (7) allocate_document_number — the gapless allocator.
--
-- Read the note on document_series above for WHY this is a counter row rather than a sequence.
-- This function is never called on its own: it is called from inside issue_lorry_receipt /
-- issue_freight_invoice so that the allocation and the INSERT of the document share one
-- transaction. Calling it standalone would allocate a number with nothing to attach it to, and if
-- that transaction then committed, THAT is how you get a gap.
-- ---------------------------------------------------------------
create or replace function public.allocate_document_number(
  p_series_kind    public.document_series_kind,
  p_issuer_kind    public.document_issuer_kind,
  p_issuer_id      uuid,
  p_financial_year text,
  p_prefix         text default null
)
returns text
language plpgsql
volatile
as $$
declare
  v_serial bigint;
  v_prefix text;
  v_number text;
begin
  -- Create the counter for this (kind, issuer, year) if this is the first document of the year.
  -- ON CONFLICT DO NOTHING rather than a select-then-insert: under a concurrent first issue, this
  -- statement waits for the other transaction to resolve and then does nothing, so exactly one row
  -- exists afterwards either way. A select-then-insert would race into a unique violation here.
  insert into public.document_series (series_kind, issuer_kind, issuer_id, financial_year, prefix)
  values (p_series_kind, p_issuer_kind, p_issuer_id, p_financial_year, p_prefix)
  on conflict on constraint document_series_scope_key do nothing;

  -- THE serialisation point. The row-level lock this UPDATE takes is held until this transaction
  -- commits or aborts, so a concurrent allocation for the SAME owner blocks here and then reads the
  -- incremented value; an allocation for a DIFFERENT owner touches a different row and is unaffected.
  -- RETURNING sees post-update values, so `next_number - 1` is the serial just handed out.
  --
  -- Note the prefix comes from the STORED row, not from p_prefix: the format of a series in flight
  -- is frozen at its first document. Passing a different prefix later is ignored rather than
  -- silently splitting one year's numbering into two shapes.
  update public.document_series
     set next_number    = next_number + 1,
         last_issued_at = now()
   where series_kind    = p_series_kind
     and issuer_kind    = p_issuer_kind
     and issuer_id      = p_issuer_id
     and financial_year = p_financial_year
  returning next_number - 1, prefix into v_serial, v_prefix;

  if v_serial is null then
    -- Unreachable while the insert above is in place. If it ever happens, failing is the only safe
    -- move: issuing a document with no counter behind it means the next one collides with it.
    raise exception 'No document series for % / % / % / %',
      p_series_kind, p_issuer_kind, p_issuer_id, p_financial_year
      using errcode = 'internal_error';
  end if;

  v_number := coalesce(v_prefix || '/', '') || p_financial_year || '/' || v_serial::text;

  -- Rule 46(b), enforced before the number can reach a document. This can only trigger when a long
  -- prefix meets a high serial, which is a threshold known years in advance; the failure aborts the
  -- whole transaction, so the increment rolls back and NO number is burnt — the series simply
  -- refuses to advance until the owner's prefix is shortened. Loud and recoverable beats a document
  -- that an assessing officer rejects.
  if v_number !~ '^[A-Za-z0-9/-]{1,16}$' then
    raise exception 'Document number % violates Rule 46(b) (max 16 chars, [A-Za-z0-9/-] only)', v_number
      using errcode = 'check_violation';
  end if;

  return v_number;
end;
$$;

comment on function public.allocate_document_number(public.document_series_kind, public.document_issuer_kind, uuid, text, text) is
  'Allocates the next gapless serial for one owner and financial year. MUST be called inside the '
  'same transaction that persists the document row — see the note on document_series.';

-- ---------------------------------------------------------------
-- (8) issue_lorry_receipt — allocate + persist, one transaction.
--
-- A PostgREST rpc call is one statement in one implicit transaction, which is what makes this the
-- transaction boundary the numbering rules require. The service side has no way to allocate a
-- number without also writing the row, and no way to write a row without allocating through the
-- counter — that is the point of putting this in the database rather than in Node, where supabase-js
-- has no transactions at all and a read-then-write would race.
--
-- Payload comes in as jsonb to keep the signature stable as the field set grows; the callable
-- surface is validated by zod in bt-booking-service before it gets here.
-- ---------------------------------------------------------------
create or replace function public.issue_lorry_receipt(
  p_booking_id  uuid,
  p_issuer_kind public.document_issuer_kind,
  p_issuer_id   uuid,
  p_prefix      text,
  p_payload     jsonb
)
returns public.lorry_receipts
language plpgsql
volatile
as $$
declare
  v_row      public.lorry_receipts;
  v_existing public.lorry_receipts;
  v_fy       text;
  v_number   text;
begin
  -- Already issued? Return it untouched. A document is never renumbered and never reissued with
  -- different contents — a retried request, a double-tapped button and a saga replay all have to
  -- converge on the ONE document the consignee is holding.
  select * into v_existing from public.lorry_receipts where booking_id = p_booking_id;
  if found then
    return v_existing;
  end if;

  v_fy     := public.indian_financial_year(now());
  v_number := public.allocate_document_number('lr', p_issuer_kind, p_issuer_id, v_fy, p_prefix);

  insert into public.lorry_receipts (
    booking_id, lr_number, series_id, financial_year,
    issuer_kind, issuer_id, issuer_legal_name, issuer_transporter_id, issuer_pan, issuer_address,
    consignor_name, consignor_gstin, consignor_pan, consignor_address,
    consignee_name, consignee_gstin, consignee_address,
    origin_place, destination_place, delivery_address,
    vehicle_number, articles_count,
    actual_weight_kg, charged_weight_kg, rate_inr, rate_type, said_to_contain, sac_code,
    freight_charge_inr, stationary_charge_inr, handling_charge_inr, other_charge_inr,
    freight_term, delivery_mode, loading_by, unloading_by,
    place_of_supply_state, place_of_supply_code, reverse_charge, carriage_risk,
    invoice_number, invoice_value_inr, eway_bill_number
  )
  select
    p_booking_id, v_number, s.id, v_fy,
    p_issuer_kind, p_issuer_id,
    p_payload ->> 'issuer_legal_name',
    p_payload ->> 'issuer_transporter_id',
    p_payload ->> 'issuer_pan',
    p_payload ->> 'issuer_address',
    p_payload ->> 'consignor_name',
    p_payload ->> 'consignor_gstin',
    p_payload ->> 'consignor_pan',
    p_payload ->> 'consignor_address',
    p_payload ->> 'consignee_name',
    p_payload ->> 'consignee_gstin',
    p_payload ->> 'consignee_address',
    p_payload ->> 'origin_place',
    p_payload ->> 'destination_place',
    p_payload ->> 'delivery_address',
    p_payload ->> 'vehicle_number',
    (p_payload ->> 'articles_count')::integer,
    (p_payload ->> 'actual_weight_kg')::numeric,
    (p_payload ->> 'charged_weight_kg')::numeric,
    (p_payload ->> 'rate_inr')::numeric,
    p_payload ->> 'rate_type',
    p_payload ->> 'said_to_contain',
    coalesce(p_payload ->> 'sac_code', '996511'),
    coalesce((p_payload ->> 'freight_charge_inr')::numeric,    0),
    coalesce((p_payload ->> 'stationary_charge_inr')::numeric, 0),
    coalesce((p_payload ->> 'handling_charge_inr')::numeric,   0),
    coalesce((p_payload ->> 'other_charge_inr')::numeric,      0),
    (p_payload ->> 'freight_term')::public.freight_term,
    (p_payload ->> 'delivery_mode')::public.delivery_mode,
    p_payload ->> 'loading_by',
    p_payload ->> 'unloading_by',
    p_payload ->> 'place_of_supply_state',
    p_payload ->> 'place_of_supply_code',
    coalesce((p_payload ->> 'reverse_charge')::boolean, true),
    coalesce(p_payload ->> 'carriage_risk', 'owners_risk'),
    p_payload ->> 'invoice_number',
    (p_payload ->> 'invoice_value_inr')::numeric,
    p_payload ->> 'eway_bill_number'
  from public.document_series s
  where s.series_kind    = 'lr'
    and s.issuer_kind    = p_issuer_kind
    and s.issuer_id      = p_issuer_id
    and s.financial_year = v_fy
  returning * into v_row;

  -- The INSERT ... SELECT writes nothing if the series row is missing, which would silently return
  -- a null row and lose the allocated number. It cannot happen (the allocator just wrote that row in
  -- this transaction), so if it does, the series table has been tampered with mid-transaction and
  -- aborting is the only answer that keeps the numbering trustworthy.
  if v_row.id is null then
    raise exception 'Lorry receipt insert wrote no row for booking % (series % / %)',
      p_booking_id, p_issuer_kind, v_fy
      using errcode = 'internal_error';
  end if;

  return v_row;

-- The concurrent-first-issue case: two requests for the same booking, both past the existence check
-- above, both allocating, one losing on lorry_receipts.booking_id. Handling it HERE matters —
-- catching the exception rolls this plpgsql block's implicit subtransaction back, and the loser's
-- counter increment goes with it, so the number it allocated is handed to the next caller instead of
-- vanishing. The loser then returns the winner's document, which is what the client wanted anyway.
exception
  when unique_violation then
    select * into v_existing from public.lorry_receipts where booking_id = p_booking_id;
    if found then
      return v_existing;
    end if;
    raise;
end;
$$;

comment on function public.issue_lorry_receipt(uuid, public.document_issuer_kind, uuid, text, jsonb) is
  'Allocates an LR number and persists the consignment note in ONE transaction. Idempotent per '
  'booking: an already-issued LR is returned unchanged, never renumbered.';

-- ---------------------------------------------------------------
-- (9) issue_freight_invoice — the same contract, on the shipper's own series.
-- ---------------------------------------------------------------
create or replace function public.issue_freight_invoice(
  p_booking_id       uuid,
  p_supplier_user_id uuid,
  p_prefix           text,
  p_payload          jsonb
)
returns public.freight_invoices
language plpgsql
volatile
as $$
declare
  v_row      public.freight_invoices;
  v_existing public.freight_invoices;
  v_fy       text;
  v_number   text;
begin
  select * into v_existing from public.freight_invoices where booking_id = p_booking_id;
  if found then
    return v_existing;
  end if;

  v_fy     := public.indian_financial_year(now());
  -- 'shipper' as the issuer kind, NOT 'fleet_owner'. The two series are independent by design: the
  -- carrier's LR count and the shipper's invoice count have nothing to do with each other, and
  -- sharing a counter would make one party's document volume visible in the other's numbering.
  v_number := public.allocate_document_number('invoice', 'shipper', p_supplier_user_id, v_fy, p_prefix);

  insert into public.freight_invoices (
    booking_id, invoice_number, series_id, financial_year,
    supplier_user_id, supplier_legal_name, supplier_gstin, supplier_address,
    billed_to_name, billed_to_gstin, billed_to_address, billed_to_state, billed_to_state_code,
    shipped_to_name, shipped_to_gstin, shipped_to_address, shipped_to_state, shipped_to_state_code,
    place_of_supply_state, place_of_supply_code, reverse_charge,
    taxable_value_inr, cgst_inr, sgst_inr, utgst_inr, igst_inr, cess_inr, exempt_value_inr,
    tcs_inr, round_off_inr, grand_total_inr,
    lr_number, eway_bill_number, irn, ack_no, ack_date
  )
  select
    p_booking_id, v_number, s.id, v_fy,
    p_supplier_user_id,
    p_payload ->> 'supplier_legal_name',
    p_payload ->> 'supplier_gstin',
    p_payload ->> 'supplier_address',
    p_payload ->> 'billed_to_name',
    p_payload ->> 'billed_to_gstin',
    p_payload ->> 'billed_to_address',
    p_payload ->> 'billed_to_state',
    p_payload ->> 'billed_to_state_code',
    p_payload ->> 'shipped_to_name',
    p_payload ->> 'shipped_to_gstin',
    p_payload ->> 'shipped_to_address',
    p_payload ->> 'shipped_to_state',
    p_payload ->> 'shipped_to_state_code',
    p_payload ->> 'place_of_supply_state',
    p_payload ->> 'place_of_supply_code',
    coalesce((p_payload ->> 'reverse_charge')::boolean, false),
    (p_payload ->> 'taxable_value_inr')::numeric,
    coalesce((p_payload ->> 'cgst_inr')::numeric,         0),
    coalesce((p_payload ->> 'sgst_inr')::numeric,         0),
    coalesce((p_payload ->> 'utgst_inr')::numeric,        0),
    coalesce((p_payload ->> 'igst_inr')::numeric,         0),
    coalesce((p_payload ->> 'cess_inr')::numeric,         0),
    coalesce((p_payload ->> 'exempt_value_inr')::numeric, 0),
    coalesce((p_payload ->> 'tcs_inr')::numeric,          0),
    coalesce((p_payload ->> 'round_off_inr')::numeric,    0),
    (p_payload ->> 'grand_total_inr')::numeric,
    p_payload ->> 'lr_number',
    p_payload ->> 'eway_bill_number',
    p_payload ->> 'irn',
    p_payload ->> 'ack_no',
    (p_payload ->> 'ack_date')::timestamptz
  from public.document_series s
  where s.series_kind    = 'invoice'
    and s.issuer_kind    = 'shipper'
    and s.issuer_id      = p_supplier_user_id
    and s.financial_year = v_fy
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Freight invoice insert wrote no row for booking % (series shipper / %)',
      p_booking_id, v_fy
      using errcode = 'internal_error';
  end if;

  return v_row;

exception
  when unique_violation then
    select * into v_existing from public.freight_invoices where booking_id = p_booking_id;
    if found then
      return v_existing;
    end if;
    raise;
end;
$$;

comment on function public.issue_freight_invoice(uuid, uuid, text, jsonb) is
  'Allocates an invoice number on the SHIPPER''s own per-FY series and persists the tax invoice in '
  'ONE transaction. Idempotent per booking.';

-- ---------------------------------------------------------------
-- (10) RLS + grants — service-role only, matching notification_outbox (migration 021).
--
-- No public policies: every read and write goes through a service holding the service-role key.
--
-- The functions matter more than the tables here, because they MINT LEGAL DOCUMENTS and a
-- browser-side key must never reach them. Postgres grants EXECUTE to PUBLIC on every new function,
-- and anon/authenticated are members of PUBLIC — so revoking from those two roles by name achieves
-- NOTHING while the PUBLIC grant survives. The revoke has to name PUBLIC, and the grant back to
-- service_role has to follow it or the service loses the ability to issue anything.
-- ---------------------------------------------------------------
alter table public.document_series    enable row level security;
alter table public.lorry_receipts     enable row level security;
alter table public.freight_invoices   enable row level security;
alter table public.eway_bill_records  enable row level security;

revoke execute on function
  public.allocate_document_number(public.document_series_kind, public.document_issuer_kind, uuid, text, text),
  public.issue_lorry_receipt(uuid, public.document_issuer_kind, uuid, text, jsonb),
  public.issue_freight_invoice(uuid, uuid, text, jsonb)
from public;

-- Hand it straight back to the one role that is supposed to have it. Guarded because a local or
-- CI Postgres has no Supabase roles, and there the function owner already holds EXECUTE.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function
      public.allocate_document_number(public.document_series_kind, public.document_issuer_kind, uuid, text, text),
      public.issue_lorry_receipt(uuid, public.document_issuer_kind, uuid, text, jsonb),
      public.issue_freight_invoice(uuid, uuid, text, jsonb)
    to service_role;
  end if;
end $$;
