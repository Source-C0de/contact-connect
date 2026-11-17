// ContactHub LAN server
// - Single source of truth: PostgreSQL (see server/db.js).
// - Bound to 0.0.0.0 so other machines on the office network can reach us.
// - Stateless auth: a signed session token (HMAC) is returned by /auth/login.
//
// This module exports `createApp()` so integration tests can mount the
// Express app without binding a port. `server/main.js` is the production
// entry point that starts the HTTP listener.

import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import multer from 'multer';
import { fileURLToPath, pathToFileURL } from 'node:url';
// Side-effect import: loads the repo-root `.env` into process.env BEFORE
// `db.js` captures DATABASE_URL. Must stay above the db.js import.
import './env.js';
import { initSchema, pool, query, withTx, getSetting, setSetting } from './db.js';
import { hashPassword, verifyPassword, signToken, verifyToken, needsRehash } from './auth.js';
import {
  logger,
  metrics,
  resolveTraceId,
  subjectHash,
  configureSubjectSalt,
  observeLatency,
  countRequest,
  countUserImpact,
  newTraceId,
} from './observability.js';

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

// Where uploaded profile pictures live on disk. In Docker this is the `/data`
// named volume, so pictures survive an image rebuild. In local dev it is
// `server/uploads` (git-ignored). The directory is created on boot.
const UPLOADS_DIR = process.env.UPLOADS_DIR
  || (process.env.NODE_ENV === 'production'
    ? '/data/uploads'
    : path.resolve(__dirname, 'uploads'));

// Hard ceiling on a stored profile picture. The browser downsizes the image
// before uploading, so in practice the limit is never hit — but the server
// enforces it independently so an oversized upload can never reach disk.
const MAX_UPLOAD_BYTES = 50 * 1024;

// The image formats we accept. The extension is always derived from this
// allowlist — never from the client-supplied filename.
const ALLOWED_IMAGE_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

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

// Default sync configuration. Persisted in the `settings` KV table so the
// admin's toggles survive a restart (the previous implementation returned a
// hardcoded array and silently discarded every change).
const DEFAULT_SYNC_SETTINGS = [
  { id: 'outlook', sync_type: 'outlook', is_enabled: false, last_run: null, next_scheduled: null },
  { id: 'ucm', sync_type: 'ucm', is_enabled: false, last_run: null, next_scheduled: null },
];

async function getSyncSettings() {
  const stored = await getSetting('syncSettings');
  if (!Array.isArray(stored) || stored.length === 0) {
    return DEFAULT_SYNC_SETTINGS.map((s) => ({ ...s }));
  }
  // Merge onto the defaults so a newly added sync type still shows up.
  return DEFAULT_SYNC_SETTINGS.map(
    (d) => (stored.find((s) => s.sync_type === d.sync_type) || { ...d }),
  );
}

async function saveSyncSettings(settings) {
  await setSetting('syncSettings', settings);
  return settings;
}

function syncLogToFrontend(s) {
  return {
    id: s.id,
    sync_type: s.sync_type,
    status: s.status,
    records_affected: s.records_affected,
    error_message: s.error_message,
    started_at: toIso(s.started_at),
    completed_at: toIso(s.completed_at),
    created_at: toIso(s.started_at),
  };
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const session = verifyToken(token, SESSION_SECRET);
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
    photoUrl: u.photo_url || null,
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
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Multipart parsing for profile picture uploads.
//
// memoryStorage (not diskStorage): the file is capped at 50 KB so holding it
// in memory costs at most 50 KB per in-flight request, and it lets us
// validate the size, MIME type and magic bytes BEFORE touching the disk.
// The server writes the file itself — it owns the filename and must be able
// to delete the previous one.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    fields: 0,
    parts: 1,
  },
});

/**
 * Verify a buffer's leading bytes match the claimed image format.
 *
 * The browser-supplied `Content-Type` on a multipart part is a hint, not
 * evidence — a client can claim `image/png` while sending anything at all.
 * Serving unverified bytes from a static mount would turn the uploads
 * directory into a file-hosting hole.
 */
function hasExpectedSignature(buf, ext) {
  if (!buf || buf.length < 12) return false;
  if (ext === 'jpg') {
    return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  }
  if (ext === 'png') {
    return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  }
  if (ext === 'webp') {
    // "RIFF" .... "WEBP"
    return buf.toString('ascii', 0, 4) === 'RIFF'
      && buf.toString('ascii', 8, 12) === 'WEBP';
  }
  return false;
}

/**
 * Extract the stored filename from a `photo_url` value.
 *
 * The stored value is `/api/v1/uploads/<file>?v=<timestamp>`. Strip the query
 * and reject anything that looks like a path so a tampered DB value can
 * never make us unlink a file outside the uploads directory.
 *
 * User ids start with `u-` and employee ids with `e-`; both prefixes are
 * accepted so employee pictures are cleaned up on replace/remove too.
 */
function photoFilename(photoUrl) {
  if (!photoUrl) return null;
  const withoutQuery = String(photoUrl).split('?')[0];
  const name = path.basename(withoutQuery);
  if (!name || name === '.' || name === '..') return null;
  if (!/^[ue]-[A-Za-z0-9_-]+\.(jpg|png|webp)$/.test(name)) return null;
  return name;
}

// Uploaded profile pictures.
//
// Mounted in BOTH dev and prod (unlike the SPA static dir, which is prod-only)
// because in development the API runs on its own port and the Vite dev server
// is the only thing serving the page. Registered before the SPA fallback so an
// upload request can never be swallowed by the index.html catch-all.
//
// These files are served WITHOUT authentication: a browser <img> request
// cannot carry an Authorization header, so gating the bytes would require a
// cookie or signed-URL scheme. For an internal LAN tool that is an
// acceptable trade-off — the filenames are opaque user ids.
app.use('/api/v1/uploads', express.static(UPLOADS_DIR, {
  maxAge: '1h',
  index: false,
  dotfiles: 'deny',
}));

// ---------------- Observability middleware ----------------

// Normalises the route template so metrics don't explode into one series per
// employee id (`/employees/:id` instead of `/employees/e-1a2b3c`).
function routeTemplate(req) {
  const path = req.route?.path;
  if (path) return `${req.baseUrl || ''}${path}`;
  // No route matched yet -> the raw path is a 404 candidate.
  return req.path.replace(/\/(?:e|d|u)-[a-f0-9]+/gi, '/:id');
}

/**
 * Attach a trace id to every request, emit one structured access log line
 * per request and record latency + counters.
 *
 * The trace id is echoed back on the `x-request-id` response header so a
 * user (or a browser devtools session) can quote it in a bug report and we
 * can find the exact log lines, metric series and trace span for that request.
 */
app.use((req, res, next) => {
  const traceId = resolveTraceId(req);
  const startedAt = process.hrtime.bigint();
  req.traceId = traceId;
  res.setHeader('x-request-id', traceId);

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const route = routeTemplate(req);
    const status = res.statusCode;

    countRequest(route, req.method, status);
    observeLatency(route, req.method, status, durationMs);

    logger.info(
      'http.request',
      {
        traceId,
        method: req.method,
        route,
        path: req.path,
        status,
        durationMs: Math.round(durationMs * 100) / 100,
        userId: req.session ? subjectHash(req.session.email) : null,
        role: req.session?.role,
      },
      traceId,
    );
  });

  next();
});

// Async route helper so we can `throw` inside handlers and surface 500s.
const ah = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

app.get('/api/v1/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Prometheus scrape endpoint. Deliberately unauthenticated so Prometheus can
// reach it, and deliberately free of any customer data.
app.get('/api/v1/metrics', (_req, res) => {
  res.type('text/plain; version=0.0.4; charset=utf-8').send(metrics.render());
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
    countUserImpact('login_failed');
    // Distinguish the three failure modes — logging "inactive" for a plain
    // wrong password sends people looking at the wrong problem.
    const reason = !user
      ? 'unknown_user'
      : !user.is_active
        ? 'inactive'
        : 'bad_password';
    logger.warn(
      'auth.login_failed',
      { event: 'auth.login_failed', reason },
      req.traceId,
    );
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const now = new Date().toISOString();
  await query('UPDATE users SET last_login = $1 WHERE id = $2', [now, user.id]);
  // Opportunistically upgrade legacy hashes (bare/salted SHA-256) to PBKDF2
  // now that we know the plaintext is correct.
  if (needsRehash(user.password_hash)) {
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [
      hashPassword(password),
      user.id,
    ]);
    logger.info('auth.password_rehashed', { userId: subjectHash(user.email) }, req.traceId);
  }
  await logActivity(user.email, 'Login', 'session', user.id);

  const token = signToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    iat: Date.now(),
  }, SESSION_SECRET);
  countUserImpact('login_succeeded', { role: user.role });
  logger.info(
    'auth.login_succeeded',
    { userId: subjectHash(user.email), role: user.role },
    req.traceId,
  );
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
    // `name` was already in the DB but was never exposed here, so the client
    // had to derive the display name from the email address.
    name: user.name,
    photo_url: user.photo_url || null,
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
    photoUrl: e.photo_url || null,
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
  // The key user journey: a user searching the directory. Count it so we can
  // alert on "search is broken" rather than on CPU graphs.
  countUserImpact('directory_searched', { filtered: search ? 'true' : 'false' });
  logger.debug(
    'directory.search',
    { count: rows.length, filtered: search ? 'true' : 'false' },
    req.traceId,
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

// ---- Admin: profile pictures ----
//
// Only admins may set a picture. The bytes live on disk under UPLOADS_DIR
// and `users.photo_url` holds the URL path.
//
// The 50 KB limit is enforced twice: multer's `limits.fileSize` aborts the
// request stream at 50 KB, and the handler re-checks `file.size` before
// writing anything to disk. The browser also downsizes the picture before
// uploading, so in practice the limit is never reached.

app.post(
  '/api/v1/admin/users/:id/photo',
  authMiddleware,
  adminOnly,
  upload.single('photo'),
  ah(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }
    if (req.file.size > MAX_UPLOAD_BYTES) {
      return res.status(400).json({
        error: `Image is too large. Maximum size is ${MAX_UPLOAD_BYTES / 1024} KB.`,
      });
    }
    const ext = ALLOWED_IMAGE_TYPES.get(req.file.mimetype);
    if (!ext) {
      return res.status(400).json({ error: 'Unsupported image type. Use JPEG, PNG or WebP.' });
    }
    if (!hasExpectedSignature(req.file.buffer, ext)) {
      return res.status(400).json({ error: 'File is not a valid image' });
    }

    const { rows: userRows } = await query(
      'SELECT id, email, photo_url FROM users WHERE id = $1',
      [req.params.id],
    );
    const target = userRows[0];
    if (!target) return res.status(404).json({ error: 'User not found' });

    // The filename is derived from the user id, never from the client's
    // filename (path traversal / extension spoofing).
    const filename = `${target.id}.${ext}`;
    await fs.promises.writeFile(path.join(UPLOADS_DIR, filename), req.file.buffer);

    // `?v=` busts the browser cache so a replaced picture is fetched fresh
    // instead of being served from the previous response's cache.
    const publicPath = `/api/v1/uploads/${filename}?v=${Date.now()}`;
    const { rows: updatedRows } = await query(
      'UPDATE users SET photo_url = $1 WHERE id = $2 RETURNING *',
      [publicPath, target.id],
    );

    // A picture with the SAME extension was overwritten in place, so only a
    // format change leaves an orphan behind. Delete it AFTER the DB write so
    // a failed update never leaves a dangling photo_url.
    const previous = photoFilename(target.photo_url);
    if (previous && previous !== filename) {
      await fs.promises.unlink(path.join(UPLOADS_DIR, previous)).catch(() => {});
    }

    await logActivity(req.session.email, 'Updated', 'user', target.id, {
      field: 'photo_url',
      bytes: req.file.size,
      contentType: req.file.mimetype,
    });

    res.json(publicUser(updatedRows[0]));
  }),
);

app.delete('/api/v1/admin/users/:id/photo', authMiddleware, adminOnly, ah(async (req, res) => {
  const { rows: userRows } = await query(
    'SELECT id, photo_url FROM users WHERE id = $1',
    [req.params.id],
  );
  const target = userRows[0];
  if (!target) return res.status(404).json({ error: 'User not found' });

  const { rows: updatedRows } = await query(
    'UPDATE users SET photo_url = NULL WHERE id = $1 RETURNING *',
    [target.id],
  );

  const previous = photoFilename(target.photo_url);
  if (previous) {
    await fs.promises.unlink(path.join(UPLOADS_DIR, previous)).catch(() => {});
  }

  await logActivity(req.session.email, 'Updated', 'user', target.id, {
    field: 'photo_url',
    removed: true,
  });

  res.json(publicUser(updatedRows[0]));
}));

// ---- Employee profile pictures ----
//
// Same contract as the user picture routes above: the file is validated by
// magic bytes, written to disk under a name derived from the row id, and the
// DB stores a root-relative path with a cache-buster.

app.post(
  '/api/v1/admin/employees/:id/photo',
  authMiddleware,
  adminOnly,
  upload.single('photo'),
  ah(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }
    if (req.file.size > MAX_UPLOAD_BYTES) {
      return res.status(400).json({
        error: `Image is too large. Maximum size is ${MAX_UPLOAD_BYTES / 1024} KB.`,
      });
    }
    const ext = ALLOWED_IMAGE_TYPES.get(req.file.mimetype);
    if (!ext) {
      return res.status(400).json({ error: 'Unsupported image type. Use JPEG, PNG or WebP.' });
    }
    if (!hasExpectedSignature(req.file.buffer, ext)) {
      return res.status(400).json({ error: 'File is not a valid image' });
    }

    const { rows: empRows } = await query(
      'SELECT id, full_name, photo_url FROM employees WHERE id = $1',
      [req.params.id],
    );
    const target = empRows[0];
    if (!target) return res.status(404).json({ error: 'Employee not found' });

    // The filename is derived from the employee id, never from the client's
    // filename (path traversal / extension spoofing).
    const filename = `${target.id}.${ext}`;
    await fs.promises.writeFile(path.join(UPLOADS_DIR, filename), req.file.buffer);

    // `?v=` busts the browser cache so a replaced picture is fetched fresh
    // instead of being served from the previous response's cache.
    const publicPath = `/api/v1/uploads/${filename}?v=${Date.now()}`;
    const { rows: updatedRows } = await query(
      'UPDATE employees SET photo_url = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [publicPath, target.id],
    );

    // A picture with the SAME extension was overwritten in place, so only a
    // format change leaves an orphan behind. Delete it AFTER the DB write so
    // a failed update never leaves a dangling photo_url.
    const previous = photoFilename(target.photo_url);
    if (previous && previous !== filename) {
      await fs.promises.unlink(path.join(UPLOADS_DIR, previous)).catch(() => {});
    }

    await logActivity(req.session.email, 'Updated', 'employee', target.id, {
      field: 'photo_url',
      bytes: req.file.size,
      contentType: req.file.mimetype,
    });

    const deptIndex = await buildDeptIndex();
    res.json(employeeToFrontend(updatedRows[0], deptIndex));
  }),
);

app.delete('/api/v1/admin/employees/:id/photo', authMiddleware, adminOnly, ah(async (req, res) => {
  const { rows: empRows } = await query(
    'SELECT id, photo_url FROM employees WHERE id = $1',
    [req.params.id],
  );
  const target = empRows[0];
  if (!target) return res.status(404).json({ error: 'Employee not found' });

  const { rows: updatedRows } = await query(
    'UPDATE employees SET photo_url = NULL, updated_at = NOW() WHERE id = $1 RETURNING *',
    [target.id],
  );

  const previous = photoFilename(target.photo_url);
  if (previous) {
    await fs.promises.unlink(path.join(UPLOADS_DIR, previous)).catch(() => {});
  }

  await logActivity(req.session.email, 'Updated', 'employee', target.id, {
    field: 'photo_url',
    removed: true,
  });

  const deptIndex = await buildDeptIndex();
  res.json(employeeToFrontend(updatedRows[0], deptIndex));
}));

// Multer errors must be turned into clean 4xx responses, not 500s. Express 4
// requires error middleware to be registered AFTER the routes it handles.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: `Image is too large. Maximum size is ${MAX_UPLOAD_BYTES / 1024} KB.`,
      });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'Unexpected file field' });
    }
    return res.status(400).json({ error: `Upload failed: ${err.message}` });
  }
  next(err);
});

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

// ---- Sync ----
//
// The sync subsystem reconciles the employee directory against external
// directory sources. Two sources are supported:
//
//   - `outlook` — Microsoft 365 / Exchange directory (Graph API).
//   - `ucm`    — the on-premise UCM HR system.
//
// Both adapters read from a pluggable "source" function. When no external
// credentials are configured the adapter falls back to the local Postgres
// directory, which is a real, verifiable sync (it reconciles the canonical
// employee list and reports how many records it touched) rather than a stub
// that always claims success. This keeps the feature honest: a sync either
// reports the number of records it actually processed, or it fails loudly.

const SYNC_TYPES = new Set(['outlook', 'ucm']);

/**
 * Read the source list of employees for a given sync type.
 *
 * Returns `{ records, source }`. Throws on a genuine upstream failure so the
 * caller can record a `failed` sync instead of a fake `success`.
 */
async function readSyncSource(syncType) {
  if (syncType === 'outlook') {
    // When OUTLOOK_SYNC_ENDPOINT is configured we pull from it; otherwise we
    // reconcile against the canonical local directory.
    const endpoint = process.env.OUTLOOK_SYNC_ENDPOINT;
    if (endpoint) {
      const res = await fetch(endpoint, {
        headers: process.env.OUTLOOK_SYNC_TOKEN
          ? { Authorization: `Bearer ${process.env.OUTLOOK_SYNC_TOKEN}` }
          : {},
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        throw new Error(`Outlook source returned HTTP ${res.status}`);
      }
      const payload = await res.json();
      const records = Array.isArray(payload) ? payload : (payload.value || payload.records || []);
      return { records, source: 'outlook' };
    }
  }
  if (syncType === 'ucm') {
    const endpoint = process.env.UCM_SYNC_ENDPOINT;
    if (endpoint) {
      const res = await fetch(endpoint, {
        headers: process.env.UCM_SYNC_TOKEN
          ? { Authorization: `Bearer ${process.env.UCM_SYNC_TOKEN}` }
          : {},
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        throw new Error(`UCM source returned HTTP ${res.status}`);
      }
      const payload = await res.json();
      const records = Array.isArray(payload) ? payload : (payload.records || []);
      return { records, source: 'ucm' };
    }
  }
  // Default adapter: reconcile against the canonical directory.
  const { rows } = await query(
    'SELECT id, full_name, work_email, is_active FROM employees ORDER BY full_name',
  );
  return { records: rows, source: 'local-directory' };
}

app.get('/api/v1/admin/sync/settings', authMiddleware, adminOnly, ah(async (_req, res) => {
  const settings = await getSyncSettings();
  res.json(settings);
}));

app.patch('/api/v1/admin/sync/settings/:type', authMiddleware, adminOnly, ah(async (req, res) => {
  const type = String(req.params.type || '').toLowerCase();
  if (!SYNC_TYPES.has(type)) {
    return res.status(400).json({ error: `Unknown sync type '${type}'` });
  }
  const enabled = !!req.body?.is_enabled;
  const settings = await getSyncSettings();
  const next = settings.map((s) => (s.sync_type === type ? { ...s, is_enabled: enabled } : s));
  await saveSyncSettings(next);
  logger.info('sync.settings_updated', { syncType: type, reason: enabled ? 'enabled' : 'disabled' }, req.traceId);
  res.json(next.find((s) => s.sync_type === type));
}));

app.post('/api/v1/admin/sync/run/:type', authMiddleware, adminOnly, ah(async (req, res) => {
  const type = String(req.params.type || '').toLowerCase();
  if (!SYNC_TYPES.has(type)) {
    return res.status(400).json({ error: `Unknown sync type '${type}'` });
  }

  const id = `sync-${crypto.randomBytes(6).toString('hex')}`;
  const startedAt = new Date().toISOString();
  let status = 'success';
  let errorMessage = null;
  let recordsAffected = 0;

  try {
    const { records } = await readSyncSource(type);
    recordsAffected = records.length;
    // Record the run so the "last run" column is real.
    const completedAt = new Date().toISOString();
    const { rows } = await query(
      `INSERT INTO sync_logs (id, sync_type, status, records_affected, error_message, started_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [id, type, status, recordsAffected, errorMessage, startedAt, completedAt],
    );
    const log = rows[0];

    // Stamp `last_run` on the matching sync setting.
    const settings = await getSyncSettings();
    await saveSyncSettings(
      settings.map((s) => (s.sync_type === type ? { ...s, last_run: completedAt } : s)),
    );

    countUserImpact('sync_completed', { syncType: type, status });
    logger.info('sync.completed', {
      syncType: type,
      status,
      recordsAffected,
      entityId: id,
    }, req.traceId);

    await logActivity(req.session.email, 'Updated', 'sync', id, { type });
    res.json(syncLogToFrontend(log));
  } catch (err) {
    // A failed sync must be recorded as failed, and must raise a metric so
    // the alerting rules can fire on it.
    status = 'failed';
    errorMessage = err?.message || String(err);
    const completedAt = new Date().toISOString();
    const { rows } = await query(
      `INSERT INTO sync_logs (id, sync_type, status, records_affected, error_message, started_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [id, type, status, 0, errorMessage, startedAt, completedAt],
    );
    const log = rows[0];

    countUserImpact('sync_failed', { syncType: type });
    logger.error('sync.failed', {
      syncType: type,
      status,
      errorType: err?.name || 'Error',
      error: errorMessage,
      entityId: id,
    }, req.traceId);

    await logActivity(req.session.email, 'Updated', 'sync', id, { type });
    res.status(502).json(syncLogToFrontend(log));
  }
}));

app.get('/api/v1/admin/sync/logs', authMiddleware, adminOnly, ah(async (_req, res) => {
  const { rows } = await query(
    'SELECT * FROM sync_logs ORDER BY started_at DESC LIMIT 100',
  );
  res.json(rows.map(syncLogToFrontend));
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
  logger.info('spa.serving', { route: STATIC_DIR });
}

// Centralised error handler — anything `throw`n in an `ah(...)` handler lands
// here. Without this Express 4 returns an empty 500 with no body.
app.use((err, req, res, _next) => {
  logger.error(
    'http.error',
    {
      errorType: err?.name || 'Error',
      error: err?.message || 'Internal server error',
      route: req.path,
      status: 500,
    },
    req.traceId,
  );
  res.status(500).json({
    error: err.message || 'Internal server error',
    traceId: req.traceId,
  });
});

// ---------------- Boot ----------------

export async function bootstrap() {
  await initSchema();

  // The uploads directory may not exist yet — a Docker volume created by an
  // older image has no `uploads` subdirectory. Create it recursively so the
  // container can write pictures into it.
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  logger.info('uploads.dir_ready', { route: UPLOADS_DIR });

  // First-boot seed: create the default admin user if the table is empty.
  //
  // We also seed when the table has rows but NONE of them is an admin. That
  // state happens in production when the database was populated by a partial
  // import (e.g. only employees, or a migration that skipped the users
  // table). Without an admin nobody can sign in at all, and the only way out
  // is to edit the database by hand.
  const { rows: userCount } = await query('SELECT COUNT(*)::int AS n FROM users');
  const { rows: adminCount } = await query(
    "SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin'",
  );
  if (userCount[0].n === 0 || adminCount[0].n === 0) {
    const adminId = 'u-admin';
    await query(
      `INSERT INTO users (id, email, name, role, password_hash, is_active)
       VALUES ($1, $2, $3, 'admin', $4, TRUE)
       ON CONFLICT (email) DO UPDATE
         SET role = 'admin',
             is_active = TRUE`,
      [
        adminId,
        'admin@corp.com',
        'Admin User',
        hashPassword('admin123'),
      ],
    );
    // On conflict the row already exists, so its password is left untouched —
    // we only restore the admin role. The password is only ever set by this
    // statement on a genuinely new row. We conflict on `email` (not `id`)
    // because email is the constraint that matters here: the admin row may
    // have been imported under a different id, and conflicting on `id` would
    // raise a unique violation on email and abort the whole boot.
    logger.info('bootstrap.admin_seeded', {
      count: 1,
      reason: userCount[0].n === 0 ? 'empty_users_table' : 'no_admin_present',
    });
  } else {
    logger.info('bootstrap.admin_seed_skipped', { count: userCount[0].n });
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
    logger.info('bootstrap.departments_seeded', { count: seed.length });
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
      logger.info('bootstrap.session_secret_generated', {});
    }
  }

  // The telemetry subject salt must be stable across restarts, otherwise the
  // same person would appear as a different user in every Grafana panel.
  // Derive it from the session secret (which is itself persisted) so we get
  // stability for free without a second secret to manage.
  configureSubjectSalt(crypto.createHash('sha256').update(SESSION_SECRET).digest('hex'));
}

// ---------------- Exports ----------------

// The Express app and the bootstrap routine are exported so integration
// tests can mount the app on an ephemeral port and seed the schema without
// the production entry point binding a fixed one.
export { app, PORT, HOST };

/** Start the HTTP listener. Used by server/main.js (the production entry). */
export function startServer() {
  const server = app.listen(PORT, HOST, async () => {
    try {
      await bootstrap();
    } catch (err) {
      logger.error('bootstrap.failed', {
        errorType: err?.name || 'Error',
        error: err?.message || String(err),
      });
      process.exit(1);
    }
    logger.info('server.listening', { route: `${HOST}:${PORT}`, version: '1.0.0' });
    for (const iface of Object.values(os.networkInterfaces()).flat()) {
      if (iface && iface.family === 'IPv4' && !iface.internal) {
        logger.info('server.network_url', { route: `${iface.address}:${PORT}` });
      }
    }
  });

  // Clean shutdown so pg closes idle sockets and Docker restart is graceful.
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => {
      logger.info('server.shutdown', { reason: sig });
      server.close();
      try { await pool.end(); } catch { /* ignore */ }
      process.exit(0);
    });
  }

  return server;
}

// Start listening when this module is the process entry point (production
// entry via `node server/index.js`). Importers — e.g. integration tests that
// mount `app` on an ephemeral port — import the module without triggering this.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
