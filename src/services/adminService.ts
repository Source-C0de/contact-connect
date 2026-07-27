import { api, type PaginatedResponse } from '@/lib/api';
import type { SystemUser } from '@/data/mockData';

interface BackendUser {
  id: string;
  employee_id?: string | null;
  email: string;
  role: 'admin' | 'user';
  // Server (LAN) returns camelCase via publicUser(); legacy/localStorage fallback
  // shapes use snake_case. We accept both so the same mapper handles both paths.
  isActive?: boolean;
  is_active?: boolean;
  lastLogin?: string | null;
  last_login?: string | null;
  last_ip?: string | null;
  last_os?: string | null;
  last_browser?: string | null;
  architecture?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface DashboardStats {
  total_employees: number;
  total_departments: number;
  active_users: number;
  recent_activity: number;
}

function mapSystemUser(user: BackendUser): SystemUser {
  const isActive = user.isActive ?? user.is_active ?? false;
  const lastLogin = user.lastLogin ?? user.last_login ?? null;
  const nameFromEmail = user.email.split('@')[0];
  return {
    id: user.id,
    name: nameFromEmail,
    email: user.email,
    role: user.role,
    lastLogin: lastLogin || 'Never',
    status: isActive ? 'active' : 'inactive',
    lastIP: user.last_ip ?? null,
    lastOS: user.last_os ?? null,
    lastBrowser: user.last_browser ?? null,
    architecture: user.architecture ?? null,
  };
}

export interface SessionSettings {
  id: string;
  inactivity_timeout_minutes: number;
  logout_on_browser_close: boolean;
}

export const adminService = {
  async getDashboard(): Promise<DashboardStats> {
    return await api.get<DashboardStats>('/admin/dashboard');
  },

  async getUsers(): Promise<SystemUser[]> {
    try {
      const response = await api.get<BackendUser[]>('/admin/users');
      return Array.isArray(response) ? response.map(mapSystemUser) : [];
    } catch (err) {
      // LAN server unreachable (e.g. inside Docker while the API is still
      // coming up, or a transient network blip) -> fall back to the
      // per-browser localStorage store so the admin page still renders.
      const status = (err as { status?: number } | null)?.status;
      if (status && status >= 400 && status < 500) throw err; // 401/403/404 = real errors, don't mask
      const local = await api.__local.request<BackendUser[]>('GET', '/admin/users');
      return Array.isArray(local) ? local.map(mapSystemUser) : [];
    }
  },

  async inviteUser(email: string, role: 'admin' | 'user', password: string): Promise<void> {
    try {
      await api.post('/admin/users/invite', { email, role, password });
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      if (status && status >= 400 && status < 500) throw err;
      await api.__local.request('POST', '/admin/users/invite', { email, role, password });
    }
  },

  async changeRole(userId: string, role: 'admin' | 'user'): Promise<void> {
    try {
      await api.patch(`/admin/users/${userId}/role`, { role });
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      if (status && status >= 400 && status < 500) throw err;
      await api.__local.request('PATCH', `/admin/users/${userId}/role`, { role });
    }
  },

  async deactivateUser(userId: string): Promise<void> {
    try {
      await api.patch(`/admin/users/${userId}/deactivate`);
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      if (status && status >= 400 && status < 500) throw err;
      await api.__local.request('PATCH', `/admin/users/${userId}/deactivate`);
    }
  },

  async setPassword(userId: string, password: string): Promise<void> {
    try {
      await api.patch(`/admin/users/${userId}/password`, { password });
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      if (status && status >= 400 && status < 500) throw err;
      await api.__local.request('PATCH', `/admin/users/${userId}/password`, { password });
    }
  },

  async getSessionSettings(): Promise<SessionSettings> {
    try {
      return await api.get<SessionSettings>('/admin/session-settings');
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      if (status && status >= 400 && status < 500) throw err;
      return await api.__local.request<SessionSettings>('GET', '/admin/session-settings');
    }
  },

  async updateSessionSettings(settings: { inactivity_timeout_minutes: number; logout_on_browser_close: boolean }): Promise<SessionSettings> {
    try {
      return await api.patch<SessionSettings>('/admin/session-settings', settings);
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      if (status && status >= 400 && status < 500) throw err;
      return await api.__local.request<SessionSettings>('PATCH', '/admin/session-settings', settings);
    }
  },
};

