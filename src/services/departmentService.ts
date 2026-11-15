import { api } from '@/lib/api';
import type { Department } from '@/data/mockData';

interface BackendDepartment {
  id: string;
  name: string;
  code?: string;
  color?: string;
  created_at?: string;
  updated_at?: string;
  employeeCount?: number;
}

function mapDepartment(dept: BackendDepartment): Department {
  return {
    id: dept.id,
    name: dept.name,
    color: dept.color || '#3B82F6',
    employeeCount: dept.employeeCount || 0,
  };
}

// 4xx errors should bubble up — masking them with localStorage data would
// hide a real bug (e.g. permission, validation). Network errors and 5xx
// should fall back so the page still renders.
function isLocalFallbackWorthy(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  if (status && status >= 400 && status < 500) return false;
  return true;
}

export const departmentService = {
  async getAll(): Promise<Department[]> {
    try {
      const depts = await api.get<BackendDepartment[]>('/departments');
      return depts.map(mapDepartment);
    } catch (err) {
      if (!isLocalFallbackWorthy(err)) throw err;
      const depts = await api.__local.request<BackendDepartment[]>('GET', '/departments');
      return (Array.isArray(depts) ? depts : []).map(mapDepartment);
    }
  },

  async create(name: string, color: string): Promise<Department> {
    try {
      const dept = await api.post<BackendDepartment>('/departments', {
        name,
        code: name.substring(0, 3).toUpperCase(),
        color,
      });
      return mapDepartment(dept);
    } catch (err) {
      if (!isLocalFallbackWorthy(err)) throw err;
      const dept = await api.__local.request<BackendDepartment>('POST', '/departments', {
        name,
        code: name.substring(0, 3).toUpperCase(),
        color,
      });
      return mapDepartment(dept);
    }
  },

  async rename(id: string, newName: string): Promise<Department> {
    try {
      const dept = await api.put<BackendDepartment>(`/departments/${id}`, {
        name: newName,
        code: newName.substring(0, 3).toUpperCase(),
      });
      return mapDepartment(dept);
    } catch (err) {
      if (!isLocalFallbackWorthy(err)) throw err;
      const dept = await api.__local.request<BackendDepartment>('PUT', `/departments/${id}`, {
        name: newName,
        code: newName.substring(0, 3).toUpperCase(),
      });
      return mapDepartment(dept);
    }
  },

  async update(id: string, data: { name?: string; color?: string }): Promise<Department> {
    const updates: Record<string, unknown> = {};
    if (data.name) {
      updates.name = data.name;
      updates.code = data.name.substring(0, 3).toUpperCase();
    }
    if (data.color) updates.color = data.color;

    try {
      const dept = await api.put<BackendDepartment>(`/departments/${id}`, updates);
      return mapDepartment(dept);
    } catch (err) {
      if (!isLocalFallbackWorthy(err)) throw err;
      const dept = await api.__local.request<BackendDepartment>('PUT', `/departments/${id}`, updates);
      return mapDepartment(dept);
    }
  },

  async delete(id: string): Promise<void> {
    try {
      await api.delete(`/departments/${id}`);
    } catch (err) {
      if (!isLocalFallbackWorthy(err)) throw err;
      await api.__local.request('DELETE', `/departments/${id}`);
    }
  },
};
