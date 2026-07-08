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

export const departmentService = {
  async getAll(): Promise<Department[]> {
    const depts = await api.get<BackendDepartment[]>('/departments');
    return depts.map(mapDepartment);
  },

  async create(name: string, color: string): Promise<Department> {
    const dept = await api.post<BackendDepartment>('/departments', {
      name,
      code: name.substring(0, 3).toUpperCase(),
    });
    return mapDepartment(dept);
  },

  async rename(id: string, newName: string): Promise<Department> {
    const dept = await api.put<BackendDepartment>(`/departments/${id}`, {
      name: newName,
      code: newName.substring(0, 3).toUpperCase(),
    });
    return mapDepartment(dept);
  },

  async update(id: string, data: { name?: string; color?: string }): Promise<Department> {
    const updates: Record<string, unknown> = {};
    if (data.name) {
      updates.name = data.name;
      updates.code = data.name.substring(0, 3).toUpperCase();
    }
    if (data.color) updates.color = data.color;
    
    const dept = await api.put<BackendDepartment>(`/departments/${id}`, updates);
    return mapDepartment(dept);
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/departments/${id}`);
  },
};
