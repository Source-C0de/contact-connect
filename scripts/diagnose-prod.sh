#!/usr/bin/env bash
# ContactHub production diagnostic.
#
# Run this on the production server and paste the full output back.
#   bash scripts/diagnose-prod.sh
#
# It is read-only: it inspects containers, logs, the database and the HTTP
# endpoints without changing any state.
#
# If the current user cannot talk to the Docker daemon the script still runs:
# every Docker-backed section is skipped and the host-level checks (ports,
# .env, listening sockets, HTTP probes) are reported instead.

set -uo pipefail

APP_PORT="${APP_HOST_PORT:-8090}"
BASE="http://localhost:${APP_PORT}"

hr() { printf '\n=== %s ===\n' "$1"; }

# ---------------------------------------------------------------------------
# Can we talk to the Docker daemon? If not, say so once and skip those parts.
# ---------------------------------------------------------------------------
DOCKER_OK=0
if docker info >/dev/null 2>&1; then
  DOCKER_OK=1
else
  echo "WARNING: cannot access the Docker daemon as user '$(id -un)'."
  echo "         Docker-backed sections will be skipped."
  echo "         Fix with: sudo usermod -aG docker \"$(id -un)\" && (log out and back in)"
  echo
fi

docker_try() {  # run a docker command only when the daemon is reachable
  if [ "$DOCKER_OK" -eq 1 ]; then
    "$@" 2>&1
  else
    echo "(skipped: no Docker access)"
  fi
}

hr "1. Container status"
docker_try docker compose ps -a

hr "2. Recent app logs (last 40)"
docker_try docker compose logs --tail=40 app

hr "3. Bootstrap events"
if [ "$DOCKER_OK" -eq 1 ]; then
  docker compose logs app 2>&1 \
    | grep -iE 'bootstrap\.|admin_seed|session_secret' | tail -20
else
  echo "(skipped: no Docker access)"
fi

hr "4. Auth failures (last 20)"
if [ "$DOCKER_OK" -eq 1 ]; then
  docker compose logs app 2>&1 | grep -iE 'auth\.login_failed' | tail -20
else
  echo "(skipped: no Docker access)"
fi

hr "5. HTTP checks against ${BASE}"
printf 'health      : %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/v1/health" 2>&1)"
printf 'spa root    : %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/" 2>&1)"
printf 'spa deeplink: %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/admin/dashboard" 2>&1)"
printf 'login (admin123): %s\n' \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/v1/auth/login" \
      -H 'Content-Type: application/json' \
      -d '{"email":"admin@corp.com","password":"admin123"}' 2>&1)"
echo "--- verbose probe of /api/v1/health ---"
curl -sv "${BASE}/api/v1/health" 2>&1 | grep -vE '^\{|^\s*$' | tail -12

hr "5b. Which ports are actually listening?"
if command -v ss >/dev/null 2>&1; then
  ss -tlnp 2>/dev/null | grep -E '8090|8123|5432|80 |443 ' || echo "(nothing listening on 8090/8123/5432/80/443)"
  echo "--- all listening ports ---"
  ss -tln 2>/dev/null | head -20
elif command -v netstat >/dev/null 2>&1; then
  netstat -tlnp 2>/dev/null | grep -E '8090|8123|5432' || echo "(nothing listening on 8090/8123/5432)"
else
  echo "(neither ss nor netstat available)"
fi

hr "5c. Are the Docker port-published ports reachable on other ports?"
for p in 8090 8123 8080 3000 80 443; do
  code=$(curl -s -o /dev/null -m 3 -w '%{http_code}' "http://localhost:${p}/api/v1/health" 2>&1)
  [ "$code" != "000" ] && echo "  port ${p} -> HTTP ${code}  <-- app found here"
done
echo "(only ports that answered are listed)"

hr "6. Database - users and password hash format"
docker_try docker compose exec -T db psql -U contacthub -d contacthub -c \
  "SELECT email, role, is_active,
          CASE
            WHEN password_hash LIKE 'pbkdf2\$%' THEN 'pbkdf2 (current)'
            WHEN password_hash LIKE 'sha256\$%' THEN 'legacy salted-sha256'
            WHEN password_hash ~ '^[0-9a-f]{64}\$' THEN 'LEGACY BARE SHA256'
            ELSE 'UNKNOWN FORMAT'
          END AS hash_format,
          left(password_hash, 26) AS hash_prefix
     FROM users;"

hr "7. Database - row counts"
docker_try docker compose exec -T db psql -U contacthub -d contacthub -c \
  "SELECT 'users' AS t, count(*) FROM users
   UNION ALL SELECT 'employees', count(*) FROM employees
   UNION ALL SELECT 'departments', count(*) FROM departments;"

hr "8. Session secret present?"
docker_try docker compose exec -T db psql -U contacthub -d contacthub -c \
  "SELECT key, length(value::text) AS secret_len FROM settings WHERE key='sessionSecret';"

hr "9. Volumes in use"
if [ "$DOCKER_OK" -eq 1 ]; then
  docker volume ls 2>&1 | grep -i contacthub || echo "(no contacthub volumes)"
else
  echo "(skipped: no Docker access)"
  echo "--- postgres data dirs on disk ---"
  ls -ld /var/lib/docker/volumes/*contacthub* 2>/dev/null || echo "(none visible)"
fi

hr "10. Built SPA present and referencing real assets?"
docker_try docker compose exec -T app sh -c \
  "ls -la /app/dist/index.html /app/dist/assets/ 2>&1 | head -10; echo '--- script tags ---'; grep -o '<script[^>]*>' /app/dist/index.html"

hr "11. Is the API URL baked into the bundle?"
docker_try docker compose exec -T app sh -c \
  "grep -o 'location.host[^,;]\{0,60\}' /app/dist/assets/*.js | head -3; echo '--- any absolute API URL? ---'; grep -oh 'https\?://[a-zA-Z0-9./-]*api/v1' /app/dist/assets/*.js | sort -u | head -5"

hr "12. Disk space"
df -h / /var/lib/docker 2>&1 | head -5

hr "13. Project directory and .env"
pwd
ls -la 2>&1 | head -20
echo "--- .env port settings ---"
if [ -f .env ]; then
  grep -E 'APP_HOST_PORT|POSTGRES_HOST_PORT|VITE_API_URL|VITE_API_PORT' .env 2>&1 \
    || echo "(no port/URL entries found in .env)"
else
  echo "!!! .env IS MISSING - docker compose will use its defaults (8090 / 5432)"
fi

hr "14. Image and compose file state"
if [ "$DOCKER_OK" -eq 1 ]; then
  docker images contacthub --format '{{.Repository}} {{.Tag}} {{.CreatedSince}} {{.ID}}' 2>&1
else
  echo "(skipped: no Docker access)"
fi
echo "--- git state ---"
git log --oneline -3 2>&1
git status --short 2>&1 | head -10

hr "DONE - paste everything above for diagnosis"
