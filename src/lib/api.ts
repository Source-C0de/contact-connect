/**
 * Unified API layer for ContactHub.
 *
 * Talks to the ContactHub HTTP API (server/index.js).
 *
 * A per-browser `localStorage` mirror exists as a last-resort fallback for
 * fully offline development. It is DISABLED by default: silently swapping in
 * browser-local data when the backend is down makes a broken deployment look
 * healthy, which is exactly the failure mode the observability stack is meant
 * to catch. Set `VITE_ENABLE_LOCAL_FALLBACK=true` to turn it back on.
 */

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
}

// The base URL is resolved in one place (src/lib/apiBase.ts) so that the API
// client, the session manager and the audit exporter can never drift apart.
// In production the SPA and the API are served by the same Node process, so
// the API lives on the SAME host and port as the page (no port suffix). In
// local dev (Vite on :5173) the LAN server runs on its own port.
import { API_BASE_URL } from './apiBase';

const LS_BASE = 'contacthub_api_v1';
const LS_TOKEN_KEY = 'contacthub_access_token';
const LS_USER_KEY = 'contacthub_user';
const LS_SERVER_OK_KEY = 'contacthub_server_ok';

/**
 * Whether the browser-local mirror may be used when the API is unreachable.
 *
 * Off by default so a backend outage surfaces as an error instead of being
 * papered over with per-browser data. Turn it on for offline UI work.
 */
export const LOCAL_FALLBACK_ENABLED =
  (import.meta.env.VITE_ENABLE_LOCAL_FALLBACK as string | undefined) === 'true';

export interface ApiError extends Error {
  status?: number;
  body?: unknown;
}

function makeError(message: string, status?: number, body?: unknown): ApiError {
  const err = new Error(message) as ApiError;
  err.name = 'ApiError';
  err.status = status;
  err.body = body;
  return err;
}

async function http<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  query?: Record<string, string | number | boolean | undefined | null>,
): Promise<T> {
  // Build query string
  const qs = new URLSearchParams();
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      qs.append(k, String(v));
    }
  }
  const url = `${API_BASE_URL}${path}${qs.toString() ? `?${qs.toString()}` : ''}`;

  const headers: Record<string, string> = {};
  const token = localStorage.getItem(LS_TOKEN_KEY);
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    // Network failure: flip availability and propagate
    localStorage.setItem(LS_SERVER_OK_KEY, '0');
    throw makeError(
      `Network error contacting ${url}: ${(e as Error).message}`,
    );
  }

  if (res.ok || res.status === 304) {
    localStorage.setItem(LS_SERVER_OK_KEY, '1');
    const text = await res.text();
    if (!text) return undefined as unknown as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      // Non-JSON successful response (e.g. text/csv export)
      return text as unknown as T;
    }
  }

  // Try to parse error body
  let errBody: unknown = null;
  const errText = await res.text();
  try {
    errBody = errText ? JSON.parse(errText) : null;
  } catch {
    errBody = errText;
  }

  // If the server rejects our token, clear local auth state so the
  // ProtectedRoute kicks the user back to the login screen instead of
  // looping on silent 401s.
  if (res.status === 401) {
    localStorage.removeItem(LS_TOKEN_KEY);
    localStorage.removeItem(LS_USER_KEY);
  }

  throw makeError(
    (errBody as { error?: string } | null)?.error || `HTTP ${res.status}`,
    res.status,
    errBody,
  );
}

/**
 * Multipart-capable sibling of `http()`.
 *
 * The browser MUST set the `Content-Type` header itself — it appends the
 * multipart boundary — so we deliberately do not set it here. Setting
 * `multipart/form-data` manually would produce a body without a boundary and
 * the server would fail to parse it.
 *
 * Everything else is identical to `http()`: same base URL, same Bearer token,
 * same `ApiError` shape, same 401-clears-localStorage behaviour.
 */
async function upload<T>(path: string, form: FormData): Promise<T> {
  const url = `${API_BASE_URL}${path}`;

  const headers: Record<string, string> = {};
  const token = localStorage.getItem(LS_TOKEN_KEY);
  if (token) headers['Authorization'] = `Bearer ${token}`;
  // NOTE: no Content-Type — the browser adds it with the boundary.

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: form,
    });
  } catch (e) {
    // Network failure: flip availability and propagate
    localStorage.setItem(LS_SERVER_OK_KEY, '0');
    throw makeError(
      `Network error contacting ${url}: ${(e as Error).message}`,
    );
  }

  if (res.ok) {
    localStorage.setItem(LS_SERVER_OK_KEY, '1');
    const text = await res.text();
    if (!text) return undefined as unknown as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  // Try to parse error body
  let errBody: unknown = null;
  const errText = await res.text();
  try {
    errBody = errText ? JSON.parse(errText) : null;
  } catch {
    errBody = errText;
  }

  if (res.status === 401) {
    localStorage.removeItem(LS_TOKEN_KEY);
    localStorage.removeItem(LS_USER_KEY);
  }

  throw makeError(
    (errBody as { error?: string } | null)?.error || `HTTP ${res.status}`,
    res.status,
    errBody,
  );
}

/* ------------------------------------------------------------------ *
 *  LOCAL FALLBACK (per-browser storage)
 * ------------------------------------------------------------------ */

type Store = Record<string, unknown>;

function lsRead(): Store {
  try {
    const raw = localStorage.getItem(LS_BASE);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

function lsWrite(store: Store): void {
  localStorage.setItem(LS_BASE, JSON.stringify(store));
}

function lsGet<T>(key: string, fallback: T): T {
  const s = lsRead();
  return (s[key] as T) ?? fallback;
}

function lsSet(key: string, value: unknown): void {
  const s = lsRead();
  s[key] = value;
  lsWrite(s);
}

function uuid(): string {
  return (
    'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    }) + Date.now().toString(16)
  );
}

function hashPwd(pwd: string): string {
  // Toy hash purely to avoid storing cleartext in localStorage
  let h = 5381;
  for (let i = 0; i < pwd.length; i++) h = ((h << 5) + h) ^ pwd.charCodeAt(i);
  return `lh${(h >>> 0).toString(16)}`;
}

interface LocalUser {
  id: string;
  email: string;
  password: string;
  role: 'admin' | 'user';
  is_active: boolean;
  created_at: string;
}

function localSeed(): void {
  if (localStorage.getItem(`${LS_BASE}:seeded`)) return;

  const now = new Date().toISOString();
  const adminId = 'u_local_admin';
  const users: LocalUser[] = [
    {
      id: adminId,
      email: 'admin@corp.com',
      password: hashPwd('admin123'),
      role: 'admin',
      is_active: true,
      created_at: now,
    },
  ];
  lsSet('users', users);
  lsSet('employees', []);
  lsSet('departments', [
    { id: 'd_local_1', name: 'Engineering', color: '#3B82F6', employeeCount: 0 },
    { id: 'd_local_2', name: 'Operations', color: '#10B981', employeeCount: 0 },
  ]);
  lsSet('audit_logs', []);
  lsSet('sync_logs', []);
  lsSet('sync_settings', [
    { id: 's_outlook', sync_type: 'outlook', is_enabled: false, last_run: null, next_scheduled: null },
    { id: 's_ucm', sync_type: 'ucm', is_enabled: false, last_run: null, next_scheduled: null },
  ]);
  lsSet('session_settings', {
    id: 'global',
    inactivity_timeout_minutes: 30,
    logout_on_browser_close: false,
  });
  localStorage.setItem(`${LS_BASE}:seeded`, '1');
}

function requireAuth<T>(fn: () => T): T {
  const token = localStorage.getItem(LS_TOKEN_KEY);
  if (!token) throw makeError('Unauthenticated', 401);
  return fn();
}

function localRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): T {
  if (!LOCAL_FALLBACK_ENABLED) {
    throw makeError(
      'The AFPC ContactHub API is unreachable and the local offline mirror is disabled.',
      503,
    );
  }
  localSeed();
  const m = method.toUpperCase();
  const p = path.split('?')[0];
  const q = Object.fromEntries(
    new URLSearchParams(path.split('?')[1] || '').entries(),
  );

  // ---------- AUTH ----------
  if (p === '/auth/login' && m === 'POST') {
    const { email, password } = (body || {}) as { email: string; password: string };
    const users = lsGet<LocalUser[]>('users', []);
    const found = users.find(
      u => u.email.toLowerCase() === (email || '').toLowerCase() && u.password === hashPwd(password || ''),
    );
    if (!found || !found.is_active) throw makeError('Invalid credentials', 401);
    const token = btoa(`${found.id}:${Date.now()}`) + '.' + btoa(`local-${found.id.length}`);
    localStorage.setItem(LS_TOKEN_KEY, token);
    const safeUser = {
      id: found.id,
      email: found.email,
      role: found.role,
      is_active: found.is_active,
      employee_id: null,
      last_login: new Date().toISOString(),
      last_ip: null,
      last_os: null,
      last_browser: null,
      architecture: null,
      created_at: found.created_at,
      updated_at: found.created_at,
    };
    localStorage.setItem(LS_USER_KEY, JSON.stringify(safeUser));
    return { token, user: safeUser } as unknown as T;
  }
  if (p === '/auth/logout' && m === 'POST') {
    localStorage.removeItem(LS_TOKEN_KEY);
    localStorage.removeItem(LS_USER_KEY);
    return undefined as unknown as T;
  }
  if (p === '/auth/me' && m === 'GET') {
    const raw = localStorage.getItem(LS_USER_KEY);
    if (!raw) throw makeError('Unauthenticated', 401);
    return JSON.parse(raw) as T;
  }
  if (p === '/auth/password' && m === 'POST') {
    const { current_password, new_password } = (body || {}) as {
      current_password: string;
      new_password: string;
    };
    const users = lsGet<LocalUser[]>('users', []);
    const u = requireAuth(() =>
      users.find(x => x.id === JSON.parse(localStorage.getItem(LS_USER_KEY) || '{}').id),
    );
    if (!u || u.password !== hashPwd(current_password || '')) throw makeError('Bad current password', 400);
    u.password = hashPwd(new_password || '');
    lsSet('users', users);
    return undefined as unknown as T;
  }

  requireAuth(() => null);

  // ---------- EMPLOYEES ----------
  if (p === '/employees' && m === 'GET') {
    let list = lsGet<Record<string, unknown>[]>('employees', []);
    if (q.search) {
      const s = q.search.toLowerCase();
      list = list.filter(e =>
        String(e.full_name || '').toLowerCase().includes(s) ||
        String(e.work_email || '').toLowerCase().includes(s),
      );
    }
    if (q.department_id) list = list.filter(e => e.department_id === q.department_id);
    if (q.is_active !== undefined) list = list.filter(e => String(e.is_active) === q.is_active);
    const page = Number(q.page || 1);
    const size = Number(q.page_size || list.length || 1);
    const start = (page - 1) * size;
    return {
      data: list.slice(start, start + size),
      total: list.length,
      page,
      page_size: size,
    } as T;
  }
  if (p === '/employees' && m === 'POST') {
    const list = lsGet<Record<string, unknown>[]>('employees', []);
    const now = new Date().toISOString();
    const emp = { id: uuid(), created_at: now, is_active: true, ...(body as object) };
    list.push(emp);
    lsSet('employees', list);
    return emp as T;
  }
  const empMatch = p.match(/^\/employees\/([^/]+)$/);
  if (empMatch) {
    const id = empMatch[1];
    const list = lsGet<Record<string, unknown>[]>('employees', []);
    const idx = list.findIndex(e => e.id === id);
    if (m === 'GET') {
      if (idx < 0) throw makeError('Not found', 404);
      return list[idx] as T;
    }
    if (m === 'PUT' || m === 'PATCH') {
      if (idx < 0) throw makeError('Not found', 404);
      list[idx] = { ...list[idx], ...(body as object), updated_at: new Date().toISOString() };
      lsSet('employees', list);
      return list[idx] as T;
    }
    if (m === 'DELETE') {
      if (idx < 0) return undefined as unknown as T;
      list.splice(idx, 1);
      lsSet('employees', list);
      return undefined as unknown as T;
    }
  }

  // ---------- DEPARTMENTS ----------
  if (p === '/departments' && m === 'GET') {
    const list = lsGet<Record<string, unknown>[]>('departments', []);
    const emps = lsGet<Record<string, unknown>[]>('employees', []);
    for (const d of list) {
      d.employeeCount = emps.filter(e => e.department_id === d.id).length;
    }
    return list as T;
  }
  if (p === '/departments' && m === 'POST') {
    const list = lsGet<Record<string, unknown>[]>('departments', []);
    const d = { id: uuid(), created_at: new Date().toISOString(), ...(body as object) };
    list.push(d);
    lsSet('departments', list);
    return d as T;
  }
  const deptMatch = p.match(/^\/departments\/([^/]+)$/);
  if (deptMatch) {
    const id = deptMatch[1];
    const list = lsGet<Record<string, unknown>[]>('departments', []);
    const idx = list.findIndex(d => d.id === id);
    if (m === 'GET') {
      if (idx < 0) throw makeError('Not found', 404);
      return list[idx] as T;
    }
    if (m === 'PUT' || m === 'PATCH') {
      if (idx < 0) throw makeError('Not found', 404);
      list[idx] = { ...list[idx], ...(body as object), updated_at: new Date().toISOString() };
      lsSet('departments', list);
      return list[idx] as T;
    }
    if (m === 'DELETE') {
      if (idx < 0) return undefined as unknown as T;
      list.splice(idx, 1);
      lsSet('departments', list);
      return undefined as unknown as T;
    }
  }

  // ---------- ADMIN / USERS ----------
  if (p === '/admin/dashboard' && m === 'GET') {
    return {
      total_employees: lsGet<unknown[]>('employees', []).length,
      total_departments: lsGet<unknown[]>('departments', []).length,
      active_users: lsGet<LocalUser[]>('users', []).filter(u => u.is_active).length,
      recent_activity: lsGet<unknown[]>('audit_logs', []).length,
    } as T;
  }
  if (p === '/admin/users' && m === 'GET') {
    const users = lsGet<LocalUser[]>('users', []);
    return users.map(u => {
      const safeUser = {
        id: u.id,
        email: u.email,
        role: u.role,
        is_active: u.is_active,
        employee_id: null,
        last_login: null,
        last_ip: null,
        last_os: null,
        last_browser: null,
        architecture: null,
        created_at: u.created_at,
        updated_at: u.created_at,
      };
      return safeUser;
    }) as unknown as T;
  }
  if (p === '/admin/users/invite' && m === 'POST') {
    const { email, role, password } = (body || {}) as { email: string; role: 'admin' | 'user'; password: string };
    const users = lsGet<LocalUser[]>('users', []);
    if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) throw makeError('User exists', 409);
    const u: LocalUser = {
      id: uuid(),
      email,
      password: hashPwd(password || 'changeme'),
      role: role || 'user',
      is_active: true,
      created_at: new Date().toISOString(),
    };
    users.push(u);
    lsSet('users', users);
    return undefined as unknown as T;
  }
  const userAction = p.match(/^\/admin\/users\/([^/]+)\/(role|deactivate|password)$/);
  if (userAction) {
    const id = userAction[1];
    const action = userAction[2];
    const users = lsGet<LocalUser[]>('users', []);
    const u = users.find(x => x.id === id);
    if (!u) throw makeError('Not found', 404);
    if (action === 'role' && m === 'PATCH') u.role = (body as { role: 'admin' | 'user' }).role;
    if (action === 'deactivate' && m === 'PATCH') u.is_active = false;
    if (action === 'password' && m === 'PATCH') u.password = hashPwd((body as { password: string }).password || 'changeme');
    lsSet('users', users);
    return undefined as unknown as T;
  }

  if (p === '/admin/session-settings') {
    const cur = lsGet<Record<string, unknown>>('session_settings', {
      id: 'global',
      inactivity_timeout_minutes: 30,
      logout_on_browser_close: false,
    });
    if (m === 'GET') return cur as T;
    if (m === 'PATCH') {
      const next = { ...cur, ...(body as object) };
      lsSet('session_settings', next);
      return next as T;
    }
  }

  if (p === '/admin/audit-logs' && m === 'GET') {
    return lsGet<unknown[]>('audit_logs', []) as T;
  }

  if (p === '/admin/sync/settings' && m === 'GET') {
    return lsGet<unknown[]>('sync_settings', []) as T;
  }
  const syncToggle = p.match(/^\/admin\/sync\/settings\/([^/]+)$/);
  if (syncToggle) {
    const type = syncToggle[1];
    const list = lsGet<Record<string, unknown>[]>('sync_settings', []);
    const s = list.find(x => x.sync_type === type);
    if (s && m === 'PATCH') Object.assign(s, body as object);
    lsSet('sync_settings', list);
    return undefined as unknown as T;
  }
  const syncRun = p.match(/^\/admin\/sync\/run\/([^/]+)$/);
  if (syncRun && m === 'POST') {
    const list = lsGet<Record<string, unknown>[]>('sync_logs', []);
    list.push({
      id: uuid(),
      sync_type: syncRun[1],
      status: 'success',
      records_affected: 0,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });
    lsSet('sync_logs', list);
    return undefined as unknown as T;
  }
  if (p === '/admin/sync/logs' && m === 'GET') {
    return lsGet<unknown[]>('sync_logs', []) as T;
  }

  throw makeError(`Local fallback: route not handled (${method} ${path})`, 404);
}

/* ------------------------------------------------------------------ *
 *  PUBLIC API
 * ------------------------------------------------------------------ */

export const api = {
  get<T = unknown>(path: string, query?: Record<string, string | number | boolean | undefined | null>) {
    return http<T>('GET', path, undefined, query);
  },
  post<T = unknown>(path: string, body?: unknown) {
    return http<T>('POST', path, body);
  },
  put<T = unknown>(path: string, body?: unknown) {
    return http<T>('PUT', path, body);
  },
  patch<T = unknown>(path: string, body?: unknown) {
    return http<T>('PATCH', path, body);
  },
  delete<T = unknown>(path: string) {
    return http<T>('DELETE', path);
  },
  /**
   * Multipart upload. There is deliberately no local-fallback counterpart:
   * a binary picture cannot be mirrored into localStorage, and the local
   * router has no handler for these routes — it would throw a misleading
   * 404 in place of the real network error.
   */
  upload<T = unknown>(path: string, form: FormData) {
    return upload<T>(path, form);
  },

  /**
   * Local-only helpers used by `authService` so that when the LAN
   * server is unreachable we still have a working login flow.
   */
  __local: {
    request: <T = unknown>(method: string, path: string, body?: unknown) =>
      localRequest<T>(method, path, body),
    available: (): boolean => localStorage.getItem(LS_SERVER_OK_KEY) === '1',
  },
};

export default api;
