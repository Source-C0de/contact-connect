# ContactHub — Office LAN deployment (PostgreSQL)

This project is a React + Vite contact directory. It ships with a tiny
**Node/Express LAN server** (`server/`) backed by **PostgreSQL** that
stores users, employees, departments, sync logs, and activity logs.

The app's HTTP layer (`src/lib/api.ts`) talks to this server when it can
reach it. If the server is unreachable (e.g. someone opened the app before
the server started), it transparently falls back to per-browser
`localStorage` so a single user can still use the app. Run the server for
true office-wide sharing.

## Configuration (`.env`)

All ports and connection strings live in a single `.env` file at the repo
root (copy it from `.env.example`). Both Vite and the API server read it.

| Variable              | Default                | Purpose                                             |
| --------------------- | ---------------------- | --------------------------------------------------- |
| `VITE_DEV_PORT`       | `5173`                 | Port the **Vite dev server** binds during `npm run dev` |
| `PORT`                | `8123`                 | Port the API server binds during `npm run dev`       |
| `VITE_API_PORT`       | `8123`                 | Port the **browser** uses to reach the API in dev    |
| `VITE_API_URL`        | *(unset)*               | Full API base URL; overrides everything above        |
| `DATABASE_URL`        | `postgres://contacthub:contacthub@localhost:5432/contacthub` | Postgres connection |
| `APP_HOST_PORT`       | `8090`                 | Host port published by the Docker `app` container     |
| `POSTGRES_HOST_PORT`  | `5432`                 | Host port published by the Docker `db` container      |

> **Why 8123 and not 8080/8090?** On many Windows machines the range
> **8009–8108 is reserved** by the OS (check with
> `netsh interface ipv4 show excludedportrange protocol=tcp`). Binding
> anything in that range fails with `EACCES: permission denied`, and
> Docker fails to publish it with `ports are not available`. 8123 is
> outside the reserved range. If 8123 is busy for you, change both
> `PORT` and `VITE_API_PORT` to the same free value.

> **"Port 5173 is already in use"?** 5173 is a popular port and another
> dev server on the same machine often holds it. The Vite dev server is
> configured with `strictPort`, so it fails loudly instead of silently
> hopping to 5174 (a silent hop breaks the "share http://<lan-ip>:5173"
> step). Fix it by bumping `VITE_DEV_PORT` in `.env` to a free port — then
> co-workers use `http://<lan-ip>:<that port>` instead. Find a free one
> with `netstat -ano | findstr :5180`.

The API base URL is resolved in exactly one place — `src/lib/apiBase.ts`:

1. `VITE_API_URL` if set (explicit override, e.g. behind nginx).
2. In production, the **same origin** as the page (the SPA and the API are
   served by the same Node process) → `https://host/api/v1`.
3. In development, `http://<page-hostname>:<VITE_API_PORT>/api/v1` — the
   hostname is derived from the browser, so LAN colleagues are auto-detected.

## Run it on the office network (development)

1. **Install server dependencies** (one time):
   ```bash
   npm run server:install
   ```
   This installs `express`, `cors`, and `pg` into `server/node_modules`.

2. **Start PostgreSQL**:
   ```bash
   npm run db:up              # docker compose up -d db   (recommended)
   # …or run Postgres natively and export DATABASE_URL=postgres://…
   ```
   The `db` service publishes port 5432 to the host, so the API server can
   run outside Docker against the very same database.

3. **(Optional) Migrate an existing `data.json`** into Postgres. Safe to
   re-run; refuses to run if the `users` table is already populated unless
   `FORCE_MIGRATE=1` is set:
   ```bash
   npm --prefix server run migrate
   ```

4. **Start both the API and the dev server together**:
   ```bash
   npm run dev
   ```
   - API:  http://localhost:8123  (binds to `0.0.0.0`, so LAN clients can reach it)
   - Web:  http://localhost:5180

   Both ports come from `.env` (`PORT`/`VITE_API_PORT` and `VITE_DEV_PORT`).

   The Vite dev server uses `strictPort`, so if the web port is taken it
   **fails loudly** instead of silently hopping to the next free port (a
   silent hop breaks the "share http://<lan-ip>:<port>" step below). Free
   the port, or set `VITE_DEV_PORT` in `.env` to another free one.

5. **Share with the office**. When the API starts it prints the host
   machine's LAN IPs. Co-workers open e.g.
   `http://192.168.1.42:5180` in their browser. The same Postgres database
   holds everyone's data.

6. **Default admin** (seeded on first run, only if the `users` table is
   empty):
   - Email: `admin@corp.com`
   - Password: `admin123`

   Change it after first login from **User Management** in the admin
   console.

> You can run `npm run dev` **and** the Docker stack at the same time —
> `PORT`/`VITE_API_PORT` (dev API) and `APP_HOST_PORT` (Docker app) are
> separate on purpose, so they never fight over the same port.

## Build for production

```bash
npm run build           # builds the React app to dist/
npm run server:start    # runs the API (port from PORT in .env)
```

The server serves the built SPA **and** the API from the same process, so
no extra static host is needed. Serve `dist/` with any static host
(nginx, IIS, `npx serve`, etc.) instead and point it at the API — set
`VITE_API_URL=http://<server-ip>:8090/api/v1` at build time if the API is
not on the same host as the static site.

## Production (Docker) — two containers, persistent database

This is the recommended way to run ContactHub on an office server or a
small VPS. Two containers run side-by-side:

- **`db`** — `postgres:16-alpine`, stores the data in a named volume
  (`contacthub-postgres`). The schema is created automatically on first
  boot via `initSchema()`.
- **`app`** — `contacthub:latest`, runs the Node API **and** serves the
  built React app from the same process on port **8090**. The app waits
  for the `db` container's healthcheck before starting.

### Prerequisites
- Docker Engine 24+ and Docker Compose v2
- Inbound TCP **8090** open on the host firewall
  (PowerShell, one-time, as admin):
  ```powershell
  New-NetFirewallRule -DisplayName "ContactHub" -Direction Inbound `
    -Protocol TCP -LocalPort 8090 -Action Allow -Profile Private
  ```

> **Windows: "ports are not available".** If Docker refuses to publish
> 8090, the OS has that port reserved — the range **8009–8108** is
> excluded by default on many Windows installs. Set `APP_HOST_PORT=8124`
> in `.env` and open that port instead. Check what is reserved with:
> ```powershell
> netsh interface ipv4 show excludedportrange protocol=tcp
> ```

### Build and start
```bash
docker compose build         # one-time / whenever code changes
docker compose up -d         # starts in the background
docker compose logs -f       # watch logs (Ctrl+C to detach)
```

Or use the convenience npm scripts:
```bash
npm run docker:build
npm run docker:up
npm run docker:logs
npm run db:logs              # tail only the Postgres container
```

> **Heads up — Compose v1 vs v2.** The `docker compose` commands above need
> **Compose v2** (a Docker CLI plugin: `docker compose version` should print
> `v2.x.x`). The legacy Python tool `docker-compose` 1.29.x crashes on modern
> Docker Engine with `KeyError: 'ContainerConfig'` because it reads a deprecated
> field from `docker image inspect`. On Debian/Ubuntu the v2 plugin installs
> via `sudo apt-get install docker-compose-plugin`. If only the v1 binary is
> available, run with `docker-compose -f docker-compose.yml up -d --build`
> after removing the `container_name:` line (or just upgrade to v2).

### Use it
- From the host machine: <http://localhost:8090>
- From any office PC:    <http://<server-lan-ip>:8090>
- Default admin:        `admin@corp.com` / `admin123` — change it after
  the first login from **User Management** (admin sign-in required).

Use `APP_HOST_PORT` from `.env` if you changed it — replace `8090` above
with your port.

The frontend auto-detects the API host from `window.location.hostname`,
so the same image works regardless of the server's IP.

### Migrate an existing `data.json`
The legacy flat-file is still read by the one-shot migration script. If
you have a previous `data.json` you can import it like this:

```bash
# Local: run against any Postgres reachable via DATABASE_URL
npm --prefix server run migrate

# In Docker: copy the file in, then run the importer
docker compose cp data.json app:/data/data.json
docker compose exec app node server/migrate-json-to-db.js
```

The script is idempotent (uses `INSERT … ON CONFLICT DO NOTHING`) and
refuses to run if the `users` table is already populated. Override with
`FORCE_MIGRATE=1` if you really want to re-run.

### Verify it's healthy
```bash
curl http://localhost:8090/api/v1/health
# -> {"ok":true,"time":"2026-07-15T10:00:00.000Z"}
docker compose exec db pg_isready -U contacthub -d contacthub
# -> /var/run/postgresql:5432 - accepting connections
```
(Use your `APP_HOST_PORT` instead of `8090` if you changed it.)

Docker also runs internal healthchecks every 30s (app) / 5s (db);
`docker compose ps` will show `(healthy)` once startup completes (~10–20s).

### Backup and restore
Use `pg_dump` / `pg_restore` for native Postgres backups. The plain-SQL
dumps are readable; the custom-format dumps are smaller and parallel-safe.

```bash
# Plain-SQL backup (creates a snapshot dated file on the host)
docker compose exec -T db pg_dump -U contacthub -d contacthub > backup-$(date +%F).sql

# Compressed custom-format backup
docker compose exec -T db pg_dump -Fc -U contacthub -d contacthub \
  > backup-$(date +%F).dump

# Restore a plain-SQL dump
cat backup-2026-07-15.sql | docker compose exec -T db psql -U contacthub -d contacthub

# Restore a custom-format dump
docker compose exec -T db pg_restore -U contacthub -d contacthub --clean --if-exists \
  < backup-2026-07-15.dump
```

The session secret lives in the `settings` table (key = `sessionSecret`)
and is included in every backup, so any tokens issued before the restore
remain valid.

### Update after a code change
```bash
git pull
npm run docker:rebuild        # = docker compose up -d --build
```
The named volume is **not** touched, so user data and the session
secret survive the rebuild.

### Tear down
```bash
npm run docker:down            # stops the container, keeps the volume
docker compose down -v         # ALSO deletes the volume (data loss!)
```

### Where things live inside the container
| Path                          | Purpose                                  |
| ----------------------------- | ---------------------------------------- |
| `/app/server/index.js`        | The Express API + static SPA host       |
| `/app/server/db.js`           | Postgres pool + schema bootstrap        |
| `/app/server/migrate-json-to-db.js` | One-shot importer from legacy `data.json` |
| `/app/dist/`                  | The built React app (from `npm run build`) |
| `/data/data.json`             | Legacy file — only read by the migration script |
| Postgres `contacthub` DB      | The whole database (users, employees, departments, sync logs, activity logs, session secret, session settings) |

## Why PostgreSQL?

- Real transactions, real indices — handles thousands of employees
  without the "load the whole JSON file into memory" tax.
- `pg_dump` / `pg_restore` for battle-tested backups.
- The trust boundary is still the office network; Postgres isn't
  exposed to the host.

## Troubleshooting

**`EACCES: permission denied 0.0.0.0:<port>`** — the port is inside the
Windows excluded range (8009–8108). Pick a different one in `.env`:
```powershell
netsh interface ipv4 show excludedportrange protocol=tcp
```

**Docker: `ports are not available: exposing port TCP 0.0.0.0:8090`** —
same root cause. Set `APP_HOST_PORT=8124` in `.env`.

**`ECONNREFUSED` on port 5432** — Postgres isn't running or isn't
published to the host. Run `npm run db:up`, then confirm with
`docker compose ps`.

**`EADDRINUSE` on the API port** — another instance is already bound.
Stop it, or change `PORT` **and** `VITE_API_PORT` together (they must
match, since the browser needs to know which port the API is on).

**`Error: Port 5173 is already in use`** — another dev server holds the
web port. Set `VITE_DEV_PORT` in `.env` to a free port (e.g. 5180) and
restart. `strictPort` makes this fail loudly rather than silently hopping
to a port your co-workers don't know about.

**API crashed with `EADDRINUSE` and won't come back after freeing the
port** — `node --watch` only restarts on a *file* change, not when a
port is released. Touch any server file, or just stop and re-run
`npm run dev`.

**Frontend loads but every request fails** — the browser and the server
disagree about the API port. `PORT` (server) and `VITE_API_PORT`
(browser) must be the same value; if you changed one, restart the dev
server so Vite re-reads `.env`.

**Login works but nothing is shared** — you are in the localStorage
fallback because the API was unreachable. Check
`curl http://localhost:<VITE_API_PORT>/api/v1/health`; the app only falls
back when that request fails.

## Why the login wasn't working

The previous build pointed at a hard-coded `http://localhost:8080/api/v1`
but no such server existed, so every `POST /auth/login` returned a network
error. This repo now ships that server (`server/index.js`), the API base
URL is resolved once in `src/lib/apiBase.ts` (and is configurable), and
`api.ts` falls back to localStorage if the server isn't running — so
login works in either mode.

