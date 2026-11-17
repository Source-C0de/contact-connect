import { api, type PaginatedResponse } from '@/lib/api';
import { absoluteApiUrl } from '@/lib/apiBase';
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
  photoUrl?: string | null;
  photo_url?: string | null;
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
    photoUrl: absoluteApiUrl(emp.photoUrl ?? emp.photo_url ?? undefined),
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

// A request that should NOT be retried via local fallback. 4xx errors mean
// "your input was wrong" (or auth expired) — silently substituting local data
// would hide a real bug from the user.
function isLocalFallbackWorthy(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  if (status && status >= 400 && status < 500) return false;
  return true;
}

// The localStorage mirror returns plain `{ data, total, page, page_size }`
// for /employees (see api.__local.request). The LAN server does too, so this
// shape is the same in both branches.
interface LocalEmployeePage {
  data: BackendEmployee[];
}

export const employeeService = {
  async getAll(filters?: EmployeeFilters): Promise<Employee[]> {
    const params: Record<string, string> = {};
    if (filters?.search) params.search = filters.search;
    if (filters?.department_id) params.department_id = filters.department_id;
    if (filters?.is_active !== undefined) params.is_active = String(filters.is_active);
    if (filters?.page) params.page = String(filters.page);
    if (filters?.page_size) params.page_size = String(filters.page_size);

    try {
      const response = await api.get<PaginatedResponse<BackendEmployee>>('/employees', params);
      return response.data.map(mapEmployee);
    } catch (err) {
      if (!isLocalFallbackWorthy(err)) throw err;
      // Fall back to localStorage — same query params, snake_case fields.
      // api.__local.request takes the path (including query string), not a
      // params object.
      const qs = new URLSearchParams(params).toString();
      const local = await api.__local.request<LocalEmployeePage>(
        'GET',
        `/employees${qs ? `?${qs}` : ''}`,
      );
      return (Array.isArray(local?.data) ? local.data : []).map(mapEmployee);
    }
  },

  async getById(id: string): Promise<Employee> {
    try {
      const emp = await api.get<BackendEmployee>(`/employees/${id}`);
      return mapEmployee(emp);
    } catch (err) {
      if (!isLocalFallbackWorthy(err)) throw err;
      const emp = await api.__local.request<BackendEmployee>('GET', `/employees/${id}`);
      return mapEmployee(emp);
    }
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
    try {
      const emp = await api.post<BackendEmployee>('/employees', data);
      return mapEmployee(emp);
    } catch (err) {
      if (!isLocalFallbackWorthy(err)) throw err;
      const emp = await api.__local.request<BackendEmployee>('POST', '/employees', data);
      return mapEmployee(emp);
    }
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
    if ((data as any).department_id !== undefined) backendData.department_id = (data as any).department_id;

    try {
      const emp = await api.put<BackendEmployee>(`/employees/${id}`, backendData);
      return mapEmployee(emp);
    } catch (err) {
      if (!isLocalFallbackWorthy(err)) throw err;
      const emp = await api.__local.request<BackendEmployee>('PUT', `/employees/${id}`, backendData);
      return mapEmployee(emp);
    }
  },

  async delete(id: string): Promise<void> {
    try {
      await api.delete(`/employees/${id}`);
    } catch (err) {
      if (!isLocalFallbackWorthy(err)) throw err;
      await api.__local.request('DELETE', `/employees/${id}`);
    }
  },

  /**
   * Upload (or replace) an employee's profile picture.
   *
   * Deliberately has NO local-fallback branch: a binary picture cannot be
   * mirrored into localStorage, and the local router has no handler for this
   * route — it would throw a misleading 404 in place of the real network
   * error.
   */
  async uploadEmployeePhoto(employeeId: string, file: File): Promise<Employee> {
    const form = new FormData();
    form.append('photo', file, file.name);
    const emp = await api.upload<BackendEmployee>(`/admin/employees/${employeeId}/photo`, form);
    return mapEmployee(emp);
  },

  async removeEmployeePhoto(employeeId: string): Promise<Employee> {
    const emp = await api.delete<BackendEmployee>(`/admin/employees/${employeeId}/photo`);
    return mapEmployee(emp);
  },

  async bulkDelete(ids: string[]): Promise<void> {
    await Promise.all(ids.map(id => this.delete(id)));
  },

  async bulkDeactivate(ids: string[]): Promise<void> {
    await Promise.all(ids.map(id => this.update(id, { status: 'inactive' })));
  },
};
