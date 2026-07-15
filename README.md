# ContactHub — Office LAN deployment (no database)

This project is a React + Vite contact directory. It ships with a tiny
**Node/Express LAN server** (`server/`) that stores everything in a single
`data.json` file on disk. There is no database to install.

The app's HTTP layer (`src/lib/api.ts`) talks to this server when it can
reach it. If the server is unreachable (e.g. someone opened the app before
the server started), it transparently falls back to per-browser
`localStorage` so a single user can still use the app. Run the server for
true office-wide sharing.

## Run it on the office network

1. **Install server dependencies** (one time):
   ```bash
   npm run server:install
   ```
   This installs `express` and `cors` into `server/node_modules`.

2. **Start both the API and the dev server together**:
   ```bash
   npm run dev
   ```
   - API:  http://localhost:8080  (binds to `0.0.0.0`, so LAN clients can reach it)
   - Web:  http://localhost:5173

3. **Share with the office**. When the API starts it prints the host
   machine's LAN IPs. Co-workers open e.g.
   `http://192.168.1.42:5173` in their browser. The same `server/data.json`
   file holds everyone's data.

4. **Default admin** (seeded on first run):
   - Email: `admin@corp.com`
   - Password: `admin123`

   Change it after first login (use **User Management** in the admin
   console to set a new password) or by editing `server/data.json`.

## Build for production

```bash
npm run build           # builds the React app to dist/
npm run server:start    # runs the API on port 8080
```

Serve `dist/` with any static host (nginx, IIS, `npx serve`, etc.) and
point it at the API. Set `VITE_API_URL=http://<server-ip>:8080/api/v1` at
build time if the API is not on the same host as the static site.

## Production (Docker) — single container, persistent data

This is the recommended way to run ContactHub on an office server or a
small VPS. One container runs the Node API **and** serves the built
React app from the same process on port **8090**. Data lives in a named
Docker volume, so `data.json` survives image rebuilds and restarts.

### Prerequisites
- Docker Engine 24+ and Docker Compose v2
- Inbound TCP **8090** open on the host firewall
  (PowerShell, one-time, as admin):
  ```powershell
  New-NetFirewallRule -DisplayName "ContactHub" -Direction Inbound `
    -Protocol TCP -LocalPort 8090 -Action Allow -Profile Private
  ```

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

The frontend auto-detects the API host from `window.location.hostname`,
so the same image works regardless of the server's IP.

### Verify it's healthy
```bash
curl http://localhost:8090/api/v1/health
# -> {"ok":true,"ts":"2026-07-15T10:00:00.000Z"}
```
Docker also runs an internal healthcheck every 30s; `docker compose ps`
will show `(healthy)` once startup completes (~10s).

### Backup and restore
The database is a single file inside the named volume:
```bash
# Backup (creates a snapshot dated file on the host)
docker compose exec app cat /data/data.json > data-$(date +%F).json

# Restore
docker compose cp data-2026-07-15.json app:/data/data.json
docker compose restart app
```

The volume also stores the auto-generated `sessionSecret`. Backups are
point-in-time copies; the next server start will keep using the secret
in the restored file, so any tokens issued before the restore remain
valid.

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
| `/app/dist/`                  | The built React app (from `npm run build`) |
| `/data/data.json`             | The whole "database" (users, employees, departments, activity logs, session secret) |

## Why no database?

- Zero install on a fresh office PC.
- Single file = trivial backup (`copy server\data.json backup.json`).
- Safe because the trust boundary is the office network itself.

## Why the login wasn't working

The previous build pointed at `http://localhost:8080/api/v1` but no such
server existed, so every `POST /auth/login` returned a network error.
This repo now ships that server (`server/index.js`) and `api.ts` falls back
to localStorage if it's not running, so login works in either mode.
