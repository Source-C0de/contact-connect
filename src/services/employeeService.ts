import { api, type PaginatedResponse } from '@/lib/api';
import type { Employee } from '@/data/mockData';
import type { Department } from '@/data/mockData';

interface BackendEmployee {
  id: string;
  full_name: string;
  job_title: string;
  department_id: string;
  department_name: string;
  extension: string;
  work_email: string;
  mobile: string | null;
  office_location: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

function mapEmployee(emp: BackendEmployee): Employee {
  return {
    id: emp.id,
    fullName: emp.full_name,
    jobTitle: emp.job_title,
    department: emp.department_name,
    email: emp.work_email,
    extension: emp.extension,
    mobile: emp.mobile || '',
    location: emp.office_location || '',
    status: emp.is_active ? 'active' : 'inactive',
    onlineStatus: emp.is_active ? 'online' : 'offline',
    dateAdded: new Date(emp.created_at).toISOString().split('T')[0],
  };
}

export interface EmployeeFilters {
  search?: string;
  department_id?: string;
  is_active?: boolean;
  page?: number;
  page_size?: number;
  sort_by?: string;
  sort_order?: string;
}

export const employeeService = {
  async getAll(filters?: EmployeeFilters): Promise<Employee[]> {
    const params: Record<string, string> = {};
    if (filters?.search) params.search = filters.search;
    if (filters?.department_id) params.department_id = filters.department_id;
    if (filters?.is_active !== undefined) params.is_active = String(filters.is_active);
    if (filters?.page) params.page = String(filters.page);
    if (filters?.page_size) params.page_size = String(filters.page_size);

    const response = await api.get<PaginatedResponse<BackendEmployee>>('/employees', params);
    return response.data.map(mapEmployee);
  },

  async getById(id: string): Promise<Employee> {
    const emp = await api.get<BackendEmployee>(`/employees/${id}`);
    return mapEmployee(emp);
  },

  async create(data: {
    full_name: string;
    job_title: string;
    department_id: string;
    work_email: string;
    extension: string;
    mobile?: string;
    office_location?: string;
  }): Promise<Employee> {
    const emp = await api.post<BackendEmployee>('/employees', data);
    return mapEmployee(emp);
  },

  async update(id: string, data: Partial<Employee>): Promise<Employee> {
    const backendData: Record<string, unknown> = {};
    if (data.fullName !== undefined) backendData.full_name = data.fullName;
    if (data.jobTitle !== undefined) backendData.job_title = data.jobTitle;
    if (data.email !== undefined) backendData.work_email = data.email;
    if (data.extension !== undefined) backendData.extension = data.extension;
    if (data.mobile !== undefined) backendData.mobile = data.mobile || null;
    if (data.location !== undefined) backendData.office_location = data.location || null;
    if (data.status !== undefined) backendData.is_active = data.status === 'active';
    // Add mapping for department_id
    if ((data as any).department_id !== undefined) backendData.department_id = (data as any).department_id;

    const emp = await api.put<BackendEmployee>(`/employees/${id}`, backendData);
    return mapEmployee(emp);
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/employees/${id}`);
  },

  async bulkDelete(ids: string[]): Promise<void> {
    await Promise.all(ids.map(id => this.delete(id)));
  },

  async bulkDeactivate(ids: string[]): Promise<void> {
    await Promise.all(ids.map(id => this.update(id, { status: 'inactive' })));
  },
};
