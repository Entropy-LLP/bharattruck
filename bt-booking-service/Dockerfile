# =============================================================================
#  bt-booking-service — Multi-stage Dockerfile
#  Port: 3002
# =============================================================================

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS development
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
EXPOSE 3002
ENV NODE_ENV=development
CMD ["node_modules/.bin/tsx", "watch", "src/index.ts"]

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/dist         ./dist
COPY package.json ./
EXPOSE 3002
ENV NODE_ENV=production
USER node
CMD ["node", "dist/index.js"]
