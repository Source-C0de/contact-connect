import { api, type PaginatedResponse } from '@/lib/api';
import type { Employee } from '@/data/mockData';
import type { Department } from '@/data/mockData';

// The LAN server returns camelCase fields (fullName, workEmail, ...)
// while the per-browser localStorage mirror uses snake_case. Accept both
// so a single mapper works against either backend.
interface BackendEmployee {
  id: string;
  fullName?: string;
  full_name?: string;
  jobTitle?: string;
  job_title?: string;
  department?: string;
  department_name?: string;
  departmentId?: string;
  department_id?: string;
  email?: string;
  work_email?: string;
  extension?: string;
  mobile?: string | null;
  location?: string;
  office_location?: string | null;
  status?: 'active' | 'inactive';
  onlineStatus?: 'online' | 'offline';
  is_active?: boolean;
  createdAt?: string;
  created_at?: string;
  dateAdded?: string;
}

function toIsoDate(value: string | undefined): string {
  if (!value) return '';
  // Already a plain "YYYY-MM-DD" — keep as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
}

function mapEmployee(emp: BackendEmployee): Employee {
  const fullName = emp.fullName || emp.full_name || '';
  const jobTitle = emp.jobTitle || emp.job_title || '';
  const department = emp.department || emp.department_name || '';
  const email = emp.email || emp.work_email || '';
  const active =
    emp.status === 'active' ||
    emp.status === undefined
      ? emp.status === 'inactive' ? false : (emp.is_active ?? true)
      : true;
  return {
    id: emp.id,
    fullName,
    jobTitle,
    department,
    email,
    extension: emp.extension || '',
    mobile: emp.mobile || '',
    location: emp.location || emp.office_location || '',
    status: active ? 'active' : 'inactive',
    onlineStatus: emp.onlineStatus || (active ? 'online' : 'offline'),
    dateAdded: toIsoDate(emp.dateAdded || emp.createdAt || emp.created_at),
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
