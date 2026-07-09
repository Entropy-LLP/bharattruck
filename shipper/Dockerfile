# shipper PWA — Next.js 16 standalone container for Cloud Run.
# NEXT_PUBLIC_* are public (inlined into client JS) so they are baked at build time.
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Public build-time config (gateway root; app appends /api). Maps browser key is referrer-restricted.
ENV NEXT_PUBLIC_API_URL=https://bt-gateway-itcdoenefa-el.a.run.app
ENV NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY=AIzaSyCxNs_ks8T_V2r_YDeTtvL53fBSWMChzYw
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 8080
CMD ["node", "server.js"]
