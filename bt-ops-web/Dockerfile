# =============================================================================
#  bt-ops-web — Multi-stage Dockerfile  (Next.js 14)
#  Port: 3000
#
#  IMPORTANT for production stage:
#    Add `output: 'standalone'` to next.config.js before building production.
#    Without it, the production stage will not have a server.js to run.
#    The development stage works without this change.
# =============================================================================

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS development
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 3000
ENV NODE_ENV=development
ENV PORT=3000
CMD ["npm", "run", "dev"]

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Requires output: 'standalone' in next.config.js
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static     ./.next/static
COPY --from=builder /app/public           ./public
EXPOSE 3000
USER node
CMD ["node", "server.js"]
