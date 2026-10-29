// Loads the repo-root `.env` into `process.env`.
//
// This MUST be imported before `db.js` (which captures `DATABASE_URL` at
// module-evaluation time) — ESM hoists imports, so `import './env.js'`
// placed above the `db.js` import guarantees the env is populated first.
//
// Real environment variables always take precedence over `.env` values, and
// a missing `.env` file is not an error (Docker/Compose injects real env vars).

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadEnv() {
  const envFile = process.env.ENV_FILE || path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envFile)) return false;
  try {
    process.loadEnvFile(envFile);
    return true;
  } catch {
    // Malformed .env — ignore and fall back to process.env defaults.
    return false;
  }
}

loadEnv();
