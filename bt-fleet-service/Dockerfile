# =============================================================================
#  bt-fleet-service — Multi-stage Dockerfile
#  Port: 3007
# =============================================================================

# BUILD CONTEXT IS THE REPO ROOT (docker build -f bt-fleet-service/Dockerfile .), so every COPY
# source below is repo-relative. CD builds all services this way via cloudbuild.yaml —
# uniform with bt-booking-service/bt-tracking-service, which REQUIRE a root context to
# resolve their `file:../packages/shared` dependency.

FROM node:20-alpine AS deps
WORKDIR /app
COPY bt-fleet-service/package.json bt-fleet-service/package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS development
WORKDIR /app
COPY bt-fleet-service/package.json bt-fleet-service/package-lock.json ./
RUN npm ci
COPY bt-fleet-service/tsconfig.json ./
COPY bt-fleet-service/src ./src
EXPOSE 3007
ENV NODE_ENV=development
CMD ["node_modules/.bin/tsx", "watch", "src/index.ts"]

FROM node:20-alpine AS builder
WORKDIR /app
COPY bt-fleet-service/package.json bt-fleet-service/package-lock.json bt-fleet-service/tsconfig.json ./
RUN npm ci
COPY bt-fleet-service/src ./src
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/dist         ./dist
COPY bt-fleet-service/package.json ./
EXPOSE 3007
ENV NODE_ENV=production
USER node
CMD ["node", "dist/index.js"]
