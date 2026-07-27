# =============================================================================
#  bt-auth-service — Multi-stage Dockerfile
#  Port: 3001
#
#  Stages:
#    deps        — production node_modules only (layer-cache optimised)
#    development — all deps + tsx watch (used by docker-compose)
#    builder     — compiles TypeScript to dist/
#    production  — lean runtime image (node dist/index.js)
#
#  docker-compose uses: target: development
#  CI/CD should build: target: production
# =============================================================================

# ── Stage 1: production deps ──────────────────────────────────────────────────
# BUILD CONTEXT IS THE REPO ROOT (docker build -f bt-auth-service/Dockerfile .), so every COPY
# source below is repo-relative. CD builds all services this way via cloudbuild.yaml —
# uniform with bt-booking-service/bt-tracking-service, which REQUIRE a root context to
# resolve their `file:../packages/shared` dependency.

FROM node:20-alpine AS deps
WORKDIR /app
# bcrypt requires native compilation
RUN apk add --no-cache python3 make g++
COPY bt-auth-service/package.json bt-auth-service/package-lock.json ./
RUN npm ci --omit=dev

# ── Stage 2: development (hot-reload via tsx watch) ───────────────────────────
FROM node:20-alpine AS development
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY bt-auth-service/package.json bt-auth-service/package-lock.json ./
RUN npm ci
COPY bt-auth-service/tsconfig.json ./
COPY bt-auth-service/src ./src
EXPOSE 3001
ENV NODE_ENV=development
CMD ["node_modules/.bin/tsx", "watch", "src/index.ts"]

# ── Stage 3: TypeScript compiler ──────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY bt-auth-service/package.json bt-auth-service/package-lock.json bt-auth-service/tsconfig.json ./
RUN npm ci
COPY bt-auth-service/src ./src
RUN npm run build

# ── Stage 4: lean production image ────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app
COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/dist         ./dist
COPY bt-auth-service/package.json ./
COPY bt-auth-service/public ./public
EXPOSE 3001
ENV NODE_ENV=production
USER node
CMD ["node", "dist/index.js"]
