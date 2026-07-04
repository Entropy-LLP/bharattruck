# bt-driver-app

Driver-facing web dashboard for **BharatTruck** — an Indian B2B freight booking platform.

Built with **Next.js 16**, **React 19**, **TypeScript 5**, and **Tailwind CSS 4**.

## Features

- **Multi-method authentication** — Phone OTP, email/password, Google OAuth, magic link
- **Available bookings** — Browse and bid on open freight bookings
- **Quote management** — Submit quotes, counter-offer, view negotiation history
- **Trip lifecycle** — Start trip, push GPS location, complete delivery
- **Driver profile** — View and manage profile information
- **Session persistence** — Automatic token refresh on expiry, no unnecessary logouts

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

Create a `.env.local` file:

```env
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-google-client-id
```

`NEXT_PUBLIC_API_URL` points to the [bt-gateway](https://github.com/deltaos1997/bt-gateway) reverse proxy, which routes requests to the appropriate backend microservice.

## Project Structure

```
src/
├── app/
│   ├── (app)/
│   │   ├── available/     # Browse open bookings
│   │   ├── bookings/[id]/ # Booking detail + quote
│   │   ├── my-quotes/     # Submitted quotes
│   │   └── profile/       # Driver profile
│   ├── auth/callback/     # OAuth callback handler
│   └── login/             # Multi-method auth
├── components/
│   ├── app-shell.tsx      # Authenticated layout + nav
│   └── spinner.tsx
└── lib/
    ├── api.ts             # API client with token refresh
    ├── auth.tsx           # Auth context provider
    ├── status.ts          # Booking status helpers
    ├── types.ts           # TypeScript types
    └── utils.ts           # Shared utilities
```

## Related Services

| Service | Repo | Purpose |
|---------|------|---------|
| API Gateway | [bt-gateway](https://github.com/deltaos1997/bt-gateway) | Nginx reverse proxy |
| Auth | [bt-auth-service](https://github.com/deltaos1997/bt-auth-service) | OTP, JWT, Google OAuth |
| Bookings | [bt-booking-service](https://github.com/deltaos1997/bt-booking-service) | Booking lifecycle, GPS |
| Pricing | [bt-pricing-service](https://github.com/deltaos1997/bt-pricing-service) | Fare engine |
| Payments | [bt-payment-service](https://github.com/deltaos1997/bt-payment-service) | Razorpay escrow |

## Deployment

Deployed on **Vercel**. Push to `main` to trigger a production deploy.
