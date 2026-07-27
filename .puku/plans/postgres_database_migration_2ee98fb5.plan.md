---
name: Postgres Database Migration
overview: "Replace the flat-file data.json storage with a PostgreSQL container. Add a db service to docker-compose, refactor server/index.js to use node-postgres, ship an explicit `npm run migrate` script that imports the existing data.json once, and update backup/restore docs to use pg_dump. All HTTP endpoints keep their current JSON shape and the localStorage fallback is untouched."
todos:
  - id: 1
    content: "Add `pg` to `server/package.json` and create `server/db.js` (pool, query, withTx, settings KV, initSchema)"
    status: pending
  - id: 2
    content: "Write `server/migrate-json-to-db.js` + `npm run migrate` script (idempotent, exits non-zero if already populated)"
    status: pending
  - id: 3
    content: "Refactor `server/index.js` routes to use Postgres queries, keeping camelCase response shape via existing mappers"
    status: pending
  - id: 4
    content: "Update `docker-compose.yml`: add `db` service (postgres:16-alpine + healthcheck), wire `depends_on`, set `DATABASE_URL`, declare `contacthub-postgres` volume"
    status: pending
  - id: 5
    content: "Add `db:up` / `db:down` scripts and document local-dev `DATABASE_URL` fallback"
    status: pending
  - id: 6
    content: "Verify `Dockerfile` (no native build needed for `pg`; keep `USER node`)"
    status: pending
  - id: 7
    content: "Rewrite README sections: Postgres setup, migrate-from-json, pg_dump / pg_restore backup"
    status: pending
  - id: 8
    content: "Verification: tsc, build, syntax-check, docker compose up, health, login CRUD, backup/restore"
    status: pending
isProject: false
---

## Plan: Migrate ContactHub to PostgreSQL (Docker)

**TL;DR:** Replace flat-file `data.json` with a `postgres:16-alpine` container wired into `docker-compose.yml`. Add `pg` to `server/package.json`, build a small `server/db.js` (pool + schema init + key-value `settings` table for `sessionSecret`), refactor every route handler in `server/index.js` from `loadData()`/`saveData(db)` to parameterized queries, ship a one-shot `npm run migrate` script that streams `data.json` rows into Postgres, and rewrite the README's data section to use `pg_dump` / `pg_restore`. The frontend, the localStorage fallback, and every existing endpoint stay byte-identical.

**Steps**

1. **(depends on nothing)** Add `pg` (`^8.13.1`) to `server/package.json` dependencies and create `server/db.js`. The module exports `pool`, `query(text, params)`, `withTx(fn)`, and `getSetting(key)` / `setSetting(key, value)` helpers backed by a `settings(key TEXT PK, value JSONB)` table (holds `sessionSecret`, `sessionSettings`, future toggles). Schema bootstrap (`CREATE TABLE IF NOT EXISTS …`) lives in `server/db.js` and runs once at module load — idempotent. (parallel with 2)

2. **(depends on 1)** Write `server/migrate-json-to-db.js`. It reads `DATA_FILE` (default `server/data.json`), opens a single transaction, and inserts into:
   - `users(id, email, name, role, password_hash, is_active, last_login, created_at)`
   - `departments(id, name, color, created_at)` (dedup by name)
   - `employees(id, full_name, job_title, department_name, work_email, extension, personal_phone, work_phone, location, status, address, notes, created_at, updated_at)`
   - `sync_logs(id, source, direction, status, message, created_at)`
   - `activity_logs(id, user_id FK→users, action, entity_type, entity_id, metadata JSONB, created_at)`
   - `session_settings(id SMALLINT PK DEFAULT 1, payload JSONB, updated_at)` — singleton row
   - `settings(key, value)` — for `sessionSecret`
   Uses `INSERT … ON CONFLICT (id) DO NOTHING` so re-runs are safe. Exits non-zero if `users` already populated (avoids double-import by accident). Add `"migrate": "node migrate-json-to-db.js"` to `server/package.json` scripts. (parallel with 1)

3. **(depends on 1)** Refactor `server/index.js`. Replace every `loadData()` / `saveData(db)` with `await query(...)` or `await withTx(async client => …)`. Map columns snake_case → camelCase inside the existing `publicUser()` / `employeeToFrontend()` helpers so the HTTP response shape is unchanged. Auth flow: pull `sessionSecret` from `settings` table at boot (`getSetting('sessionSecret')`), auto-generate + `setSetting` if missing (same behaviour as today). Token sign/verify stays identical. (depends on 1, 2)

4. **(depends on 3)** Update `docker-compose.yml`. Add a `db` service:
   ```yaml
   db:
     image: postgres:16-alpine
     restart: unless-stopped
     environment:
       POSTGRES_USER: contacthub
       POSTGRES_PASSWORD: contacthub
       POSTGRES_DB: contacthub
     volumes:
       - contacthub-postgres:/var/lib/postgresql/data
     healthcheck:
       test: ["CMD-SHELL", "pg_isready -U contacthub -d contacthub"]
       interval: 5s
       timeout: 3s
       retries: 20
   ```
   Add `depends_on: db: { condition: service_healthy }` on `app`, set `DATABASE_URL=postgres://contacthub:contacthub@db:5432/contacthub` in `app.environment`, declare the new named volume `contacthub-postgres` at the bottom (keep `contacthub-data` for now so the old `data.json` can be migrated out, or remove it after migration is verified — see Verification step 6).

5. **(depends on 4)** Update local dev experience. `server/package.json` keeps `npm run dev` (concurrently runs API + Vite); add a `db:up` / `db:down` convenience that wraps `docker compose up -d db` / `docker compose stop db` so developers without a system Postgres can start the DB alone. Document `DATABASE_URL` fallback to `postgres://contacthub:contacthub@localhost:5432/contacthub` for devs who run Postgres natively. (parallel with 6)

6. **(depends on 4)** Update `Dockerfile` if needed. `node:20-alpine` is fine — `pg` has no native build step required (`pg` is pure JS; it ships optional `pg-native` which we don't take). Keep `USER node`, `/data` directory (still used as a scratch dir for one-shot migration artifacts, optional), expose 8090. No multi-stage change required.

7. **(depends on 3, 4)** Update `README.md` — replace the "flat-file" sections:
   - "Production (Docker)" → mention `db` service, `contacthub-postgres` volume, healthcheck.
   - Add a new "Migrate existing data.json" section with `docker compose exec -T app node server/migrate-json-to-db.js` (or `npm run migrate` inside the container).
   - Replace backup/restore with `pg_dump` / `pg_restore` examples, plus a "fallback JSON export" route kept on the API (`GET /api/v1/admin/export` — already present? if not, add) for portability.
   - Update troubleshooting table: `EACCES on /data` row becomes `connection refused on 5432` row.

8. **(depends on 1–7)** Verification gates (must all pass before declaring done):
   - `npx tsc -p tsconfig.app.json --noEmit` clean.
   - `npm run build` succeeds (frontend unchanged).
   - `cd server && node -c index.js && node -c db.js && node -c migrate-json-to-db.js` syntax check.
   - `docker compose build` succeeds.
   - `docker compose up -d` → `docker compose ps` shows both `app` and `db` `(healthy)`.
   - `curl http://localhost:8090/api/v1/health` → `{"ok":true,...}`.
   - `docker compose exec -T db psql -U contacthub -d contacthub -c "\dt"` lists all 7 tables.
   - `docker compose exec -T app node server/migrate-json-to-db.js` exits 0; row counts in Postgres match `data.json` arrays.
   - Login as `admin@corp.com / admin123` works; create / edit / delete an employee; refresh — changes persist.
   - Backup: `docker compose exec -T db pg_dump -U contacthub contacthub > backup.sql`; restore on a fresh volume reproduces the data.

**Relevant files**
- `server/db.js` *(new)* — pool, `query`, `withTx`, settings KV, `initSchema()`.
- `server/migrate-json-to-db.js` *(new)* — reads `DATA_FILE`, transactional import.
- `server/index.js` — every route handler rewritten to use `query` / `withTx`; boot reads `sessionSecret` from `settings`.
- `server/package.json` — add `pg` dep, add `"migrate"`, `"db:up"`, `"db:down"` scripts.
- `docker-compose.yml` — add `db` service, `depends_on` healthcheck, `DATABASE_URL` env, new `contacthub-postgres` volume.
- `Dockerfile` — minor: ensure `pg` works on `node:20-alpine` (no native deps needed).
- `README.md` — new sections for Postgres + migrate + pg_dump backup.

**Diagrams**

```mermaid
flowchart LR
  Browser["Office browser<br/>(SPA)"] -- "HTTP 8090<br/>/api/v1/*" --> App["contacthub-app<br/>Express + node-postgres"]
  App -- "TCP 5432<br/>DATABASE_URL" --> DB["contacthub-db<br/>postgres:16-alpine"]
  App -. "one-shot" .-> Migrate["migrate-json-to-db.js<br/>(reads /data/data.json)"]
  App --> Static["serves dist/<br/>static SPA"]
  Migrate -.->|"INSERT rows<br/>(once)"| DB
  DB --> Vol[("contacthub-postgres<br/>named volume")]
  App --> LogVol[("contacthub-data<br/>(legacy, removable)")]
```

```mermaid
sequenceDiagram
  participant U as User browser
  participant API as Express API
  participant DB as PostgreSQL

  U->>API: POST /api/v1/auth/login {email,password}
  API->>DB: SELECT * FROM users WHERE email=$1
  DB-->>API: row (snake_case)
  API->>API: hashPassword(input) === password_hash
  API->>DB: UPDATE users SET last_login=NOW() WHERE id=$1
  API->>DB: INSERT INTO activity_logs(user_id,action,…)
  API->>DB: SELECT value FROM settings WHERE key='sessionSecret'
  DB-->>API: sessionSecret
  API->>API: signToken(payload, sessionSecret)
  API-->>U: { token, user: publicUser(row) } (camelCase)
  U->>API: GET /api/v1/employees (Bearer token)
  API->>API: verifyToken(token, sessionSecret)
  API->>DB: SELECT * FROM employees ORDER BY full_name
  DB-->>API: rows (snake_case)
  API->>API: rows.map(employeeToFrontend)
  API-->>U: [{…camelCase…}]
```

```mermaid
erDiagram
  USERS ||--o{ ACTIVITY_LOGS : "performs"
  DEPARTMENTS ||--o{ EMPLOYEES : "groups"
  SESSION_SETTINGS ||--|| SETTINGS : "kv"

  USERS {
    text id PK
    text email UK
    text name
    text role
    text password_hash
    boolean is_active
    timestamptz last_login
    timestamptz created_at
  }
  DEPARTMENTS {
    text id PK
    text name UK
    text color
    timestamptz created_at
  }
  EMPLOYEES {
    text id PK
    text full_name
    text job_title
    text department_name FK
    text work_email UK
    text extension
    text personal_phone
    text work_phone
    text location
    text status
    text address
    text notes
    timestamptz created_at
    timestamptz updated_at
  }
  SYNC_LOGS {
    text id PK
    text source
    text direction
    text status
    text message
    timestamptz created_at
  }
  ACTIVITY_LOGS {
    text id PK
    text user_id FK
    text action
    text entity_type
    text entity_id
    jsonb metadata
    timestamptz created_at
  }
  SESSION_SETTINGS {
    smallint id PK
    jsonb payload
    timestamptz updated_at
  }
  SETTINGS {
    text key PK
    jsonb value
  }
```
