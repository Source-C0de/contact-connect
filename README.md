# ContactHub

A React + Vite contact directory with a small **Node/Express** API
(`server/`) backed by **PostgreSQL**, storing users, employees,
departments, sync logs and activity logs.

The frontend talks to that API over HTTP. If the API is unreachable the
app falls back to a per-browser `localStorage` mirror, so a single person
can still work offline — but for true office-wide sharing the server must
be running.

---

## Which guide do I need?

| I want to…                                       | Go to                                                    |
| ------------------------------------------------ | -------------------------------------------------------- |
| Write code / work on the app locally              | **[Part 1 — Development](#part-1--development)**         |
| Host it for the whole office on an Ubuntu server  | **[Part 2 — Production](#part-2--production-ubuntu-server)** |

The two parts are independent. Part 1 is for your own machine; Part 2 is
for the shared server. You can run both at the same time without a port
conflict.

---

## Contents

**Part 1 — Development**
- [Requirements](#requirements)
- [Setup](#setup)
- [Running the app](#running-the-app)
- [npm scripts](#npm-scripts)
- [Testing and linting](#testing-and-linting)
- [Migrating a legacy `data.json`](#migrating-a-legacy-datajson)

**Part 2 — Production (Ubuntu server)**
- [How it works](#how-it-works)
- [1. Prepare the server](#1-prepare-the-server)
- [2. Install Docker](#2-install-docker)
- [3. Get the code](#3-get-the-code)
- [4. Configure](#4-configure)
- [5. Build and start](#5-build-and-start)
- [6. Open it from any PC on the network](#6-open-it-from-any-pc-on-the-network)
- [7. Verify](#7-verify)
- [8. Day-to-day operations](#8-day-to-day-operations)
- [9. Backups](#9-backups)
- [10. Upgrades](#10-upgrades)
- [11. Uninstall](#11-uninstall)

**Reference**
- [Configuration reference](#configuration-reference)
- [How the browser finds the API](#how-the-browser-finds-the-api)
- [Troubleshooting](#troubleshooting)
- [Why PostgreSQL](#why-postgresql)

---

# Part 1 — Development

Use this on your own machine while writing code. It runs the API and the
Vite dev server (hot reload) locally, against a Postgres database in
Docker.

## Requirements

- **Node 20.12+** — Node 24 recommended (the server uses
  `process.loadEnvFile()`)
- **Docker** — for the database only
- **npm**

## Setup

```bash
# 1. install frontend + tooling dependencies
npm install

# 2. install server dependencies (express, cors, pg) into server/node_modules
npm run server:install

# 3. create your local .env
cp .env.example .env
```

Open `.env` and check the ports are free on your machine:

```ini
# Port the Vite dev server binds
VITE_DEV_PORT=5180

# Port the API server binds (must match the browser-facing one below)
PORT=8123
VITE_API_PORT=8123
```

> **Ports 8080–8108 are reserved on many Windows machines.** Binding
> anything in that range fails with `EACCES: permission denied`, and
> Docker fails to publish it with `ports are not available`. The defaults
> above (5180 / 8123) sit outside it. Check what's reserved with:
> ```powershell
> netsh interface ipv4 show excludedportrange protocol=tcp
> ```

Start the database:

```bash
npm run db:up        # docker compose up -d db
```

## Running the app

```bash
npm run dev
```

This starts two processes side by side:

| Service | URL                       | Notes                                          |
| ------- | ------------------------- | ---------------------------------------------- |
| **Web**  | http://localhost:5180    | Vite dev server with hot reload                |
| **API**  | http://localhost:8123    | Express API, `--watch` restarts on file change |

Both ports come from `.env`, so change them there rather than editing
files. `VITE_DEV_PORT` is what you browse to; `VITE_API_PORT` is what
the browser uses to reach the API.

### Test from another device on your network

The Vite server binds `0.0.0.0`, so any PC on the same network can open
`http://<your-ip>:5180`. The API base URL is derived from the browser's
hostname, so co-workers automatically hit the right host.

> The Vite dev server runs with `strictPort: true`, so it **fails
> loudly** if the port is busy instead of silently hopping to the next
> free port. A silent hop breaks the URL you're sharing with people and
> is very easy to miss. If you see `Error: Port 5180 is already in use`,
> set `VITE_DEV_PORT` to a free port in `.env`.

### Running dev and Docker together

You can run `npm run dev` and the full Docker stack at the same time —
the dev API port (`PORT`) and the Docker-published port
(`APP_HOST_PORT`) are separate on purpose, so they never collide.

## npm scripts

| Script                     | What it does                                          |
| -------------------------- | ----------------------------------------------------- |
| `npm run dev`              | API + web dev server together                        |
| `npm run dev:web`          | Web dev server only                                   |
| `npm run dev:server`       | API server only                                       |
| `npm run build`            | Production build to `dist/`                           |
| `npm run preview`          | Serve the production build locally                   |
| `npm run test`             | Run the test suite once                               |
| `npm run test:watch`       | Run the test suite in watch mode                      |
| `npm run lint`             | ESLint over the project                                |
| `npm run db:up` / `db:down`| Start / stop the Postgres container                   |
| `npm run db:logs`          | Tail the Postgres log                                 |
| `npm run docker:up`        | Start the full Docker stack                           |
| `npm run docker:build`     | Build the Docker image                                |
| `npm run docker:rebuild`   | Rebuild the image and recreate the containers         |
| `npm run docker:logs`      | Tail the Docker logs                                  |
| `npm run docker:ps`        | Show container status                                 |
| `npm run docker:down`      | Stop and remove the containers (keeps data)           |
| `npm run server:install`   | Install server-only dependencies                      |
| `npm run server:start`     | Run the API server in production mode                 |

## Testing and linting

```bash
npm test          # vitest, single run
npm run test:watch
npm run lint
```

The API server is plain JavaScript (ESM) under `server/`; the frontend
is TypeScript under `src/`.

## Migrating a legacy `data.json`

The old flat-file lives at `server/data.json` in this repo. The one-shot
importer reads it and inserts everything into Postgres.

```bash
npm --prefix server run migrate
```

It refuses to run if the `users` table already has rows, unless
`FORCE_MIGRATE=1` is set:

```bash
# macOS / Linux / Git Bash
FORCE_MIGRATE=1 npm --prefix server run migrate
```

```powershell
# Windows PowerShell
$env:FORCE_MIGRATE = "1"; npm --prefix server run migrate; Remove-Item Env:FORCE_MIGRATE
```

The importer is idempotent (`INSERT … ON CONFLICT DO NOTHING`), so
re-running it is safe.

---

# Part 2 — Production (Ubuntu server)

This is the recommended way to run ContactHub so every PC on the office
network can use it. Two containers run side by side:

| Service | Image                | Role                                                                 |
| ------- | -------------------- | -------------------------------------------------------------------- |
| `db`    | `postgres:16-alpine` | Stores all data in a named volume (`contacthub-postgres`)            |
| `app`   | `contacthub:latest`  | Runs the Node API **and** serves the built React app on port **8090** |

The `app` container waits for the `db` healthcheck to pass before
starting, so there is no race on first boot.

---

## 1. Prepare the server

**Requirements:** Ubuntu 22.04 LTS or newer, 2 GB RAM, 1 GB free disk,
and a static IP or DHCP reservation on your LAN.

Check your IP:

```bash
ip -4 addr show scope global
```

You want something like `192.168.1.42`. **Write it down** — you'll need it
in step 6. If the address may change, set a DHCP reservation in your
router so the URL stays the same.

Make sure the server stays awake:

```bash
sudo timedatectl set-local-rtc
sudo systemctl disable --now sleep.target suspend.target hibernate.target hybrid-sleep.target
```

---

## 2. Install Docker

Following the official Docker Engine docs for Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
```

Add yourself to the `docker` group so you don't need `sudo` on every command:

```bash
sudo usermod -aG docker "$USER"
```

**Log out and back in** (or reboot) for the group change to take effect —
this is the most common reason for
`permission denied while trying to connect to the Docker daemon socket`.

Verify:

```bash
docker --version
docker compose version     # must print v2.x.x
sudo systemctl enable --now docker
```

> **Need Compose v2.** The legacy Python `docker-compose` 1.29.x crashes on
> modern Docker Engine with `KeyError: 'ContainerConfig'`. If `docker
> compose version` errors out, install the plugin:
> `sudo apt-get install docker-compose-plugin`.

---

## 3. Get the code

```bash
sudo mkdir -p /opt/contacthub
sudo chown "$USER":"$USER" /opt/contacthub
cd /opt/contacthub
```

Copy the project there — either clone it:

```bash
git clone <your-repo-url> .
```

…or upload it from your PC with `scp` (run this **from your PC**, not
the server):

```bash
# copy the whole project directory
scp -r ./contacthub user@192.168.1.42:/opt/
```

`scp -r ./contacthub` copies the directory *including* dotfiles like
`.env` and `.gitignore`. If you'd rather copy only the contents, use
`scp -r ./contacthub/* user@192.168.1.42:/opt/contacthub/` — but note
that glob skips hidden files.

Then pull the latest changes on the server (if you cloned):

```bash
cd /opt/contacthub
git pull
```

---

## 4. Configure

Create the `.env` file. It holds the ports Compose publishes — the
**only** thing most installs need to change:

```bash
cp .env.example .env
nano .env
```

For a plain Ubuntu server the defaults are correct — the Windows port
exclusion problem documented in `.env.example` does not apply here:

```ini
# Host port published by the Docker `app` container.
# Everyone on the LAN opens: http://<server-ip>:8090
APP_HOST_PORT=8090

# Host port published by the Docker `db` container.
# Only needs to be reachable by this server — keep it as-is.
POSTGRES_HOST_PORT=5432
```

Optionally, lock the database down with a real password. Edit
`docker-compose.yml` and change these two places to match:

```yaml
  db:
    environment:
      POSTGRES_USER: contacthub
      POSTGRES_PASSWORD: change-this-to-a-long-random-password
      POSTGRES_DB: contacthub
```

```yaml
  app:
    environment:
      DATABASE_URL: postgres://contacthub:change-this-to-a-long-random-password@db:5432/contacthub
```

> **Existing data?** If you already ran a stack with the default password,
> changing `POSTGRES_PASSWORD` will NOT change the password inside the
> existing volume. See [Troubleshooting](#troubleshooting) → *changing the
> database password*.

---

## 5. Build and start

```bash
cd /opt/contacthub
docker compose build
docker compose up -d
docker compose ps
```

Wait ~20 seconds for the healthchecks, then confirm:

```bash
docker compose ps
# NAME             IMAGE                STATUS                    PORTS
# contacts-app-1   contacthub:latest     Up (healthy)              0.0.0.0:8090->8090/tcp
# contacts-db-1    postgres:16-alpine    Up (healthy)              0.0.0.0:5432->5432/tcp
```

Both should say **(healthy)**. If they don't, run `docker compose logs -f`
and read [Troubleshooting](#troubleshooting).

### Make it start automatically on reboot

The containers already have `restart: unless-stopped`, so Docker brings
them back after a reboot. Docker itself must also be enabled:

```bash
sudo systemctl enable --now docker
```

---

## 6. Open it from any PC on the network

Open a browser on **any** PC on the same network and go to:

```
http://<server-ip>:8090
```

For example, if the server is `192.168.1.42`:

```
http://192.168.1.42:8090
```

You do **not** need to run anything locally — no Node, no Docker, no
database on the client PCs. The server hosts everything.

### Sign in

On the **first boot** of an empty database the server creates one admin
account for you:

| Email            | Password   |
| ---------------- | ---------- |
| `admin@corp.com` | `admin123` |

The server logs exactly what it did, so you can tell whether the seed
ran:

```
Seeded default admin user (admin@corp.com / admin123)   ← first boot
Seeded default departments
Generated and persisted a new session secret
```

On any later boot it skips the seed and says so instead:

```
Users table not empty (2 row(s)) — skipping admin seed.
```

> **If `admin123` doesn't work, the password was already changed.**
> The default only exists until someone sets a new one. If the log says
> `skipping admin seed`, the database already has users — sign in with
> the current password, or reset it directly.
>
> Passwords are stored as PBKDF2-HMAC-SHA256 with a per-user random salt, in
> the format `pbkdf2$<iterations>$<salt-hex>$<hash-hex>`. To reset a password,
> generate the hash with the app's own `hashPassword()` — never with a plain
> `sha256` one-liner, which produces a value the server will reject:
> ```bash
> docker compose exec -T app node --input-type=module -e "
> import { hashPassword } from './server/auth.js';
> import { query, pool } from './server/db.js';
> const hash = hashPassword('yournewpassword');
> const { rows } = await query(
>   'UPDATE users SET password_hash = \$1 WHERE LOWER(email) = LOWER(\$2) RETURNING id, email',
>   [hash, 'admin@corp.com'],
> );
> console.log('updated:', JSON.stringify(rows));
> await pool.end();
> "
> ```
>
> Rows imported from the legacy `server/data.json` still carry the original
> `SHA-256('contacthub-static-salt' + password)` digest. The server accepts
> that format and transparently rehashes the row to PBKDF2 the first time that
> account signs in successfully.

**Change the default password immediately** after the first sign-in:
**Admin console → User Management → set a new password.** Everyone on the
LAN can reach this login page, so the default password must not survive
your first session.

### Allow the port through the firewall

Ubuntu's `ufw` is inactive by default, but if you have enabled it:

```bash
sudo ufw allow 8090/tcp
sudo ufw status
```

If the office router blocks traffic between devices, allow the port in
the router's firewall as well.

---

## 7. Verify

From the server:

```bash
curl http://localhost:8090/api/v1/health
# {"ok":true,"time":"2026-07-15T10:00:00.000Z"}
```

From any other PC on the network:

```bash
curl http://192.168.1.42:8090/api/v1/health
```

Both should return `{"ok":true,...}`. If the second one fails but the
first works, it's a network/firewall problem, not an application problem.

Other useful checks:

```bash
docker compose exec db pg_isready -U contacthub -d contacthub
# /var/run/postgresql:5432 - accepting connections

docker compose logs --tail=50 app    # API/SPA log
docker compose logs --tail=50 db     # Postgres log
```

---

## 8. Day-to-day operations

```bash
cd /opt/contacthub

docker compose ps          # status
docker compose logs -f     # follow logs (Ctrl+C to detach)
docker compose restart app # restart just the API/SPA
docker compose stop        # stop everything (data is kept)
docker compose start       # start again
docker compose down        # remove containers (data is kept in volumes)
```

The convenience npm scripts work too, if you have Node installed on the
server: `npm run docker:up`, `npm run docker:logs`, `npm run docker:ps`.

---

## 9. Backups

All data lives in the `contacthub-postgres` volume. Use `pg_dump` for
native, restorable backups.

**Create a backup:**

```bash
cd /opt/contacthub
mkdir -p backups
docker compose exec -T db pg_dump -U contacthub -d contacthub \
  > "backups/contacthub-$(date +%F).sql"
```

**Restore** — note the `--clean --if-exists` flags. Without them the
restore fails with `multiple primary keys ... not allowed` and
`relation ... already exists`, because a plain dump contains `CREATE
TABLE` statements that collide with the existing schema:

```bash
# Back up the CURRENT state first, just in case
docker compose exec -T db pg_dump -U contacthub -d contacthub \
  > "backups/pre-restore-$(date +%F).sql"

# Restore (replaces current data)
docker compose exec -T db pg_dump -U contacthub -d contacthub --clean --if-exists \
  | docker compose exec -T db psql -U contacthub -d contacthub
```

Verify the restore landed:

```bash
docker compose exec db psql -U contacthub -d contacthub \
  -c "SELECT count(*) FROM employees;"
```

> **The session secret survives.** It lives in the `settings` table and
> is included in every backup, so tokens issued before a restore remain
> valid.

**Automated nightly backup** — add to the server's crontab
(`crontab -e`):

```cron
0 2 * * * cd /opt/contacthub && mkdir -p backups && docker compose exec -T db pg_dump -U contacthub -d contacthub | gzip > "backups/contacthub-$(date +\%F).sql.gz"
```

Keep at least the last few weeks, and test a restore once on a scratch
machine — a backup you have never restored is only a hope, not a plan.

---

## 10. Upgrades

```bash
cd /opt/contacthub
git pull
docker compose up -d --build
```

The named volumes are **not** touched, so your data and the session
secret survive the rebuild. Allow ~60–90 seconds for the image rebuild,
then confirm with `docker compose ps` and the health check from
[step 7](#7-verify).

---

## 11. Uninstall

```bash
cd /opt/contacthub
docker compose down            # removes containers, KEEPS data
docker compose down -v         # ALSO deletes the volumes — DATA LOSS
docker rmi contacthub:latest postgres:16-alpine   # optional: remove images
sudo rm -rf /opt/contacthub
```

---

# Configuration reference

| Variable             | Default                                                          | Used by | Purpose                                             |
| -------------------- | ---------------------------------------------------------------- | ------- | --------------------------------------------------- |
| `VITE_DEV_PORT`      | `5180`                                                           | dev     | Port the Vite dev server binds                       |
| `PORT`               | `8123`                                                           | dev     | Port the API server binds                            |
| `VITE_API_PORT`      | `8123`                                                           | dev     | Port the **browser** uses to reach the API in dev   |
| `VITE_API_URL`       | *(unset)*                                                        | both    | Full API base URL; overrides everything above        |
| `DATABASE_URL`       | `postgres://contacthub:contacthub@localhost:5432/contacthub`   | dev     | Postgres connection string                           |
| `APP_HOST_PORT`      | `8090`                                                           | prod    | Host port published by the Docker `app` container     |
| `POSTGRES_HOST_PORT` | `5432`                                                           | prod    | Host port published by the Docker `db` container      |
| `SESSION_SECRET`     | *(auto-generated)*                                               | prod    | HMAC key for session tokens; persisted in the DB     |

These are the values shipped in `.env.example`. `VITE_DEV_PORT` and
`APP_HOST_PORT` differ from the code's built-in fallbacks (5173 / 8090)
because the shipped values avoid ports that are commonly occupied or
reserved — see [Troubleshooting](#troubleshooting).

---

# How the browser finds the API

Resolved in exactly one place — `src/lib/apiBase.ts`:

1. **`VITE_API_URL`** if set — explicit override (e.g. behind nginx).
2. **Production** — the **same origin** as the page. The SPA and the API
   are served by the same Node process, so the URL is
   `http://<server-ip>:8090/api/v1`. This is why the Docker setup needs
   no extra configuration: the same image works on any IP.
3. **Development** — `http://<page-hostname>:<VITE_API_PORT>/api/v1`. The
   hostname comes from the browser, so LAN colleagues are auto-detected.

---

# Troubleshooting

**`ports are not available` / `EACCES: permission denied` (Windows only)**
— the port is inside the Windows excluded range 8009–8108. Set
`APP_HOST_PORT=8123` in `.env`. Check with
`netsh interface ipv4 show excludedportrange protocol=tcp`. On Ubuntu
this does not apply.

**`docker compose` says the command is not found** — Compose v2 isn't
installed. Run `sudo apt-get install docker-compose-plugin`, then verify
with `docker compose version`.

**`permission denied while trying to connect to the Docker daemon socket`**
— your user isn't in the `docker` group yet. Run `sudo usermod -aG docker
"$USER"`, then **log out and back in** (`newgrp docker` may not be enough
for an already-running shell session).

**The page loads but every request fails** — the browser can't reach the
API. Check `curl http://<server-ip>:8090/api/v1/health` **from another
PC**. If it fails there too, it's the firewall or the router; if it
succeeds, the browser is the problem (cached bundle — hard-refresh).

**Login works but nothing is shared** — you're in the `localStorage`
fallback because the API was unreachable. Confirm the health endpoint
responds, then sign out and back in.

**`ECONNREFUSED` on port 5432** — Postgres isn't running. `docker compose
up -d db` and confirm it reports `(healthy)`.

**`EADDRINUSE` on the API port** — another instance already holds the
port. Stop it, or change `PORT` **and** `VITE_API_PORT` together (they
must match, since the browser needs to know which port the API is on).

**`Error: Port 5180 is already in use`** — another dev server holds the
web port. Set `VITE_DEV_PORT` in `.env` to a free port and restart.

**API crashed with `EADDRINUSE` and won't come back after freeing the
port** — `node --watch` only restarts on a *file* change, not when a port
is released. Touch any server file, or just stop and re-run `npm run dev`.

**Changing the database password doesn't take effect** — the password
lives inside the existing volume. To change it on a database that already
has data:

```bash
docker compose exec db psql -U contacthub -d contacthub \
  -c "ALTER USER contacthub WITH PASSWORD 'your-new-password';"
```

Then update `DATABASE_URL` in `docker-compose.yml` to match and run
`docker compose up -d app`.

**`Error: ... .slice is not a function` on `/api/v1/employees`** — a
timestamp reached the frontend as a `Date` object instead of a string.
Fixed in `server/index.js` via the `toIso()` / `toIsoDate()` helpers; make
sure the running image includes it (`docker compose up -d --build`).

---

# Why PostgreSQL?

- Real transactions and real indices — handles thousands of employees
  without the "load the whole JSON file into memory" tax.
- `pg_dump` / `pg_restore` for battle-tested backups.
- The trust boundary is still the office network; Postgres isn't exposed
  to the host.
