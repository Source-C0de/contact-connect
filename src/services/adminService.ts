import { api, type PaginatedResponse } from '@/lib/api';
import type { SystemUser } from '@/data/mockData';

interface BackendUser {
  id: string;
  employee_id: string | null;
  email: string;
  role: 'admin' | 'user';
  is_active: boolean;
  last_login: string | null;
  created_at: string;
  updated_at: string;
}

interface DashboardStats {
  total_employees: number;
  total_departments: number;
  active_users: number;
  recent_activity: number;
}

function mapSystemUser(user: BackendUser): SystemUser {
  return {
    id: user.id,
    name: user.email.split('@')[0],
    email: user.email,
    role: user.role,
    lastLogin: user.last_login || 'Never',
    status: user.is_active ? 'active' : 'inactive',
  };
}

export const adminService = {
  async getDashboard(): Promise<DashboardStats> {
    return await api.get<DashboardStats>('/admin/dashboard');
  },

  async getUsers(): Promise<SystemUser[]> {
    const response = await api.get<PaginatedResponse<BackendUser>>('/admin/users');
    return response.data.map(mapSystemUser);
  },

  async inviteUser(email: string, role: 'admin' | 'user'): Promise<void> {
    await api.post('/admin/users/invite', { email, role });
  },

  async changeRole(userId: string, role: 'admin' | 'user'): Promise<void> {
    await api.patch(`/admin/users/${userId}/role`, { role });
  },

  async deactivateUser(userId: string): Promise<void> {
    await api.patch(`/admin/users/${userId}/deactivate`);
  },
};
