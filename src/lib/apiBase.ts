/**
 * Single source of truth for the API base URL.
 *
 * Resolution order:
 *  1. `VITE_API_URL` — explicit override (set at build time, or in `.env`).
 *  2. Production (`import.meta.env.PROD`) — the SPA and the API are served by
 *     the same Node process (Docker / `npm run server:start`), so the API
 *     lives on the SAME origin as the page. No port suffix.
 *  3. Development — Vite serves the SPA on :5173 while the API server runs on
 *     its own port, so we append `VITE_API_PORT` (default 8090).
 *
 * The port is configurable because the default 8080/8090 are inside the
 * Windows excluded-port range 8009-8108 on some machines.
 */
const DEV_API_PORT = (import.meta.env.VITE_API_PORT as string | undefined) || '8090';

export const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ||
  (import.meta.env.PROD
    ? `${window.location.protocol}//${window.location.host}/api/v1`
    : `${window.location.protocol}//${window.location.hostname}:${DEV_API_PORT}/api/v1`);

export default API_BASE_URL;
