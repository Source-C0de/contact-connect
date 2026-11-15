# syntax=docker/dockerfile:1.7
# ContactHub On-Call Responder Agent
#
# Deliberately dependency-free: the agent only needs the Node standard
# library, so the image is tiny and has no supply-chain surface.
FROM node:24.22.1-alpine

ENV NODE_ENV=production \
    ONCALL_PORT=8080 \
    ONCALL_HOST=0.0.0.0 \
    ONCALL_DRY_RUN=true

WORKDIR /app

# The agent needs the docker CLI + compose plugin to restart containers.
# It also needs the compose file to know which project to act on.
RUN apk add --no-cache docker-cli docker-cli-compose

COPY --chown=node:node oncall-agent/agent.js ./agent.js
COPY --chown=node:node docker-compose.yml ./docker-compose.yml

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.ONCALL_PORT+'/health') \
    .then(r => process.exit(r.ok ? 0 : 1)) \
    .catch(() => process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "agent.js"]
