# ============================================================
# ORWA Booking — egyesített backend image (lásd SPEC.md).
# better-sqlite3 natív modul → a slim image-hez kell a fordító-eszközkészlet
# (a naptár Dockerfile mintájára). Multi-stage: build deps → karcsú runtime.
#
#   docker build -t orwa-booking .
# ============================================================

# ── Base: függőségek (a better-sqlite3 itt fordul a cél-platformra) ───────────
FROM node:24-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# ── Prod: karcsú runtime ─────────────────────────────────────────────────────
FROM node:24-slim AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY --from=base /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
# /data: az orwa.db (+WAL) perzisztens volume-on él (bookings + quote_requests táblák).
VOLUME ["/data"]
EXPOSE 8000
CMD ["node", "server/index.js"]
