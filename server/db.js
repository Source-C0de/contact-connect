// ContactHub Postgres helpers
// - One shared connection pool (DATABASE_URL env var, or default localhost).
// - `initSchema()` is idempotent and runs once at import time.
// - `query(text, params)` is a thin wrapper around pool.query.
// - `withTx(fn)` runs fn inside BEGIN/COMMIT (ROLLBACK on throw).
// - `getSetting(key)` / `setSetting(key, value)` back the `settings(key, value)`
//   key/value table; this is where the session secret + future toggles live.

import pg from 'pg';

const DEFAULT_LOCAL_URL = 'postgres://contacthub:contacthub@localhost:5432/contacthub';
const DATABASE_URL = process.env.DATABASE_URL || DEFAULT_LOCAL_URL;

export const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  // Surface idle-client errors so they show up in `docker compose logs`
  // instead of silently killing background connections.
  console.error('[pg pool] idle client error:', err.message);
});

export async function query(text, params) {
  return pool.query(text, params);
}

export async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

// Idempotent schema. Safe to run on every boot. New tables/columns should be
// added here with `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN
// IF NOT EXISTS` so existing data is preserved across deploys.
export async function initSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id              TEXT PRIMARY KEY,
      email           TEXT NOT NULL UNIQUE,
      name            TEXT NOT NULL,
      role            TEXT NOT NULL DEFAULT 'user',
      password_hash   TEXT NOT NULL,
      is_active       BOOLEAN NOT NULL DEFAULT TRUE,
      last_login      TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS departments (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL UNIQUE,
      color           TEXT NOT NULL DEFAULT '#3B82F6',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS employees (
      id              TEXT PRIMARY KEY,
      full_name       TEXT NOT NULL,
      job_title       TEXT NOT NULL DEFAULT '',
      department_name TEXT,
      work_email      TEXT NOT NULL UNIQUE,
      extension       TEXT NOT NULL DEFAULT '',
      mobile          TEXT NOT NULL DEFAULT '',
      office_location TEXT NOT NULL DEFAULT '',
      is_active       BOOLEAN NOT NULL DEFAULT TRUE,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS employees_dept_idx ON employees (department_name);
    CREATE INDEX IF NOT EXISTS employees_active_idx ON employees (is_active);

    CREATE TABLE IF NOT EXISTS sync_logs (
      id                TEXT PRIMARY KEY,
      sync_type         TEXT NOT NULL,
      status            TEXT NOT NULL,
      records_affected  INTEGER NOT NULL DEFAULT 0,
      error_message     TEXT,
      started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS sync_logs_started_idx ON sync_logs (started_at DESC);

    CREATE TABLE IF NOT EXISTS activity_logs (
      id           TEXT PRIMARY KEY,
      user_email   TEXT NOT NULL,
      action       TEXT NOT NULL,
      entity_type  TEXT NOT NULL,
      entity_id    TEXT,
      details      JSONB,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS activity_logs_created_idx ON activity_logs (created_at DESC);

    -- Singleton row (id=1) holds the current session policy.
    CREATE TABLE IF NOT EXISTS session_settings (
      id          SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      payload     JSONB NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Free-form key/value bag for things like the session secret.
    CREATE TABLE IF NOT EXISTS settings (
      key    TEXT PRIMARY KEY,
      value  JSONB NOT NULL
    );
  `);
}

// ---- Settings KV ------------------------------------------------------------

export async function getSetting(key) {
  const { rows } = await query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows[0]?.value ?? null;
}

export async function setSetting(key, value) {
  await query(
    `INSERT INTO settings (key, value)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)],
  );
}
