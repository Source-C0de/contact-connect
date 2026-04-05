import { mockDepartments, type Department } from '@/data/mockData';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let departments = [...mockDepartments];

export const departmentService = {
  async getAll(): Promise<Department[]> {
    await delay(200);
    return [...departments];
  },

  async create(name: string, color: string): Promise<Department> {
    await delay(400);
    const dept: Department = {
      id: String(Date.now()),
      name,
      color,
      employeeCount: 0,
    };
    departments.push(dept);
    return dept;
  },

  async rename(id: string, newName: string): Promise<Department> {
    await delay(300);
    const index = departments.findIndex(d => d.id === id);
    if (index === -1) throw new Error('Department not found');
    departments[index] = { ...departments[index], name: newName };
    return departments[index];
  },

  async delete(id: string): Promise<void> {
    await delay(400);
    departments = departments.filter(d => d.id !== id);
  },
};
