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

## Why no database?

- Zero install on a fresh office PC.
- Single file = trivial backup (`copy server\data.json backup.json`).
- Safe because the trust boundary is the office network itself.

## Why the login wasn't working

The previous build pointed at `http://localhost:8080/api/v1` but no such
server existed, so every `POST /auth/login` returned a network error.
This repo now ships that server (`server/index.js`) and `api.ts` falls back
to localStorage if it's not running, so login works in either mode.
