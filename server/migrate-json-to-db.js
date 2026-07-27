// One-shot importer: reads server/data.json (or $DATA_FILE) and inserts every
// row into Postgres. Idempotent via `INSERT ... ON CONFLICT (id) DO NOTHING`
// so re-runs are safe. Exits non-zero if the `users` table is already
// populated — protects against an accidental double-import by an operator.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSchema, pool, withTx } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');

function readDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    console.error(`No data file at ${DATA_FILE} — nothing to migrate.`);
    process.exit(1);
  }
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Could not parse ${DATA_FILE}:`, err.message);
    process.exit(1);
  }
}

function isoOrNull(v) {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function isoOrNow(v) {
  const t = isoOrNull(v);
  return t || new Date().toISOString();
}

async function main() {
  await initSchema();

  // Guard: refuse to run if users already exist. The operator can override
  // with FORCE_MIGRATE=1 once they've reviewed the existing rows.
  const { rows: existing } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  if (existing[0].n > 0 && !process.env.FORCE_MIGRATE) {
    console.error(
      `Refusing to migrate: users table already has ${existing[0].n} row(s).\n` +
        'If you really want to re-run, set FORCE_MIGRATE=1 (will skip duplicates).',
    );
    process.exit(2);
  }

  const data = readDataFile();
  let userCount = 0, deptCount = 0, empCount = 0, syncCount = 0, actCount = 0;

  await withTx(async (client) => {
    // ---- users ----
    for (const u of data.users || []) {
      await client.query(
        `INSERT INTO users (id, email, name, role, password_hash, is_active, last_login, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO NOTHING`,
        [
          u.id,
          u.email,
          u.name,
          u.role || 'user',
          u.passwordHash,
          u.isActive !== false,
          isoOrNull(u.lastLogin),
          isoOrNow(u.createdAt),
        ],
      );
      userCount++;
    }

    // ---- departments ----
    for (const d of data.departments || []) {
      await client.query(
        `INSERT INTO departments (id, name, color, created_at)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO NOTHING`,
        [d.id, d.name, d.color || '#3B82F6', isoOrNow(d.createdAt)],
      );
      deptCount++;
    }

    // ---- employees ----
    for (const e of data.employees || []) {
      await client.query(
        `INSERT INTO employees (
            id, full_name, job_title, department_name, work_email,
            extension, mobile, office_location, is_active,
            created_at, updated_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO NOTHING`,
        [
          e.id,
          (e.fullName || '').trim(),
          e.jobTitle || '',
          e.departmentName || null,
          e.workEmail,
          e.extension || '',
          e.mobile || '',
          e.officeLocation || '',
          e.isActive !== false,
          isoOrNow(e.createdAt),
          isoOrNow(e.updatedAt || e.createdAt),
        ],
      );
      empCount++;
    }

    // ---- sync logs ----
    for (const s of data.syncLogs || []) {
      await client.query(
        `INSERT INTO sync_logs (
            id, sync_type, status, records_affected, error_message,
            started_at, completed_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO NOTHING`,
        [
          s.id,
          s.sync_type || s.syncType || 'unknown',
          s.status || 'unknown',
          s.records_affected ?? s.recordsAffected ?? 0,
          s.error_message || s.errorMessage || null,
          isoOrNow(s.started_at || s.startedAt),
          isoOrNow(s.completed_at || s.completedAt || s.started_at || s.startedAt),
        ],
      );
      syncCount++;
    }

    // ---- activity logs ----
    for (const l of data.activityLogs || []) {
      await client.query(
        `INSERT INTO activity_logs (id, user_email, action, entity_type, entity_id, details, created_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
         ON CONFLICT (id) DO NOTHING`,
        [
          l.id,
          l.userEmail || l.user_email || 'system',
          l.action,
          l.entityType || l.entity_type || 'unknown',
          l.entityId || l.entity_id || null,
          JSON.stringify(l.details ?? null),
          isoOrNow(l.createdAt || l.created_at),
        ],
      );
      actCount++;
    }

    // ---- session settings (singleton) ----
    if (data.sessionSettings) {
      await client.query(
        `INSERT INTO session_settings (id, payload, updated_at)
         VALUES (1, $1::jsonb, NOW())
         ON CONFLICT (id) DO UPDATE
           SET payload = EXCLUDED.payload, updated_at = NOW()`,
        [JSON.stringify(data.sessionSettings)],
      );
    }

    // ---- session secret (stored in settings KV) ----
    if (data.sessionSecret) {
      await client.query(
        `INSERT INTO settings (key, value)
         VALUES ('sessionSecret', to_jsonb($1::text))
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [data.sessionSecret],
      );
    }
  });

  console.log('✅ Migration complete:');
  console.log(`   users        : ${userCount}`);
  console.log(`   departments  : ${deptCount}`);
  console.log(`   employees    : ${empCount}`);
  console.log(`   sync_logs    : ${syncCount}`);
  console.log(`   activity_logs: ${actCount}`);
  await pool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});