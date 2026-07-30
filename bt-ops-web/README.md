# bt-ops-web

Internal operations dashboard and fleet owner portal for BharatTruck. Built with Next.js 14 App Router, it gives the ops team a real-time view of trips, KYC approvals, and platform health — and gives fleet owners a self-service view of their vehicles, drivers, and earnings.

**Port:** `3000`  
**Stack:** Next.js 14 · React 18 · TypeScript · Tailwind CSS v4 · lucide-react · next-themes

---

## Quickstart

```bash
cp .env.example .env        # set backend service URLs
npm install
npm run dev                 # Next.js dev server on :3000
```

Or from the repo root:

```bash
./bt start admin            # foreground
make restart-admin          # background restart
```

Open `http://localhost:3000` — it redirects to `/login`.

---

## Environment Variables

These are server-side URLs (not exposed to the browser). Used in server components and API routes to proxy requests to backend services.

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_SERVICE_URL` | `http://localhost:3001` | bt-auth-service |
| `BOOKING_SERVICE_URL` | `http://localhost:3002` | bt-booking-service |
| `PRICING_SERVICE_URL` | `http://localhost:3003` | bt-pricing-service |
| `PAYMENT_SERVICE_URL` | `http://localhost:3004` | bt-payment-service |
| `CARGO_LEDGER_URL` | `http://localhost:3005` | bt-cargo-ledger |
| `NEXT_PUBLIC_APP_ENV` | `development` | Exposed to browser — controls env indicators |

---

## Pages

### Ops Console (`/ops/*`)
For the internal BharatTruck operations team.

| Route | Page | Description |
|-------|------|-------------|
| `/ops/dashboard` | Dashboard | Platform health — stat cards (active trips, GMV, KYC pending, disputes), recent bookings table, KYC queue widget |
| `/ops/kyc` | KYC Review | Full KYC approval queue — filter by status, view documents, approve/reject per applicant |
| `/ops/trips` | Live Trips | All active trips with real-time progress bars, driver contact, ETA, route, cargo type, and flag controls |
| `/ops/users` | Users | *(planned)* User management — shippers, drivers, fleet owners |
| `/ops/disputes` | Disputes | *(planned)* Open booking disputes |

### Fleet Portal (`/portal/*`)
Self-service dashboard for verified fleet owners (companies with multiple vehicles and drivers).

| Route | Page | Description |
|-------|------|-------------|
| `/portal/dashboard` | Fleet Overview | Fleet stats (vehicles, active drivers, monthly revenue, utilisation %), vehicle table with per-vehicle status/earnings/trips, upcoming document expiry alerts (PUC, DL renewal) |
| `/portal/vehicles` | Vehicles | *(planned)* Add/edit vehicles, view RC and insurance status |
| `/portal/drivers` | Drivers | *(planned)* Driver assignments, performance, KYC status |

---

## Dashboard Metrics

### Ops Console
| Metric | Description |
|--------|-------------|
| Active Trips | Bookings currently `in_transit` |
| Total Users | Cumulative shippers + drivers |
| GMV Today | Gross merchandise value — sum of booking amounts |
| KYC Pending | Applications awaiting ops review |
| Bookings Today | New bookings created today |
| Completion Rate | `delivered / (delivered + cancelled)` |
| Avg Match Time | Time from booking created → driver accepted |
| Open Disputes | Unresolved booking disputes |

### Fleet Portal
| Metric | Description |
|--------|-------------|
| Total Vehicles | Registered vehicles for this fleet |
| Active Drivers | Drivers currently on a trip |
| Revenue (Month) | Sum of driver payouts for current month |
| Utilisation | Active trips / total vehicles |

---

## Component Reference

| Component | File | Description |
|-----------|------|-------------|
| `Sidebar` | `components/sidebar.tsx` | Shared left nav — switches between `ops` and `fleet` role modes |
| `StatCard` | `components/stat-card.tsx` | KPI card with value, subtitle, icon, and optional trend indicator |
| `Badge` | `components/badge.tsx` | Inline status chip — variants: `success`, `warning`, `error`, `info`, `accent`, `muted` |
| `ThemeToggle` | `components/theme-toggle.tsx` | Light/dark mode switch (powered by next-themes) |
| `Providers` | `components/providers.tsx` | Root client provider — wraps `ThemeProvider` |

---

## Project Structure

```
bt-ops-web/
├── app/
│   ├── layout.tsx              # Root layout — font (Space Grotesk), Providers
│   ├── globals.css             # Tailwind base + CSS variables for dark/light tokens
│   ├── page.tsx                # / → redirect to /login
│   ├── login/
│   │   └── page.tsx            # Login page (auth stub — Sprint 4)
│   ├── ops/
│   │   ├── layout.tsx          # Ops layout — Sidebar (role="ops") + main content area
│   │   ├── dashboard/page.tsx  # Ops dashboard
│   │   ├── kyc/page.tsx        # KYC review queue
│   │   └── trips/page.tsx      # Live trips tracker
│   └── portal/
│       ├── layout.tsx          # Fleet layout — Sidebar (role="fleet")
│       └── dashboard/page.tsx  # Fleet owner overview
├── components/
│   ├── providers.tsx           # Client-side theme provider wrapper
│   ├── sidebar.tsx             # Navigation sidebar (ops + fleet modes)
│   ├── stat-card.tsx           # KPI stat card
│   ├── badge.tsx               # Status badge chip
│   └── theme-toggle.tsx        # Dark/light toggle
├── next.config.js
├── tsconfig.json
└── .env.example
```

---

## Scripts

```bash
npm run dev      # Next.js dev server on :3000 (hot reload)
npm run build    # Production build
npm run start    # Run production build locally
```

---

## Design System

- **Font:** Space Grotesk (loaded via `@fontsource/space-grotesk`)
- **Colors:** Orange `#F97316` as primary accent; `#22C55E` success; `#EF4444` error; `#FBBF24` warning
- **Theming:** CSS variable tokens toggled by `next-themes` — dark background `#0A0A0A`, card `#111111`, border `#2A2A2A`; light equivalents use zinc scale
- **Radius:** `rounded-2xl` (16px) for cards, `rounded-xl` (12px) for buttons/inputs, `rounded-lg` (8px) for nav items

---

## Development Notes

- All pages are currently populated with **mock data** — no live API calls yet. Backend integration is planned for Sprint 3–5.
- The KYC approve/reject buttons and the trip "Track" button are UI stubs — actions will call bt-auth-service and bt-booking-service respectively.
- The Live Trips map panel shows a placeholder SVG; **Google Maps integration is Sprint 3**.
- The `Sidebar` component accepts a `role: 'ops' | 'fleet'` prop to switch between the two navigation trees without duplicating layout code.
- Docker production build requires `output: 'standalone'` in `next.config.js` — see the `Dockerfile` comment.
