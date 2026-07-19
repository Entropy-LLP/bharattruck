# bt-ops-web — Next.js 14 standalone container for Cloud Run.
# Ops console does NOT render a Google Map, so only NEXT_PUBLIC_API_URL is baked at build time.
# CI (.github/workflows/deploy.yml) passes it via `docker build --build-arg` from a GitHub repo var.
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# --- Build-time public config (declared AFTER npm ci so the deps layer stays cacheable) ---
# API_URL keeps a sane default (the prod gateway) so a bare `docker build` still works.
ARG NEXT_PUBLIC_API_URL=https://bt-gateway-itcdoenefa-el.a.run.app
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 8080
CMD ["node", "server.js"]
