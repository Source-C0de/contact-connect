# syntax=docker/dockerfile:1.7
# ---------- Stage 1: build the React app + install server deps ----------
FROM node:24.22.1-alpine AS builder


WORKDIR /app

# Install root deps (devDependencies are needed for `vite build`).
# Use `npm ci` for reproducible installs; falls back to `npm install`
# if package-lock.json is missing in the build context.
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Install server (production-only) deps into a separate tree we can copy.
COPY server/package.json server/package-lock.json* ./server/
RUN if [ -f server/package-lock.json ]; then \
      npm --prefix server ci --omit=dev; \
    else \
      npm --prefix server install --omit=dev; \
    fi

# Copy the rest of the source and build the SPA.
COPY . .
RUN npm run build

# ---------- Stage 2: minimal runtime image ----------
FROM node:24.22.1-alpine AS runner

ENV NODE_ENV=production \
    PORT=8090 \
    HOST=0.0.0.0 \
    DATA_FILE=/data/data.json \
    # In Docker the app connects to the `db` service via DATABASE_URL
    # (set in docker-compose.yml). The default below is only used when
    # running `node server/index.js` outside of Compose for debugging.
    DATABASE_URL=postgres://contacthub:contacthub@localhost:5432/contacthub

WORKDIR /app

# Run as the unprivileged `node` user that ships with the alpine base image.
RUN apk add --no-cache tini && \
    chown -R node:node /app

COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/server ./server

# /data is where the named volume will mount. Pre-create it so the runtime
# never has to deal with a missing parent directory on first boot.
RUN mkdir -p /data && chown -R node:node /data

USER node

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/v1/health') \
    .then(r => process.exit(r.ok ? 0 : 1)) \
    .catch(() => process.exit(1))"

# tini reaps zombies and forwards signals; the Node process is PID 1's child.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/index.js"]