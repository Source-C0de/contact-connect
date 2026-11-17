import { useState, useEffect } from 'react';
import { employeeService } from '@/services/employeeService';
import { departmentService } from '@/services/departmentService';
import type { Employee, Department } from '@/data/mockData';
import { StatCard } from '@/components/StatCard';
import { AvatarInitials } from '@/components/AvatarInitials';
import { Users, UserCheck, Building2, UserPlus, RefreshCw } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function AdminDashboard() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);

  useEffect(() => {
    employeeService.getAll().then(setEmployees);
    departmentService.getAll().then(setDepartments);
  }, []);

  const activeCount = employees.filter(e => e.status === 'active').length;
  const onlineCount = employees.filter(e => e.onlineStatus === 'online').length;
  const recentEmployees = [...employees].sort((a, b) => b.dateAdded.localeCompare(a.dateAdded)).slice(0, 5);
  const newThisWeek = employees.filter(e => {
    const d = new Date(e.dateAdded);
    const now = new Date();
    const diff = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
    return diff <= 7;
  }).length;

  const chartData = departments.map(d => ({
    name: d.name,
    count: employees.filter(e => e.department === d.name).length,
    fill: d.color,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Overview of your employee directory</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Employees" value={employees.length} icon={Users} />
        <StatCard label="Active Today" value={onlineCount} icon={UserCheck} badge={`${activeCount} active`} />
        <StatCard label="Departments" value={departments.length} icon={Building2} />
        <StatCard label="New This Week" value={newThisWeek} icon={UserPlus} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Chart */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-foreground">Employees by Department</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(210 15% 90%)" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="count" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Recent employees */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-foreground">Recently Added</h2>
          <div className="space-y-3">
            {recentEmployees.map(emp => (
              <div key={emp.id} className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/50">
                <AvatarInitials name={emp.fullName} department={emp.department} src={emp.photoUrl} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{emp.fullName}</p>
                  <p className="text-xs text-muted-foreground">{emp.department}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-muted-foreground">Ext. {emp.extension}</p>
                  <p className="text-xs text-muted-foreground">{emp.dateAdded}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Sync status */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-foreground">Sync Status</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-center gap-3 rounded-lg border border-border p-4">
            <RefreshCw className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">Microsoft 365 / Outlook</p>
              <p className="text-xs text-muted-foreground">Last sync: Today at 08:00 AM</p>
            </div>
            <span className="ml-auto rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">Synced</span>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-border p-4">
            <RefreshCw className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">UCM System</p>
              <p className="text-xs text-muted-foreground">Last sync: Today at 08:00 AM</p>
            </div>
            <span className="ml-auto rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">Synced</span>
          </div>
        </div>
      </div>
    </div>
  );
}
