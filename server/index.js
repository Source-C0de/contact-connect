// ContactHub LAN server
// - Single source of truth: server/data.json on disk (acts as the "database").
// - Bound to 0.0.0.0 so other machines on the office network can reach it.
// - Stateless auth: a signed session token (HMAC) is returned by /auth/login.
//
// No external services, no DB, no npm packages beyond express + cors.

import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0'; // listen on every interface so the LAN can reach us
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
// The session secret is generated on first boot and stored in data.json so
// that restarting the server (e.g. after a power blip) does NOT invalidate
// every logged-in token. You can override with the SESSION_SECRET env var.
function generateSecret() {
  return crypto.randomBytes(32).toString('base64url');
}
let SESSION_SECRET = process.env.SESSION_SECRET || null;

// ---------------- Persistence ----------------

const DEFAULT_DATA = {
  users: [
    {
      id: 'u-admin',
      email: 'admin@corp.com',
      name: 'Admin User',
      role: 'admin',
      passwordHash: hashPassword('admin123'),
      isActive: true,
      lastLogin: null,
      createdAt: new Date().toISOString(),
    },
  ],
  employees: seedEmployees(),
  departments: seedDepartments(),
  syncLogs: [],
  activityLogs: [],
  sessionSettings: {
    inactivityTimeoutMinutes: 30,
    logoutOnBrowserClose: false,
  },
  sessionSecret: '',
};

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const fresh = structuredClone(DEFAULT_DATA);
      SESSION_SECRET = fresh.sessionSecret || (fresh.sessionSecret = generateSecret());
      fs.writeFileSync(DATA_FILE, JSON.stringify(fresh, null, 2));
      return fresh;
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    // Backfill anything new in DEFAULT_DATA so upgrades don't crash.
    for (const key of Object.keys(DEFAULT_DATA)) {
      if (!(key in parsed)) parsed[key] = DEFAULT_DATA[key];
    }
    if (!SESSION_SECRET) {
      SESSION_SECRET = parsed.sessionSecret || (parsed.sessionSecret = generateSecret());
      saveData(parsed);
    }
    return parsed;
  } catch (err) {
    console.error('Failed to load data.json, starting fresh:', err);
    const fresh = structuredClone(DEFAULT_DATA);
    SESSION_SECRET = fresh.sessionSecret || (fresh.sessionSecret = generateSecret());
    fs.writeFileSync(DATA_FILE, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let db = loadData();

// ---------------- Password hashing ----------------
// We use a salted SHA-256 hash. This is NOT bcrypt-grade; it's enough to avoid
// storing plaintext in a file on an office LAN. Anyone with shell on the host
// already has access, so the threat model is "don't leak the password on a
// casual disk read".

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

// ---------------- Seed data ----------------

function seedDepartments() {
  return [
    { id: 'd-eng', name: 'Engineering', color: '#3B82F6' },
    { id: 'd-sales', name: 'Sales', color: '#F59E0B' },
    { id: 'd-hr', name: 'HR', color: '#EC4899' },
    { id: 'd-fin', name: 'Finance', color: '#10B981' },
    { id: 'd-it', name: 'IT', color: '#8B5CF6' },
    { id: 'd-ops', name: 'Operations', color: '#F97316' },
  ];
}

function seedEmployees() {
  const now = new Date().toISOString();
  const list = [
    ['Sarah Johnson', 'Senior Software Engineer', 'Engineering', 'sarah.johnson@corp.com', '1001', '+1 (555) 234-5678', 'New York - Floor 3'],
    ['Michael Chen', 'Product Manager', 'Engineering', 'michael.chen@corp.com', '1002', '+1 (555) 345-6789', 'New York - Floor 3'],
    ['Emily Rodriguez', 'UX Designer', 'Engineering', 'emily.rodriguez@corp.com', '1003', '+1 (555) 456-7890', 'San Francisco - Floor 2'],
    ['James Wilson', 'Sales Director', 'Sales', 'james.wilson@corp.com', '2001', '+1 (555) 567-8901', 'Chicago - Floor 1'],
    ['Amanda Foster', 'Account Executive', 'Sales', 'amanda.foster@corp.com', '2002', '+1 (555) 678-9012', 'Chicago - Floor 1'],
    ['Rachel Thompson', 'HR Manager', 'HR', 'rachel.thompson@corp.com', '3001', '+1 (555) 890-1234', 'New York - Floor 2'],
    ['Robert Taylor', 'CFO', 'Finance', 'robert.taylor@corp.com', '4001', '+1 (555) 123-4567', 'New York - Floor 5'],
    ['Jessica Adams', 'IT Director', 'IT', 'jessica.adams@corp.com', '5001', '+1 (555) 456-7891', 'San Francisco - Floor 3'],
    ['Kevin O\'Brien', 'Operations Manager', 'Operations', 'kevin.obrien@corp.com', '6001', '+1 (555) 789-0124', 'Chicago - Floor 2'],
  ];
  return list.map(([fullName, jobTitle, deptName, email, ext, mobile, location], idx) => ({
    id: `e-${idx + 1}`,
    fullName,
    jobTitle,
    departmentName: deptName,
    workEmail: email,
    extension: ext,
    mobile,
    officeLocation: location,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }));
}

// ---------------- Helpers ----------------

const newId = (prefix) => `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
const nowIso = () => new Date().toISOString();

function logActivity(actorEmail, action, entityType, entityId, details = null) {
  db.activityLogs.unshift({
    id: newId('log'),
    userEmail: actorEmail,
    action,
    entityType,
    entityId,
    details,
    createdAt: nowIso(),
  });
  // keep last 500 entries
  db.activityLogs = db.activityLogs.slice(0, 500);
}

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    isActive: u.isActive,
    lastLogin: u.lastLogin,
  };
}

function employeeToFrontend(e) {
  return {
    id: e.id,
    fullName: e.fullName,
    jobTitle: e.jobTitle,
    department: e.departmentName,
    departmentId: departmentIdByName(e.departmentName),
    email: e.workEmail,
    extension: e.extension,
    mobile: e.mobile || '',
    location: e.officeLocation || '',
    status: e.isActive ? 'active' : 'inactive',
    onlineStatus: e.isActive ? 'online' : 'offline',
    dateAdded: (e.createdAt || nowIso()).slice(0, 10),
  };
}

function departmentIdByName(name) {
  return db.departments.find((d) => d.name === name)?.id || null;
}

function employeeToBackend(body) {
  return {
    fullName: body.fullName || body.full_name,
    jobTitle: body.jobTitle || body.job_title,
    departmentName:
      body.department ||
      db.departments.find((d) => d.id === body.department_id)?.name ||
      '',
    workEmail: body.email || body.work_email,
    extension: body.extension || '',
    mobile: body.mobile || '',
    officeLocation: body.location || body.office_location || '',
    isActive: body.isActive !== undefined ? body.isActive : body.status !== 'inactive',
  };
}

// ---------------- Express app ----------------

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/v1/health', (_req, res) => {
  res.json({ ok: true, time: nowIso() });
});

// ---- Auth ----

app.post('/api/v1/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const user = db.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase());
  if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  user.lastLogin = nowIso();
  saveData(db);
  logActivity(user.email, 'Login', 'session', user.id);

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
});

app.post('/api/v1/auth/logout', authMiddleware, (req, res) => {
  logActivity(req.session.email, 'Logout', 'session', req.session.sub);
  saveData(db);
  res.json({ ok: true });
});

app.get('/api/v1/auth/me', authMiddleware, (req, res) => {
  const user = db.users.find((u) => u.id === req.session.sub);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    user_id: user.id,
    email: user.email,
    role: user.role,
  });
});

app.put('/api/v1/auth/password', authMiddleware, (req, res) => {
  const { old_password, new_password } = req.body || {};
  const user = db.users.find((u) => u.id === req.session.sub);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!verifyPassword(old_password || '', user.passwordHash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  user.passwordHash = hashPassword(new_password);
  saveData(db);
  logActivity(user.email, 'Updated', 'user', user.id, { field: 'password' });
  res.json({ ok: true });
});

// ---- Employees ----

app.get('/api/v1/employees', authMiddleware, (req, res) => {
  const { search, department_id, is_active } = req.query;
  let list = db.employees.slice();
  if (search) {
    const q = String(search).toLowerCase();
    list = list.filter(
      (e) =>
        e.fullName.toLowerCase().includes(q) ||
        (e.workEmail || '').toLowerCase().includes(q) ||
        (e.jobTitle || '').toLowerCase().includes(q) ||
        (e.extension || '').includes(q),
    );
  }
  if (department_id) {
    list = list.filter((e) => departmentIdByName(e.departmentName) === department_id);
  }
  if (is_active !== undefined) {
    const wantActive = is_active === 'true';
    list = list.filter((e) => e.isActive === wantActive);
  }
  res.json({
    data: list.map(employeeToFrontend),
    total: list.length,
    page: 1,
    page_size: list.length,
    total_pages: 1,
  });
});

app.get('/api/v1/employees/:id', authMiddleware, (req, res) => {
  const emp = db.employees.find((e) => e.id === req.params.id);
  if (!emp) return res.status(404).json({ error: 'Not found' });
  res.json(employeeToFrontend(emp));
});

app.post('/api/v1/employees', authMiddleware, adminOnly, (req, res) => {
  const backend = employeeToBackend(req.body || {});
  if (!backend.fullName || !backend.workEmail) {
    return res.status(400).json({ error: 'Name and email are required' });
  }
  const emp = {
    id: newId('e'),
    ...backend,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  db.employees.push(emp);
  logActivity(req.session.email, 'Created', 'employee', emp.id, { name: emp.fullName });
  saveData(db);
  res.json(employeeToFrontend(emp));
});

app.put('/api/v1/employees/:id', authMiddleware, adminOnly, (req, res) => {
  const idx = db.employees.findIndex((e) => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const backend = employeeToBackend(req.body || {});
  db.employees[idx] = {
    ...db.employees[idx],
    ...backend,
    updatedAt: nowIso(),
  };
  logActivity(req.session.email, 'Updated', 'employee', db.employees[idx].id, {
    name: db.employees[idx].fullName,
  });
  saveData(db);
  res.json(employeeToFrontend(db.employees[idx]));
});

app.delete('/api/v1/employees/:id', authMiddleware, adminOnly, (req, res) => {
  const idx = db.employees.findIndex((e) => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const removed = db.employees.splice(idx, 1)[0];
  logActivity(req.session.email, 'Deleted', 'employee', removed.id, { name: removed.fullName });
  saveData(db);
  res.json({ ok: true });
});

// ---- Departments ----

app.get('/api/v1/departments', authMiddleware, (_req, res) => {
  res.json(
    db.departments.map((d) => ({
      ...d,
      employeeCount: db.employees.filter((e) => e.departmentName === d.name && e.isActive).length,
    })),
  );
});

app.post('/api/v1/departments', authMiddleware, adminOnly, (req, res) => {
  const name = (req.body?.name || '').trim();
  const color = req.body?.color || '#3B82F6';
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (db.departments.some((d) => d.name.toLowerCase() === name.toLowerCase())) {
    return res.status(400).json({ error: 'Department already exists' });
  }
  const dept = { id: newId('d'), name, color };
  db.departments.push(dept);
  logActivity(req.session.email, 'Created', 'department', dept.id, { name });
  saveData(db);
  res.json({ ...dept, employeeCount: 0 });
});

app.put('/api/v1/departments/:id', authMiddleware, adminOnly, (req, res) => {
  const dept = db.departments.find((d) => d.id === req.params.id);
  if (!dept) return res.status(404).json({ error: 'Not found' });
  if (req.body?.name) dept.name = String(req.body.name).trim();
  if (req.body?.color) dept.color = req.body.color;
  dept.updatedAt = nowIso();
  logActivity(req.session.email, 'Updated', 'department', dept.id, { name: dept.name });
  saveData(db);
  res.json({ ...dept, employeeCount: db.employees.filter((e) => e.departmentName === dept.name && e.isActive).length });
});

app.delete('/api/v1/departments/:id', authMiddleware, adminOnly, (req, res) => {
  const idx = db.departments.findIndex((d) => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const [removed] = db.departments.splice(idx, 1);
  // null out department on employees
  db.employees.forEach((e) => {
    if (e.departmentName === removed.name) e.departmentName = '';
  });
  logActivity(req.session.email, 'Deleted', 'department', removed.id, { name: removed.name });
  saveData(db);
  res.json({ ok: true });
});

// ---- Admin: users ----

app.get('/api/v1/admin/users', authMiddleware, adminOnly, (_req, res) => {
  res.json(
    db.users.map((u) => ({
      ...publicUser(u),
      createdAt: u.createdAt,
      updatedAt: u.lastLogin,
    })),
  );
});

app.post('/api/v1/admin/users/invite', authMiddleware, adminOnly, (req, res) => {
  const { email, role, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (db.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ error: 'User already exists' });
  }
  const user = {
    id: newId('u'),
    email,
    name: email.split('@')[0],
    role: role === 'admin' ? 'admin' : 'user',
    passwordHash: hashPassword(password),
    isActive: true,
    lastLogin: null,
    createdAt: nowIso(),
  };
  db.users.push(user);
  logActivity(req.session.email, 'Created', 'user', user.id, { email });
  saveData(db);
  res.json(publicUser(user));
});

app.patch('/api/v1/admin/users/:id/role', authMiddleware, adminOnly, (req, res) => {
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const role = req.body?.role === 'admin' ? 'admin' : 'user';
  user.role = role;
  logActivity(req.session.email, 'Updated', 'user', user.id, { field: 'role', value: role });
  saveData(db);
  res.json(publicUser(user));
});

app.patch('/api/v1/admin/users/:id/deactivate', authMiddleware, adminOnly, (req, res) => {
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  user.isActive = false;
  logActivity(req.session.email, 'Deactivated', 'user', user.id);
  saveData(db);
  res.json(publicUser(user));
});

app.patch('/api/v1/admin/users/:id/password', authMiddleware, adminOnly, (req, res) => {
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (!req.body?.password || req.body.password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  user.passwordHash = hashPassword(req.body.password);
  logActivity(req.session.email, 'Updated', 'user', user.id, { field: 'password' });
  saveData(db);
  res.json(publicUser(user));
});

app.get('/api/v1/admin/session-settings', authMiddleware, adminOnly, (_req, res) => {
  res.json({
    id: 'session-settings',
    inactivity_timeout_minutes: db.sessionSettings.inactivityTimeoutMinutes,
    logout_on_browser_close: db.sessionSettings.logoutOnBrowserClose,
  });
});

app.patch('/api/v1/admin/session-settings', authMiddleware, adminOnly, (req, res) => {
  if (typeof req.body?.inactivity_timeout_minutes === 'number') {
    db.sessionSettings.inactivityTimeoutMinutes = req.body.inactivity_timeout_minutes;
  }
  if (typeof req.body?.logout_on_browser_close === 'boolean') {
    db.sessionSettings.logoutOnBrowserClose = req.body.logout_on_browser_close;
  }
  saveData(db);
  res.json({
    id: 'session-settings',
    inactivity_timeout_minutes: db.sessionSettings.inactivityTimeoutMinutes,
    logout_on_browser_close: db.sessionSettings.logoutOnBrowserClose,
  });
});

app.get('/api/v1/admin/dashboard', authMiddleware, adminOnly, (_req, res) => {
  const recent = db.activityLogs.filter((l) => {
    const t = new Date(l.createdAt).getTime();
    return Date.now() - t < 7 * 24 * 60 * 60 * 1000;
  }).length;
  res.json({
    total_employees: db.employees.length,
    total_departments: db.departments.length,
    active_users: db.users.filter((u) => u.isActive).length,
    recent_activity: recent,
  });
});

// ---- Audit log ----

app.get('/api/v1/admin/audit-logs', authMiddleware, adminOnly, (_req, res) => {
  res.json(
    db.activityLogs.map((l) => ({
      id: l.id,
      user_id: '',
      user_email: l.userEmail,
      action: l.action,
      entity_type: l.entityType,
      entity_id: l.entityId,
      details: l.details,
      ip_address: '',
      created_at: l.createdAt,
    })),
  );
});

app.get('/api/v1/admin/audit-logs/export', authMiddleware, adminOnly, (_req, res) => {
  const lines = ['timestamp,actor,action,entity,target'];
  for (const l of db.activityLogs) {
    const target = l.details?.name || l.details?.email || l.entityId;
    lines.push(
      [
        l.createdAt,
        l.userEmail,
        l.action,
        l.entityType,
        JSON.stringify(target || ''),
      ].join(','),
    );
  }
  res.type('text/csv').send(lines.join('\n'));
});

// ---- Sync (no-op for LAN; just log attempts) ----

app.get('/api/v1/admin/sync/settings', authMiddleware, adminOnly, (_req, res) => {
  res.json([
    { id: 'outlook', sync_type: 'outlook', is_enabled: false, last_run: null, next_scheduled: null },
    { id: 'ucm', sync_type: 'ucm', is_enabled: false, last_run: null, next_scheduled: null },
  ]);
});

app.patch('/api/v1/admin/sync/settings/:type', authMiddleware, adminOnly, (req, res) => {
  res.json({ ok: true, enabled: !!req.body?.is_enabled });
});

app.post('/api/v1/admin/sync/run/:type', authMiddleware, adminOnly, (req, res) => {
  const log = {
    id: newId('sync'),
    sync_type: req.params.type,
    status: 'success',
    records_affected: 0,
    error_message: null,
    started_at: nowIso(),
    completed_at: nowIso(),
  };
  db.syncLogs.unshift(log);
  logActivity(req.session.email, 'Updated', 'sync', log.id, { type: req.params.type });
  saveData(db);
  res.json(log);
});

app.get('/api/v1/admin/sync/logs', authMiddleware, adminOnly, (_req, res) => {
  res.json(
    db.syncLogs.map((s) => ({
      id: s.id,
      sync_type: s.sync_type,
      status: s.status,
      records_affected: s.records_affected,
      error_message: s.error_message,
      started_at: s.started_at,
      completed_at: s.completed_at,
      created_at: s.started_at,
    })),
  );
});

// ---------------- Start ----------------

app.listen(PORT, HOST, () => {
  console.log(`ContactHub server listening on http://${HOST}:${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
  console.log('Seeded admin: admin@corp.com / admin123');
  console.log('LAN URLs from this machine:');
  for (const iface of Object.values(os.networkInterfaces()).flat()) {
    if (iface && iface.family === 'IPv4' && !iface.internal) {
      console.log(`  http://${iface.address}:${PORT}`);
    }
  }
});