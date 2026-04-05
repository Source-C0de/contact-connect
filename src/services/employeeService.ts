import { mockEmployees, type Employee } from '@/data/mockData';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let employees = [...mockEmployees];

export const employeeService = {
  async getAll(): Promise<Employee[]> {
    await delay(300);
    return [...employees];
  },

  async getById(id: string): Promise<Employee | undefined> {
    await delay(200);
    return employees.find(e => e.id === id);
  },

  async create(data: Omit<Employee, 'id' | 'dateAdded'>): Promise<Employee> {
    await delay(500);
    const newEmployee: Employee = {
      ...data,
      id: String(Date.now()),
      dateAdded: new Date().toISOString().split('T')[0],
    };
    employees.push(newEmployee);
    return newEmployee;
  },

  async update(id: string, data: Partial<Employee>): Promise<Employee> {
    await delay(500);
    const index = employees.findIndex(e => e.id === id);
    if (index === -1) throw new Error('Employee not found');
    employees[index] = { ...employees[index], ...data };
    return employees[index];
  },

  async delete(id: string): Promise<void> {
    await delay(400);
    employees = employees.filter(e => e.id !== id);
  },

  async bulkDelete(ids: string[]): Promise<void> {
    await delay(600);
    employees = employees.filter(e => !ids.includes(e.id));
  },

  async bulkDeactivate(ids: string[]): Promise<void> {
    await delay(600);
    employees = employees.map(e =>
      ids.includes(e.id) ? { ...e, status: 'inactive' as const, onlineStatus: 'offline' as const } : e
    );
  },
};
