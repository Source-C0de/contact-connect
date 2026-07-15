---
name: docker-bugfix
description: Diagnose and fix Docker / Docker Compose runtime and build issues in ContactHub without introducing regressions — covers image build, container start, healthcheck failures, named-volume persistence, port binding, and the LAN/static-serve contract between `Dockerfile`, `docker-compose.yml`, and `server/index.js`.
whenToUse: Use when the user reports any Docker-related issue in this repo: image build failures, container exits immediately, `docker compose up` errors, healthcheck failing, port already in use, "address already in use", named volume not persisting, `data.json` not surviving restart, "ENOENT" inside the container, `STATIC_DIR` not found, "permission denied" on `/data`, SPA loads but `/api/v1/*` 404s, or the LAN server can't reach the API.
argumentHint: "<docker symptom or paste of error output>"
---

# Docker Bugfix for ContactHub (issue-free)

Workflow for triaging and fixing Docker / Docker Compose issues in this
repo. The Docker surface is small but tightly coupled: a change in one
file can silently break another. This skill enforces a **read-first,
narrow-fix** approach so we don't trade one bug for two.

## When to invoke this skill

Trigger on any user message that mentions Docker, container, image,
`docker compose`, `docker-compose`, healthcheck, volume, port 8090, or
quotes a stack trace originating from inside a container. Also trigger
when the user says the prod build "works in dev but not in Docker" or
vice versa.

## Steps

1. **Capture the symptom verbatim.** Before changing anything, restate
   the user's report in one sentence and list every concrete signal:
   error message, container status (`docker compose ps`), exit code,
   log tail (`docker compose logs --tail=200 app`), host OS, Docker
   version (`docker version`), and whether it was a fresh build or an
   upgrade. NEVER guess — Docker bugs almost always have a literal
   error string that pins the cause.

2. **Read the three Docker artifacts in order.** Do NOT edit until
   you've re-read all three (their canonical contents are below in
   "Reference state"):
   - `Dockerfile` — multi-stage `node:20-alpine`, builder + runner,
     `tini`, healthcheck, `/data` mkdir, runs as `node` user.
   - `docker-compose.yml` — single `app` service, named volume
     `contacthub-data` mounted at `/data`, port `8090:8090`, env
     `NODE_ENV=production PORT=8090 HOST=0.0.0.0
     DATA_FILE=/data/data.json`.
   - `server/index.js` — `STATIC_DIR` env-driven, falls back to
     `../dist` in production, `loadData()` calls
     `fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true })`,
     health probe at `/api/v1/health`.

3. **Categorize the bug.** Match the symptom to one of these buckets
   before proposing a fix — the fix is bucket-specific:

   | Bucket | Symptom signature | Likely root cause |
   |---|---|---|
   | A. Build fails | `docker compose build` exits non-zero, `npm ci`/`npm run build` errors in builder stage | Missing `package-lock.json`, lockfile drift, network in builder, copy-context misorder |
   | B. Container exits immediately | `docker compose ps` shows `Exit 1`/`Exit 137` within seconds | `server/index.js` thrown error at boot, missing `/data` dir, bad DATA_FILE path, port in use |
   | C. Healthcheck failing | `(unhealthy)` after 30s | API not listening on `0.0.0.0`, app threw after healthcheck window, healthcheck URL wrong |
   | D. Port conflict | `bind: address already in use` | Another process on host holds 8090, or `HOST` env not `0.0.0.0` inside container |
   | E. data.json not persisting | After `docker compose down && up -d`, users/employees gone | A `bind mount` overriding the named volume, or `DATA_FILE` pointing outside `/data` |
   | F. SPA loads but API 404s in browser | `GET /api/v1/admin/users` 404s when opening the app via `http://<host>:8090` | Frontend hard-codes `localhost`, or static-serve is intercepting `/api/*` (it must not — see "Reference state" order) |
   | G. Permission denied on /data | `EACCES` writing `/data/data.json` | Image ran as `root` (we shouldn't — see USER node), or volume mounted from a host dir owned by another uid |
   | H. Old tokens invalidated after restart | Login works once then 401s on refresh | `sessionSecret` not in `data.json` (it should auto-persist via `loadData`) |

4. **Fix narrowly.** For each bucket, apply the smallest possible
   change. Do NOT "improve" unrelated files while you're in there —
   that is how new bugs appear. The reference state below is what
   "correct" looks like; deviation should be one-line.

5. **Validate end-to-end.** After the fix, run from the project root:

   ```bash
   docker compose build          # no warnings/errors
   docker compose up -d
   docker compose ps             # status = "healthy" within ~15s
   curl -fsS http://localhost:8090/api/v1/health
   # {"ok":true,"ts":"..."}
   curl -fsSI http://localhost:8090/  # 200 + text/html
   ```

   Then the data-persistence smoke test:

   ```bash
   docker compose exec app ls -la /data      # data.json exists, owned by node
   docker compose down
   docker compose up -d
   docker compose exec app cat /data/data.json | head -c 200
   # same content as before the down/up cycle
   ```

6. **Document the fix in your final reply.** Include:
   - The original symptom (verbatim quote if possible)
   - The bucket letter from step 3
   - The exact file + line changed
   - The verification commands run and their outputs
   - Anything deliberately **not** changed and why

## Reference state (canonical)

These are the contracts the rest of the codebase relies on. Keep them
intact unless the bug literally proves one is wrong:

- **`Dockerfile`** — `node:20-alpine` builder does `npm ci` then
  `npm run build`; runner copies `dist/` and `server/`, runs as
  `node` user with `tini` as PID 1, pre-creates `/data`, exposes
  `8090`, healthcheck hits `/api/v1/health`.
- **`docker-compose.yml`** — service `app`, port `8090:8090`, env
  sets `DATA_FILE=/data/data.json`, named volume `contacthub-data`
  mounted at `/data`, `restart: unless-stopped`.
- **`server/index.js`** — `STATIC_DIR` resolves from env or
  `../dist` when `NODE_ENV=production`; SPA serve is registered
  **after** all `/api/v1/*` routes so the API always wins;
  `loadData()` calls `fs.mkdirSync(path.dirname(DATA_FILE),
  { recursive: true })` so the volume's empty mount doesn't crash.

## Inputs

- `{{argument}}` — the user's symptom, ideally the verbatim error
  message or output of `docker compose logs --tail=200 app`.

## Output

- One minimal edit to `Dockerfile`, `docker-compose.yml`,
  `.dockerignore`, or `server/index.js` (rare)
- Container reaches `(healthy)` state
- `curl http://localhost:8090/api/v1/health` returns `{"ok":true,...}`
- `data.json` survives a `down` + `up` cycle
- A short written summary mapping symptom → bucket → fix → verification

## Examples

- `/docker-bugfix container exits with code 1 right after start, logs say "EADDRINUSE :::8090"`
  → Bucket D. The container's `HOST` is `0.0.0.0` but the host
    machine has another process on 8090. Fix: change the host port
    in `docker-compose.yml` (e.g. `"18090:8090"`) and document the
    new URL, OR kill the conflicting host process. Verify with
    `docker compose ps` → `(healthy)` and `curl localhost:8090/api/v1/health`.

- `/docker-bugfix healthcheck stays unhealthy, logs are clean`
  → Bucket C. Usually means the healthcheck URL or interval is off,
    or the app is listening on a different port. Re-read the
    Dockerfile HEALTHCHECK block; confirm `process.env.PORT` inside
    the container matches the `app.listen` port (`8090`).

- `/docker-bugfix every restart wipes all users`
  → Bucket E. The `data.json` is being written somewhere that's
    not in the named volume. Verify with `docker compose exec app
    ls -la /data` after a write; if `data.json` is elsewhere, fix
    `DATA_FILE` in `docker-compose.yml` to `/data/data.json` and
    remove any conflicting host `bind mount`.

- `/docker-bugfix SPA loads at http://host:8090 but login fails with 404`
  → Bucket F. The static-serve middleware is matching `/api/*`.
    Confirm `app.use(express.static(...))` is registered **after**
    every `app.get/post/patch('/api/v1/...')` route in
    `server/index.js`. Reorder if needed; rebuild; verify with
    `curl -i http://localhost:8090/api/v1/health` (should be 200,
    not the SPA's index.html).

- `/docker-bugfix build fails with "Cannot find module 'express'" in builder`
  → Bucket A. The `npm --prefix server ci --omit=dev` line in the
    Dockerfile needs `server/package-lock.json` in the build
    context. If the lockfile was deleted or never committed, either
    commit it (preferred) or change the Dockerfile to fall back to
    `npm install --omit=dev`.

- `/docker-bugfix EACCES writing /data/data.json`
  → Bucket G. The named volume was previously written as `root`,
    and now the `node` user can't overwrite. Fix: `docker compose
    down -v` (destroys the volume — DATA LOSS) then `up -d`, OR
    `docker compose exec -u root app chown -R node:node /data`.
    Prefer the chown approach unless the user explicitly wants to
    reseed.

- `/docker-bugfix after every restart I have to log in again`
  → Bucket H. The `sessionSecret` isn't surviving. Verify
    `docker compose exec app grep sessionSecret /data/data.json`
    shows a stable value across two restarts. If it changes, the
    volume isn't actually mounted at `/data` — check
    `docker compose config` for the volumes section.