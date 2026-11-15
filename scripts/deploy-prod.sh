#!/usr/bin/env bash
# ContactHub production bring-up / troubleshooting helper.
#
#   bash scripts/deploy-prod.sh check    # diagnose without changing anything
#   bash scripts/deploy-prod.sh fix     # apply the safe, idempotent fixes
#
# `fix` only ever:
#   - creates .env from .env.example if missing
#   - ensures APP_HOST_PORT / POSTGRES_HOST_PORT are set to sane values
#   - starts the app + db containers
# It NEVER deletes volumes, never touches the database, and never changes a
# password.

set -uo pipefail

MODE="${1:-check}"
cd "$(dirname "$0")/.." || exit 1

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; OFF=$'\033[0m'

ok()   { printf '%s  OK   %s %s\n' "$GREEN" "$*" "$OFF"; }
bad()  { printf '%s  FAIL %s %s\n' "$RED" "$*" "$OFF"; }
warn() { printf '%s  WARN %s %s\n' "$YELLOW" "$*" "$OFF"; }
info() { printf '%s  ..   %s %s\n' "" "$*" "$OFF"; }

echo "${BOLD}ContactHub production helper — mode: $MODE${OFF}"
echo

# --------------------------------------------------------------------------
# 1. Docker access
# --------------------------------------------------------------------------
DOCKER_OK=0
if docker info >/dev/null 2>&1; then
  DOCKER_OK=1
  ok "Docker daemon reachable"
else
  bad "Cannot access the Docker daemon as '$(id -un)'"
  echo
  echo "  ${BOLD}This is the root cause of a failed 'docker compose up -d'.${OFF}"
  echo "  Fix it (needs sudo):"
  echo
  echo "      sudo usermod -aG docker \"\$(id -un)\""
  echo
  echo "  ${BOLD}Then log out and SSH back in.${OFF} 'newgrp docker' alone is not"
  echo "  enough — your current shell keeps the old group list."
  echo
  echo "  If you do not have sudo, ask the server admin to run the usermod."
  echo
fi

# --------------------------------------------------------------------------
# 2. .env
# --------------------------------------------------------------------------
if [ -f .env ]; then
  ok ".env exists"
else
  bad ".env is MISSING"
  if [ "$MODE" = "fix" ]; then
    cp .env.example .env && ok "Created .env from .env.example"
  else
    echo "      fix: cp .env.example .env"
  fi
fi

APP_PORT=""
DB_PORT=""
if [ -f .env ]; then
  APP_PORT=$(grep -E '^APP_HOST_PORT=' .env | cut -d= -f2 | tr -d '"' | tr -d "'")
  DB_PORT=$(grep -E '^POSTGRES_HOST_PORT=' .env | cut -d= -f2 | tr -d '"' | tr -d "'")
fi
APP_PORT="${APP_PORT:-8090}"
DB_PORT="${DB_PORT:-5432}"
info "APP_HOST_PORT=${APP_PORT}  POSTGRES_HOST_PORT=${DB_PORT}"

# --------------------------------------------------------------------------
# 3. Port availability on the host
# --------------------------------------------------------------------------
for p in "$APP_PORT" "$DB_PORT"; do
  if command -v ss >/dev/null 2>&1 && ss -tln 2>/dev/null | grep -qE "[:.]$p[[:space:]]"; then
    warn "Host port $p is already in use"
  else
    ok "Host port $p is free"
  fi
done

# --------------------------------------------------------------------------
# 4. Are the containers up?
# --------------------------------------------------------------------------
if [ "$DOCKER_OK" -eq 1 ]; then
  if docker compose ps --status running --services 2>/dev/null | grep -q '^app$'; then
    ok "app container is running"
  else
    bad "app container is NOT running"
  fi
  if docker compose ps --status running --services 2>/dev/null | grep -q '^db$'; then
    ok "db container is running"
  else
    bad "db container is NOT running"
  fi

  # Show what port the app is actually published on.
  PUBLISHED=$(docker compose port app 8090 2>/dev/null | head -1)
  info "app published on: ${PUBLISHED:-<not published>}"
  if [ -n "$PUBLISHED" ] && [ "${PUBLISHED##*:}" != "$APP_PORT" ]; then
    warn "Published port (${PUBLISHED##*:}) differs from APP_HOST_PORT (${APP_PORT})"
  fi
fi

# --------------------------------------------------------------------------
# 5. HTTP probe
# --------------------------------------------------------------------------
CODE=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://localhost:${APP_PORT}/api/v1/health" 2>/dev/null)
if [ "$CODE" = "200" ]; then
  ok "http://localhost:${APP_PORT}/api/v1/health -> 200"
else
  bad "http://localhost:${APP_PORT}/api/v1/health -> ${CODE} (000 = nothing listening)"

  # Scan common ports for the app — it may be published elsewhere.
  FOUND=""
  for p in 8090 8123 8080 3000 80 443 8091; do
    c=$(curl -s -o /dev/null -m 2 -w '%{http_code}' "http://localhost:${p}/api/v1/health" 2>/dev/null)
    if [ "$c" = "200" ]; then FOUND="$p"; break; fi
  done
  if [ -n "$FOUND" ]; then
    warn "The app IS answering on port ${FOUND} — use http://<server-ip>:${FOUND}"
    info "Set APP_HOST_PORT=${FOUND} in .env to make it match, then redeploy."
  else
    info "The app is not answering on any common port."
    echo "      ${BOLD}The containers are probably not running.${OFF}"
    echo "      Run: docker compose up -d --build   (as a user with Docker access)"
    echo "      Then: docker compose logs app"
  fi
fi

# --------------------------------------------------------------------------
# 6. Apply fixes
# --------------------------------------------------------------------------
if [ "$MODE" = "fix" ]; then
  echo
  echo "${BOLD}Applying fixes${OFF}"
  if [ "$DOCKER_OK" -eq 1 ]; then
    docker compose up -d --build 2>&1 | tail -15
    echo
    sleep 10
    docker compose ps 2>&1
  else
    echo "  Skipped 'docker compose up' — no Docker access."
    echo "  Fix the Docker group first (see above), then re-run: bash scripts/deploy-prod.sh fix"
  fi
fi

echo
echo "${BOLD}Done.${OFF}"
