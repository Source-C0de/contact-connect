// ContactHub LAN server
// - Single source of truth: PostgreSQL (see server/db.js).
// - Bound to 0.0.0.0 so other machines on the office network can reach us.
// - Stateless auth: a signed session token (HMAC) is returned by /auth/login.

import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Side-effect import: loads the repo-root `.env` into process.env BEFORE
// `db.js` captures DATABASE_URL. Must stay above the db.js import.
import './env.js';
import { initSchema, pool, query, withTx, getSetting, setSetting } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8090);
const HOST = process.env.HOST || '0.0.0.0'; // listen on every interface so the LAN can reach us
// Legacy: data.json is only read by the one-shot `migrate` script now.
// Kept as an env var for backwards compatibility / migration tooling.
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
// In production (Docker) we serve the React build out of ../../dist. In dev
// we leave this empty so the Vite dev server (port 5173) is the source of
// truth for the SPA. STATIC_DIR lets you point at any absolute path.
const STATIC_DIR = process.env.STATIC_DIR
  || (process.env.NODE_ENV === 'production'
    ? path.resolve(__dirname, '..', 'dist')
    : '');

// The session secret is generated on first boot and stored in the
// `settings` table (key = 'sessionSecret') so that restarting the server
// does NOT invalidate every logged-in token. You can override with the
// SESSION_SECRET env var for the very first boot.
function generateSecret() {
  return crypto.randomBytes(32).toString('base64url');
}
let SESSION_SECRET = process.env.SESSION_SECRET || null;

const DEFAULT_SESSION_SETTINGS = {
  inactivityTimeoutMinutes: 30,
  logoutOnBrowserClose: false,
};

// ---------------- Password hashing ----------------
// We use a salted SHA-256 hash. This is NOT bcrypt-grade; it's enough to avoid
// storing plaintext on an office LAN. Anyone with shell on the host already
// has access, so the threat model is "don't leak the password on a casual
// disk read".

function hashPassword(password) {
  const salt = 'contacthub-static-salt';
  return crypto.createHash('sha256').update(salt + password).digest('hex');
}

function verifyPassword(password, hash) {
  try {
    return crypto.timingSafeEqual(
      Buffer.from(hashPassword(password), 'hex'),
      Buffer.from(hash, 'hex'),
    );
  } catch {
    return false;
  }
}

// ---------------- Session tokens ----------------
// Stateless: base64(JSON).{HMAC}. base64 payload is NOT encrypted, only signed.
// Sufficient for a LAN app where the network is the trust boundary.

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(body)
    .digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return null;
    }
  } catch {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const session = verifyToken(token);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.session = session;
  next();
}

function adminOnly(req, res, next) {
  if (req.session?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}

// ---------------- Row mappers ----------------
// The DB returns snake_case rows; the HTTP contract is camelCase. These
// helpers normalize once at the edge so route handlers stay readable.

/**
 * Normalize a Postgres timestamp to an ISO-8601 string.
 *
 * The `pg` driver parses `timestamp with time zone` columns into JS `Date`
 * objects. `Date` has no `.slice()`, so calling string methods on a raw
 * column throws `... .slice is not a function`. Passing a `Date` straight
 * to `res.json()` happens to work (JSON.stringify calls toJSON), but the
 * value differs between ISO strings and Date objects depending on the code
 * path — so we normalize every timestamp explicitly, in one place.
 *
 * Accepts: Date | ISO string | epoch number | null/undefined.
 */
function toIso(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toISOString();
  }
  return null;
}

/** Normalize a timestamp to a plain `YYYY-MM-DD` date string. */
function toIsoDate(value) {
  const iso = toIso(value);
  return iso ? iso.slice(0, 10) : null;
}

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    isActive: u.is_active,
    lastLogin: toIso(u.last_login),
    createdAt: toIso(u.created_at),
  };
}

async function logActivity(actorEmail, action, entityType, entityId, details = null) {
  await query(
    `INSERT INTO activity_logs (id, user_email, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      `log-${crypto.randomBytes(6).toString('hex')}`,
      actorEmail,
      action,
      entityType,
      entityId,
      JSON.stringify(details ?? null),
    ],
  );
  // Trim activity_logs to the last 500 rows so it doesn't grow unbounded.
  await query(
    `DELETE FROM activity_logs
     WHERE id IN (
       SELECT id FROM activity_logs
       ORDER BY created_at DESC
       OFFSET 500
     )`,
  );
}

// ---------------- Express app ----------------

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Async route helper so we can `throw` inside handlers and surface 500s.
const ah = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

app.get('/api/v1/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ---- Auth ----

app.post('/api/v1/auth/login', ah(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const { rows } = await query(
    'SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
    [String(email)],
  );
  const user = rows[0];
  if (!user || !user.is_active || !verifyPassword(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const now = new Date().toISOString();
  await query('UPDATE users SET last_login = $1 WHERE id = $2', [now, user.id]);
  await logActivity(user.email, 'Login', 'session', user.id);

  const token = signToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    iat: Date.now(),
  });
  res.json({
    access_token: token,
    refresh_token: token,
    user: publicUser(user),
  });
}));

app.post('/api/v1/auth/logout', authMiddleware, ah(async (req, res) => {
  await logActivity(req.session.email, 'Logout', 'session', req.session.sub);
  res.json({ ok: true });
}));

app.get('/api/v1/auth/me', authMiddleware, ah(async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.session.sub]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    user_id: user.id,
    email: user.email,
    role: user.role,
  });
}));

app.put('/api/v1/auth/password', authMiddleware, ah(async (req, res) => {
  const { old_password, new_password } = req.body || {};
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.session.sub]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!verifyPassword(old_password || '', user.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [
    hashPassword(new_password),
    user.id,
  ]);
  await logActivity(user.email, 'Updated', 'user', user.id, { field: 'password' });
  res.json({ ok: true });
}));

// ---- Employees ----

// departmentName → departmentId (cached per request to avoid N roundtrips).
async function buildDeptIndex() {
  const { rows } = await query('SELECT id, name FROM departments');
  const idx = new Map();
  for (const d of rows) idx.set(d.name, d.id);
  return idx;
}

function employeeToFrontend(e, deptIndex) {
  return {
    id: e.id,
    fullName: e.full_name,
    jobTitle: e.job_title,
    department: e.department_name,
    departmentId: deptIndex.get(e.department_name) || null,
    email: e.work_email,
    extension: e.extension,
    mobile: e.mobile || '',
    location: e.office_location || '',
    status: e.is_active ? 'active' : 'inactive',
    onlineStatus: e.is_active ? 'online' : 'offline',
    dateAdded: toIsoDate(e.created_at) || toIsoDate(new Date()),
  };
}

function employeeToBackend(body, deptIndex) {
  return {
    full_name: body.fullName || body.full_name || '',
    job_title: body.jobTitle || body.job_title || '',
    department_name:
      body.department ||
      (body.department_id ? [...deptIndex.entries()].find(([, id]) => id === body.department_id)?.[0] : '') ||
      '',
    work_email: body.email || body.work_email || '',
    extension: body.extension || '',
    mobile: body.mobile || '',
    office_location: body.location || body.office_location || '',
    is_active: body.isActive !== undefined
      ? !!body.isActive
      : body.status !== 'inactive',
  };
}

app.get('/api/v1/employees', authMiddleware, ah(async (req, res) => {
  const { search, department_id, is_active } = req.query;
  const deptIndex = await buildDeptIndex();
  const conds = [];
  const args = [];
  if (search) {
    args.push(`%${String(search).toLowerCase()}%`);
    const i = args.length;
    conds.push(
      `(LOWER(full_name) LIKE $${i} OR LOWER(work_email) LIKE $${i}` +
        ` OR LOWER(job_title) LIKE $${i} OR extension LIKE $${i})`,
    );
  }
  if (department_id) {
    args.push(department_id);
    const i = args.length;
    conds.push(`department_name = (SELECT name FROM departments WHERE id = $${i})`);
  }
  if (is_active !== undefined) {
    args.push(is_active === 'true');
    conds.push(`is_active = $${args.length}`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT * FROM employees ${where} ORDER BY full_name`,
    args,
  );
  res.json({
    data: rows.map((e) => employeeToFrontend(e, deptIndex)),
    total: rows.length,
    page: 1,
    page_size: rows.length,
    total_pages: 1,
  });
}));

app.get('/api/v1/employees/:id', authMiddleware, ah(async (req, res) => {
  const { rows } = await query('SELECT * FROM employees WHERE id = $1', [req.params.id]);
  const emp = rows[0];
  if (!emp) return res.status(404).json({ error: 'Not found' });
  const deptIndex = await buildDeptIndex();
  res.json(employeeToFrontend(emp, deptIndex));
}));

app.post('/api/v1/employees', authMiddleware, adminOnly, ah(async (req, res) => {
  const deptIndex = await buildDeptIndex();
  const b = employeeToBackend(req.body || {}, deptIndex);
  if (!b.full_name || !b.work_email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }
  const id = `e-${crypto.randomBytes(6).toString('hex')}`;
  const now = new Date().toISOString();
  const { rows } = await query(
    `INSERT INTO employees (
        id, full_name, job_title, department_name, work_email,
        extension, mobile, office_location, is_active,
        created_at, updated_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
     RETURNING *`,
    [
      id, b.full_name, b.job_title, b.department_name || null, b.work_email,
      b.extension, b.mobile, b.office_location, b.is_active, now,
    ],
  );
  await logActivity(req.session.email, 'Created', 'employee', id, {
    name: b.full_name,
  });
  res.json(employeeToFrontend(rows[0], deptIndex));
}));

app.put('/api/v1/employees/:id', authMiddleware, adminOnly, ah(async (req, res) => {
  const deptIndex = await buildDeptIndex();
  const b = employeeToBackend(req.body || {}, deptIndex);
  const now = new Date().toISOString();
  const { rows } = await query(
    `UPDATE employees
        SET full_name = $2,
            job_title = $3,
            department_name = $4,
            work_email = $5,
            extension = $6,
            mobile = $7,
            office_location = $8,
            is_active = $9,
            updated_at = $10
      WHERE id = $1
      RETURNING *`,
    [
      req.params.id, b.full_name, b.job_title, b.department_name || null,
      b.work_email, b.extension, b.mobile, b.office_location, b.is_active, now,
    ],
  );
  const emp = rows[0];
  if (!emp) return res.status(404).json({ error: 'Not found' });
  await logActivity(req.session.email, 'Updated', 'employee', emp.id, {
    name: emp.full_name,
  });
  res.json(employeeToFrontend(emp, deptIndex));
}));

app.delete('/api/v1/employees/:id', authMiddleware, adminOnly, ah(async (req, res) => {
  const { rows } = await query(
    'DELETE FROM employees WHERE id = $1 RETURNING id, full_name',
    [req.params.id],
  );
  const removed = rows[0];
  if (!removed) return res.status(404).json({ error: 'Not found' });
  await logActivity(req.session.email, 'Deleted', 'employee', removed.id, {
    name: removed.full_name,
  });
  res.json({ ok: true });
}));

// ---- Departments ----

app.get('/api/v1/departments', authMiddleware, ah(async (_req, res) => {
  const { rows } = await query(`
    SELECT d.id, d.name, d.color,
           COALESCE(SUM(CASE WHEN e.is_active THEN 1 ELSE 0 END), 0)::int AS employee_count
      FROM departments d
      LEFT JOIN employees e ON e.department_name = d.name
     GROUP BY d.id, d.name, d.color
     ORDER BY d.name
  `);
  res.json(
    rows.map((d) => ({
      id: d.id,
      name: d.name,
      color: d.color,
      employeeCount: d.employee_count,
    })),
  );
}));

app.post('/api/v1/departments', authMiddleware, adminOnly, ah(async (req, res) => {
  const name = (req.body?.name || '').trim();
  const color = req.body?.color || '#3B82F6';
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const { rows: existing } = await query(
    'SELECT id FROM departments WHERE LOWER(name) = LOWER($1) LIMIT 1',
    [name],
  );
  if (existing.length) return res.status(400).json({ error: 'Department already exists' });
  const id = `d-${crypto.randomBytes(6).toString('hex')}`;
  await query(
    'INSERT INTO departments (id, name, color) VALUES ($1, $2, $3)',
    [id, name, color],
  );
  await logActivity(req.session.email, 'Created', 'department', id, { name });
  res.json({ id, name, color, employeeCount: 0 });
}));

app.put('/api/v1/departments/:id', authMiddleware, adminOnly, ah(async (req, res) => {
  const { rows } = await query('SELECT * FROM departments WHERE id = $1', [req.params.id]);
  const dept = rows[0];
  if (!dept) return res.status(404).json({ error: 'Not found' });
  if (req.body?.name) dept.name = String(req.body.name).trim();
  if (req.body?.color) dept.color = req.body.color;
  await query(
    'UPDATE departments SET name = $1, color = $2 WHERE id = $3',
    [dept.name, dept.color, dept.id],
  );
  const { rows: countRows } = await query(
    `SELECT COUNT(*)::int AS n FROM employees
       WHERE department_name = $1 AND is_active = TRUE`,
    [dept.name],
  );
  await logActivity(req.session.email, 'Updated', 'department', dept.id, { name: dept.name });
  res.json({ id: dept.id, name: dept.name, color: dept.color, employeeCount: countRows[0].n });
}));

app.delete('/api/v1/departments/:id', authMiddleware, adminOnly, ah(async (req, res) => {
  const { rows } = await query(
    'DELETE FROM departments WHERE id = $1 RETURNING id, name',
    [req.params.id],
  );
  const removed = rows[0];
  if (!removed) return res.status(404).json({ error: 'Not found' });
  // Null out department on employees that referenced this one.
  await query('UPDATE employees SET department_name = NULL WHERE department_name = $1', [
    removed.name,
  ]);
  await logActivity(req.session.email, 'Deleted', 'department', removed.id, {
    name: removed.name,
  });
  res.json({ ok: true });
}));

// ---- Admin: users ----

app.get('/api/v1/admin/users', authMiddleware, adminOnly, ah(async (_req, res) => {
  const { rows } = await query(
    'SELECT * FROM users ORDER BY created_at DESC',
  );
  res.json(rows.map(publicUser));
}));

app.post('/api/v1/admin/users/invite', authMiddleware, adminOnly, ah(async (req, res) => {
  const { email, role, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const { rows: existing } = await query(
    'SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
    [email],
  );
  if (existing.length) return res.status(400).json({ error: 'User already exists' });
  const id = `u-${crypto.randomBytes(6).toString('hex')}`;
  const { rows } = await query(
    `INSERT INTO users (id, email, name, role, password_hash, is_active)
     VALUES ($1, $2, $3, $4, $5, TRUE)
     RETURNING *`,
    [
      id,
      email,
      String(email).split('@')[0],
      role === 'admin' ? 'admin' : 'user',
      hashPassword(password),
    ],
  );
  await logActivity(req.session.email, 'Created', 'user', id, { email });
  res.json(publicUser(rows[0]));
}));

app.patch('/api/v1/admin/users/:id/role', authMiddleware, adminOnly, ah(async (req, res) => {
  const role = req.body?.role === 'admin' ? 'admin' : 'user';
  const { rows } = await query(
    'UPDATE users SET role = $1 WHERE id = $2 RETURNING *',
    [role, req.params.id],
  );
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'Not found' });
  await logActivity(req.session.email, 'Updated', 'user', user.id, {
    field: 'role',
    value: role,
  });
  res.json(publicUser(user));
}));

app.patch('/api/v1/admin/users/:id/deactivate', authMiddleware, adminOnly, ah(async (req, res) => {
  const { rows } = await query(
    'UPDATE users SET is_active = FALSE WHERE id = $1 RETURNING *',
    [req.params.id],
  );
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'Not found' });
  await logActivity(req.session.email, 'Deactivated', 'user', user.id);
  res.json(publicUser(user));
}));

app.patch('/api/v1/admin/users/:id/password', authMiddleware, adminOnly, ah(async (req, res) => {
  if (!req.body?.password || req.body.password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const { rows } = await query(
    'UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING *',
    [hashPassword(req.body.password), req.params.id],
  );
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'Not found' });
  await logActivity(req.session.email, 'Updated', 'user', user.id, { field: 'password' });
  res.json(publicUser(user));
}));

app.get('/api/v1/admin/session-settings', authMiddleware, adminOnly, ah(async (_req, res) => {
  const payload = await getSessionSettings();
  res.json({
    id: 'session-settings',
    inactivity_timeout_minutes: payload.inactivityTimeoutMinutes,
    logout_on_browser_close: payload.logoutOnBrowserClose,
  });
}));

app.patch('/api/v1/admin/session-settings', authMiddleware, adminOnly, ah(async (req, res) => {
  const payload = await getSessionSettings();
  if (typeof req.body?.inactivity_timeout_minutes === 'number') {
    payload.inactivityTimeoutMinutes = req.body.inactivity_timeout_minutes;
  }
  if (typeof req.body?.logout_on_browser_close === 'boolean') {
    payload.logoutOnBrowserClose = req.body.logout_on_browser_close;
  }
  await query(
    `INSERT INTO session_settings (id, payload, updated_at)
     VALUES (1, $1::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE
       SET payload = EXCLUDED.payload, updated_at = NOW()`,
    [JSON.stringify(payload)],
  );
  res.json({
    id: 'session-settings',
    inactivity_timeout_minutes: payload.inactivityTimeoutMinutes,
    logout_on_browser_close: payload.logoutOnBrowserClose,
  });
}));

async function getSessionSettings() {
  const { rows } = await query('SELECT payload FROM session_settings WHERE id = 1');
  if (!rows.length) {
    return { ...DEFAULT_SESSION_SETTINGS };
  }
  return { ...DEFAULT_SESSION_SETTINGS, ...rows[0].payload };
}

app.get('/api/v1/admin/dashboard', authMiddleware, adminOnly, ah(async (_req, res) => {
  const [{ rows: empRows }, { rows: deptRows }, { rows: userRows }, { rows: actRows }] =
    await Promise.all([
      query('SELECT COUNT(*)::int AS n FROM employees'),
      query('SELECT COUNT(*)::int AS n FROM departments'),
      query('SELECT COUNT(*)::int AS n FROM users WHERE is_active = TRUE'),
      query(
        `SELECT COUNT(*)::int AS n FROM activity_logs
          WHERE created_at > NOW() - INTERVAL '7 days'`,
      ),
    ]);
  res.json({
    total_employees: empRows[0].n,
    total_departments: deptRows[0].n,
    active_users: userRows[0].n,
    recent_activity: actRows[0].n,
  });
}));

// ---- Audit log ----

app.get('/api/v1/admin/audit-logs', authMiddleware, adminOnly, ah(async (_req, res) => {
  const { rows } = await query(
    'SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 500',
  );
  res.json(
    rows.map((l) => ({
      id: l.id,
      user_id: '',
      user_email: l.user_email,
      action: l.action,
      entity_type: l.entity_type,
      entity_id: l.entity_id,
      details: l.details,
      ip_address: '',
      created_at: toIso(l.created_at),
    })),
  );
}));

app.get('/api/v1/admin/audit-logs/export', authMiddleware, adminOnly, ah(async (_req, res) => {
  const { rows } = await query(
    'SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 500',
  );
  const lines = ['timestamp,actor,action,entity,target'];
  for (const l of rows) {
    const target = l.details?.name || l.details?.email || l.entity_id;
    lines.push(
      [
        toIso(l.created_at),
        l.user_email,
        l.action,
        l.entity_type,
        JSON.stringify(target || ''),
      ].join(','),
    );
  }
  res.type('text/csv').send(lines.join('\n'));
}));

// ---- Sync (no-op for LAN; just log attempts) ----

app.get('/api/v1/admin/sync/settings', authMiddleware, adminOnly, (_req, res) => {
  res.json([
    { id: 'outlook', sync_type: 'outlook', is_enabled: false, last_run: null, next_scheduled: null },
    { id: 'ucm', sync_type: 'ucm', is_enabled: false, last_run: null, next_scheduled: null },
  ]);
});

app.patch('/api/v1/admin/sync/settings/:type', authMiddleware, adminOnly, (_req, res) => {
  res.json({ ok: true, enabled: !!_req.body?.is_enabled });
});

app.post('/api/v1/admin/sync/run/:type', authMiddleware, adminOnly, ah(async (req, res) => {
  const id = `sync-${crypto.randomBytes(6).toString('hex')}`;
  const now = new Date().toISOString();
  const { rows } = await query(
    `INSERT INTO sync_logs (id, sync_type, status, records_affected, error_message, started_at, completed_at)
     VALUES ($1, $2, 'success', 0, NULL, $3, $3)
     RETURNING *`,
    [id, req.params.type, now],
  );
  const log = rows[0];
  await logActivity(req.session.email, 'Updated', 'sync', log.id, { type: req.params.type });
  res.json({
    id: log.id,
    sync_type: log.sync_type,
    status: log.status,
    records_affected: log.records_affected,
    error_message: log.error_message,
    started_at: toIso(log.started_at),
    completed_at: toIso(log.completed_at),
    created_at: toIso(log.started_at),
  });
}));

app.get('/api/v1/admin/sync/logs', authMiddleware, adminOnly, ah(async (_req, res) => {
  const { rows } = await query(
    'SELECT * FROM sync_logs ORDER BY started_at DESC LIMIT 100',
  );
  res.json(
    rows.map((s) => ({
      id: s.id,
      sync_type: s.sync_type,
      status: s.status,
      records_affected: s.records_affected,
      error_message: s.error_message,
      started_at: toIso(s.started_at),
      completed_at: toIso(s.completed_at),
      created_at: toIso(s.started_at),
    })),
  );
}));

// ---------------- Static SPA ----------------

// In production we serve the built React app from the same process so a
// single container can serve both the UI and the API. In dev this is skipped
// because the Vite dev server (port 5173) is the source of truth for the SPA.
if (STATIC_DIR && fs.existsSync(STATIC_DIR)) {
  app.use(express.static(STATIC_DIR, { maxAge: '1h', index: 'index.html' }));
  // SPA fallback: anything that isn't /api/* and didn't match a static file
  // should return index.html so client-side routes work after a hard reload.
  app.get(/^\/(?!api\/).*/, (_req, res, next) => {
    const indexPath = path.join(STATIC_DIR, 'index.html');
    if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
    next();
  });
  console.log(`Serving SPA from ${STATIC_DIR}`);
}

// Centralised error handler — anything `throw`n in an `ah(...)` handler lands
// here. Without this Express 4 returns an empty 500 with no body.
app.use((err, _req, res, _next) => {
  console.error('[server error]', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ---------------- Boot ----------------

async function bootstrap() {
  await initSchema();

  // First-boot seed: create the default admin user if the table is empty.
  const { rows: userCount } = await query('SELECT COUNT(*)::int AS n FROM users');
  if (userCount[0].n === 0) {
    const adminId = 'u-admin';
    await query(
      `INSERT INTO users (id, email, name, role, password_hash, is_active)
       VALUES ($1, $2, $3, 'admin', $4, TRUE)
       ON CONFLICT (id) DO NOTHING`,
      [
        adminId,
        'admin@corp.com',
        'Admin User',
        hashPassword('admin123'),
      ],
    );
    console.log('Seeded default admin user (admin@corp.com / admin123)');
  } else {
    console.log(`Users table not empty (${userCount[0].n} row(s)) — skipping admin seed.`);
  }

  // Seed default departments if empty.
  const { rows: deptCount } = await query('SELECT COUNT(*)::int AS n FROM departments');
  if (deptCount[0].n === 0) {
    const seed = [
      ['d-eng', 'Engineering', '#3B82F6'],
      ['d-sales', 'Sales', '#F59E0B'],
      ['d-hr', 'HR', '#EC4899'],
      ['d-fin', 'Finance', '#10B981'],
      ['d-it', 'IT', '#8B5CF6'],
      ['d-ops', 'Operations', '#F97316'],
    ];
    for (const [id, name, color] of seed) {
      await query(
        'INSERT INTO departments (id, name, color) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [id, name, color],
      );
    }
    console.log('Seeded default departments');
  }

  // Ensure session_settings singleton exists.
  await query(
    `INSERT INTO session_settings (id, payload, updated_at)
     VALUES (1, $1::jsonb, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(DEFAULT_SESSION_SETTINGS)],
  );

  // Resolve session secret: env > settings KV > generate.
  if (!SESSION_SECRET) {
    const fromDb = await getSetting('sessionSecret');
    if (typeof fromDb === 'string' && fromDb.length > 0) {
      SESSION_SECRET = fromDb;
    } else {
      SESSION_SECRET = generateSecret();
      await setSetting('sessionSecret', SESSION_SECRET);
      console.log('Generated and persisted a new session secret');
    }
  }
}

app.listen(PORT, HOST, async () => {
  try {
    await bootstrap();
  } catch (err) {
    console.error('Bootstrap failed:', err);
    process.exit(1);
  }
  console.log(`ContactHub server listening on http://${HOST}:${PORT}`);
  console.log('LAN URLs from this machine:');
  for (const iface of Object.values(os.networkInterfaces()).flat()) {
    if (iface && iface.family === 'IPv4' && !iface.internal) {
      console.log(`  http://${iface.address}:${PORT}`);
    }
  }
});

// Clean shutdown so pg closes idle sockets and Docker restart is graceful.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log(`Received ${sig}, shutting down…`);
    try { await pool.end(); } catch { /* ignore */ }
    process.exit(0);
  });
}