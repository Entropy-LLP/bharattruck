-- migration 013: price quote-lock (feat/pricing-quote-lock)
-- The price SHOWN at quote time is the price CHARGED at booking (PRD 5.4).
-- Written by bt-pricing-service (service-role). NEW table 'price_quotes' — the
-- shipper price-lock. NOT 'quotes' (that is the driver-auction bid table).
-- Forward-only; APPLY gated on live-Supabase access.

create table if not exists public.price_quotes (
  id                     uuid primary key default gen_random_uuid(),
  shipper_id             uuid not null references public.users(id),
  distance_km            numeric(10,2) not null check (distance_km > 0),
  vehicle_type           text not null,
  vehicle_class          text not null,
  load_type              text not null,
  weight_kg              numeric(12,2) not null check (weight_kg > 0),
  breakdown_json         jsonb not null,
  quoted_price           numeric(12,2) not null check (quoted_price > 0),
  currency               text not null default 'INR',
  expires_at             timestamptz not null,
  consumed_by_booking_id uuid references public.bookings(id) on delete set null,
  created_at             timestamptz not null default now()
);

create index if not exists price_quotes_shipper_idx on public.price_quotes (shipper_id);

comment on table public.price_quotes is
  'Shipper price-lock: quote SHOWN == price CHARGED (PRD 5.4). Written by bt-pricing-service. consumed_by_booking_id set once when a booking locks this quote (replay guard). NOT the driver-auction quotes table.';

-- RLS: service-role only (pricing/booking use service-role); no public policies (all authz is app-code — locked decision).
alter table public.price_quotes enable row level security;
