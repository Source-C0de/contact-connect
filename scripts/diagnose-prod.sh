#!/usr/bin/env bash
# ContactHub production diagnostic.
#
# Run this on the production server and paste the full output back.
#   bash scripts/diagnose-prod.sh
#
# It is read-only: it inspects containers, logs, the database and the HTTP
# endpoints without changing any state.

set -uo pipefail

APP_PORT="${APP_HOST_PORT:-8090}"
BASE="http://localhost:${APP_PORT}"

hr() { printf '\n=== %s ===\n' "$1"; }

hr "1. Container status"
docker compose ps -a 2>&1

hr "2. Recent app logs (last 40)"
docker compose logs --tail=40 app 2>&1

hr "3. Bootstrap events"
docker compose logs app 2>&1 \
  | grep -iE 'bootstrap\.|admin_seed|session_secret' | tail -20

hr "4. Auth failures (last 20)"
docker compose logs app 2>&1 | grep -iE 'auth\.login_failed' | tail -20

hr "5. HTTP checks against ${BASE}"
printf 'health      : %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/v1/health" 2>&1)"
printf 'spa root    : %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/" 2>&1)"
printf 'spa deeplink: %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/admin/dashboard" 2>&1)"
printf 'login (admin123): %s\n' \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/v1/auth/login" \
      -H 'Content-Type: application/json' \
      -d '{"email":"admin@corp.com","password":"admin123"}' 2>&1)"

hr "6. Database — users and password hash format"
docker compose exec -T db psql -U contacthub -d contacthub -c \
  "SELECT email, role, is_active,
          CASE
            WHEN password_hash LIKE 'pbkdf2\$%' THEN 'pbkdf2 (current)'
            WHEN password_hash LIKE 'sha256\$%' THEN 'legacy salted-sha256'
            WHEN password_hash ~ '^[0-9a-f]{64}\$' THEN 'LEGACY BARE SHA256'
            ELSE 'UNKNOWN FORMAT'
          END AS hash_format,
          left(password_hash, 26) AS hash_prefix
     FROM users;" 2>&1

hr "7. Database — row counts"
docker compose exec -T db psql -U contacthub -d contacthub -c \
  "SELECT 'users' AS t, count(*) FROM users
   UNION ALL SELECT 'employees', count(*) FROM employees
   UNION ALL SELECT 'departments', count(*) FROM departments;" 2>&1

hr "8. Session secret present?"
docker compose exec -T db psql -U contacthub -d contacthub -c \
  "SELECT key, length(value::text) AS secret_len FROM settings WHERE key='sessionSecret';" 2>&1

hr "9. Volumes in use"
docker volume ls 2>&1 | grep -i contacthub

hr "10. Built SPA present and referencing real assets?"
docker compose exec -T app sh -c \
  "ls -la /app/dist/index.html /app/dist/assets/ 2>&1 | head -10; echo '--- script tags ---'; grep -o '<script[^>]*>' /app/dist/index.html" 2>&1

hr "11. Is the API URL baked into the bundle?"
docker compose exec -T app sh -c \
  "grep -o 'location.host[^,;]\{0,60\}' /app/dist/assets/*.js | head -3; echo '--- any absolute API URL? ---'; grep -oh 'https\?://[a-zA-Z0-9./-]*api/v1' /app/dist/assets/*.js | sort -u | head -5" 2>&1

hr "12. Disk space"
df -h / /var/lib/docker 2>&1 | head -5

hr "DONE — paste everything above for diagnosis"
