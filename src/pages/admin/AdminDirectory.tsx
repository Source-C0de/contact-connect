import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { employeeService } from '@/services/employeeService';
import type { Employee } from '@/data/mockData';
import { DEPARTMENT_COLORS } from '@/data/mockData';
import { SearchInput } from '@/components/SearchInput';
import { AvatarInitials } from '@/components/AvatarInitials';
import { DepartmentBadge } from '@/components/DepartmentBadge';
import { ConfirmModal } from '@/components/ConfirmModal';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Pencil, Trash2, UserX, UserCheck, Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

export default function AdminDirectory() {
  const navigate = useNavigate();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'name' | 'department' | 'dateAdded'>('name');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [confirmAction, setConfirmAction] = useState<{ type: string; ids: string[] } | null>(null);
  const perPage = 10;

  useEffect(() => {
    employeeService.getAll().then(setEmployees);
  }, []);

  const filtered = useMemo(() => {
    let result = employees;
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(e =>
        e.fullName.toLowerCase().includes(s) ||
        e.email.toLowerCase().includes(s) ||
        e.extension.includes(s) ||
        e.department.toLowerCase().includes(s)
      );
    }
    if (deptFilter !== 'all') result = result.filter(e => e.department === deptFilter);
    if (statusFilter !== 'all') result = result.filter(e => e.status === statusFilter);
    result.sort((a, b) => {
      if (sortBy === 'name') return a.fullName.localeCompare(b.fullName);
      if (sortBy === 'department') return a.department.localeCompare(b.department);
      return b.dateAdded.localeCompare(a.dateAdded);
    });
    return result;
  }, [employees, search, deptFilter, statusFilter, sortBy]);

  const totalPages = Math.ceil(filtered.length / perPage);
  const paged = filtered.slice((page - 1) * perPage, page * perPage);

  const departments = [...new Set(employees.map(e => e.department))];

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const toggleAll = () => {
    if (selected.size === paged.length) setSelected(new Set());
    else setSelected(new Set(paged.map(e => e.id)));
  };

  const handleDelete = async (ids: string[]) => {
    await employeeService.bulkDelete(ids);
    const updated = await employeeService.getAll();
    setEmployees(updated);
    setSelected(new Set());
    toast.success(`${ids.length} employee(s) deleted`);
  };

  const handleToggleStatus = async (id: string, current: string) => {
    const newStatus = current === 'active' ? 'inactive' : 'active';
    await employeeService.update(id, { status: newStatus as any, onlineStatus: newStatus === 'inactive' ? 'offline' : 'online' });
    const updated = await employeeService.getAll();
    setEmployees(updated);
    toast.success(`Employee ${newStatus === 'active' ? 'activated' : 'deactivated'}`);
  };

  const handleBulkDeactivate = async (ids: string[]) => {
    await employeeService.bulkDeactivate(ids);
    const updated = await employeeService.getAll();
    setEmployees(updated);
    setSelected(new Set());
    toast.success(`${ids.length} employee(s) deactivated`);
  };

  const executeConfirm = () => {
    if (!confirmAction) return;
    if (confirmAction.type === 'delete') handleDelete(confirmAction.ids);
    else if (confirmAction.type === 'deactivate') handleBulkDeactivate(confirmAction.ids);
    setConfirmAction(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Employee Directory</h1>
          <p className="text-sm text-muted-foreground">{filtered.length} employees</p>
        </div>
        <Button onClick={() => navigate('/admin/employees/new')}>
          <Plus className="mr-2 h-4 w-4" /> Add Employee
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by name, email, ext..." className="sm:w-72" />
        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Department" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            {departments.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={v => setSortBy(v as any)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="department">Department</SelectItem>
            <SelectItem value="dateAdded">Date Added</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-primary/5 p-3 border border-primary/20">
          <span className="text-sm font-medium text-foreground">{selected.size} selected</span>
          <Button size="sm" variant="outline" onClick={() => setConfirmAction({ type: 'deactivate', ids: [...selected] })}>
            <UserX className="mr-1 h-3.5 w-3.5" /> Deactivate
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setConfirmAction({ type: 'delete', ids: [...selected] })}>
            <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="p-3 text-left w-10">
                <Checkbox checked={paged.length > 0 && selected.size === paged.length} onCheckedChange={toggleAll} />
              </th>
              <th className="p-3 text-left font-medium text-muted-foreground">Employee</th>
              <th className="p-3 text-left font-medium text-muted-foreground hidden md:table-cell">Job Title</th>
              <th className="p-3 text-left font-medium text-muted-foreground hidden lg:table-cell">Department</th>
              <th className="p-3 text-left font-medium text-muted-foreground hidden lg:table-cell">Email</th>
              <th className="p-3 text-left font-medium text-muted-foreground hidden sm:table-cell">Ext.</th>
              <th className="p-3 text-left font-medium text-muted-foreground hidden xl:table-cell">Mobile</th>
              <th className="p-3 text-left font-medium text-muted-foreground">Status</th>
              <th className="p-3 text-left font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paged.map(emp => (
              <tr key={emp.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                <td className="p-3">
                  <Checkbox checked={selected.has(emp.id)} onCheckedChange={() => toggleSelect(emp.id)} />
                </td>
                <td className="p-3">
                  <div className="flex items-center gap-3">
                    <AvatarInitials name={emp.fullName} department={emp.department} size="sm" />
                    <span className="font-medium text-foreground">{emp.fullName}</span>
                  </div>
                </td>
                <td className="p-3 text-muted-foreground hidden md:table-cell">{emp.jobTitle}</td>
                <td className="p-3 hidden lg:table-cell">
                  <DepartmentBadge department={emp.department} color={DEPARTMENT_COLORS[emp.department]} />
                </td>
                <td className="p-3 text-muted-foreground hidden lg:table-cell">{emp.email}</td>
                <td className="p-3 text-muted-foreground hidden sm:table-cell">{emp.extension}</td>
                <td className="p-3 text-muted-foreground hidden xl:table-cell">{emp.mobile}</td>
                <td className="p-3">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                    emp.status === 'active' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                  }`}>
                    {emp.status}
                  </span>
                </td>
                <td className="p-3">
                  <div className="flex items-center gap-1">
                    <button onClick={() => navigate(`/admin/employees/${emp.id}/edit`)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button onClick={() => handleToggleStatus(emp.id, emp.status)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                      {emp.status === 'active' ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={() => setConfirmAction({ type: 'delete', ids: [emp.id] })}
                      className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, filtered.length)} of {filtered.length}
          </p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {Array.from({ length: totalPages }, (_, i) => (
              <Button
                key={i}
                variant={page === i + 1 ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPage(i + 1)}
                className="w-8"
              >
                {i + 1}
              </Button>
            ))}
            <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!confirmAction}
        onOpenChange={() => setConfirmAction(null)}
        title={confirmAction?.type === 'delete' ? 'Delete Employee(s)' : 'Deactivate Employee(s)'}
        description={confirmAction?.type === 'delete'
          ? `Are you sure you want to delete ${confirmAction?.ids.length} employee(s)? This action cannot be undone.`
          : `Are you sure you want to deactivate ${confirmAction?.ids.length} employee(s)?`
        }
        onConfirm={executeConfirm}
        confirmLabel={confirmAction?.type === 'delete' ? 'Delete' : 'Deactivate'}
        destructive={confirmAction?.type === 'delete'}
      />
    </div>
  );
}
