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
FROM node:20-alpine AS deps
WORKDIR /app
# bcrypt requires native compilation
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Stage 2: development (hot-reload via tsx watch) ───────────────────────────
FROM node:20-alpine AS development
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
EXPOSE 3001
ENV NODE_ENV=development
CMD ["node_modules/.bin/tsx", "watch", "src/index.ts"]

# ── Stage 3: TypeScript compiler ──────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

# ── Stage 4: lean production image ────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app
COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/dist         ./dist
COPY package.json ./
COPY public ./public
EXPOSE 3001
ENV NODE_ENV=production
USER node
CMD ["node", "dist/index.js"]
