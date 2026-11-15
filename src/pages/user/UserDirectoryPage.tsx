import { useState, useEffect, useMemo } from 'react';
import { employeeService } from '@/services/employeeService';
import type { Employee, OnlineStatus } from '@/data/mockData';
import { useDepartmentColors } from '@/hooks/useDepartmentColors';
import { SearchInput } from '@/components/SearchInput';
import { AvatarInitials } from '@/components/AvatarInitials';
import { DepartmentBadge } from '@/components/DepartmentBadge';
import { StatusDot } from '@/components/StatusDot';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { LayoutGrid, List, X, Phone, Mail, MapPin, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export default function UserDirectory() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedDepts, setSelectedDepts] = useState<Set<string>>(new Set());
  const [selectedStatuses, setSelectedStatuses] = useState<Set<OnlineStatus>>(new Set());
  const [drawerEmployee, setDrawerEmployee] = useState<Employee | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const { getColor } = useDepartmentColors();

  useEffect(() => { employeeService.getAll().then(e => setEmployees(e.filter(emp => emp.status === 'active'))); }, []);

  const departments = [...new Set(employees.map(e => e.department))];

  const filtered = useMemo(() => {
    let result = employees;
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(e =>
        e.fullName.toLowerCase().includes(s) || e.extension.includes(s) ||
        e.email.toLowerCase().includes(s) || e.department.toLowerCase().includes(s) ||
        e.jobTitle.toLowerCase().includes(s)
      );
    }
    if (selectedDepts.size > 0) result = result.filter(e => selectedDepts.has(e.department));
    if (selectedStatuses.size > 0) result = result.filter(e => selectedStatuses.has(e.onlineStatus));
    return result;
  }, [employees, search, selectedDepts, selectedStatuses]);

  const toggleDept = (d: string) => {
    const next = new Set(selectedDepts);
    next.has(d) ? next.delete(d) : next.add(d);
    setSelectedDepts(next);
  };

  const toggleStatus = (s: OnlineStatus) => {
    const next = new Set(selectedStatuses);
    next.has(s) ? next.delete(s) : next.add(s);
    setSelectedStatuses(next);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  return (
    <div className="flex gap-6">
      {/* Filter sidebar - desktop */}
      <aside className="hidden lg:block w-56 shrink-0 space-y-6">
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3">Department</h3>
          <div className="space-y-2">
            {departments.map(d => (
              <label key={d} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={selectedDepts.has(d)} onCheckedChange={() => toggleDept(d)} />
                <span className="text-foreground">{d}</span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3">Status</h3>
          <div className="space-y-2">
            {(['online', 'away', 'offline'] as OnlineStatus[]).map(s => (
              <label key={s} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={selectedStatuses.has(s)} onCheckedChange={() => toggleStatus(s)} />
                <StatusDot status={s} />
                <span className="capitalize text-foreground">{s}</span>
              </label>
            ))}
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 space-y-4 min-w-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Contact Directory</h1>
            <p className="text-sm text-muted-foreground">{filtered.length} contacts</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setShowFilters(!showFilters)}>Filters</Button>
            <Button variant={viewMode === 'grid' ? 'default' : 'outline'} size="icon" className="h-9 w-9" onClick={() => setViewMode('grid')}>
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button variant={viewMode === 'list' ? 'default' : 'outline'} size="icon" className="h-9 w-9" onClick={() => setViewMode('list')}>
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Mobile filters */}
        {showFilters && (
          <div className="lg:hidden rounded-xl border border-border bg-card p-4 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-2">Department</h3>
              <div className="flex flex-wrap gap-2">
                {departments.map(d => (
                  <label key={d} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <Checkbox checked={selectedDepts.has(d)} onCheckedChange={() => toggleDept(d)} />
                    <span>{d}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-2">Status</h3>
              <div className="flex gap-3">
                {(['online', 'away', 'offline'] as OnlineStatus[]).map(s => (
                  <label key={s} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <Checkbox checked={selectedStatuses.has(s)} onCheckedChange={() => toggleStatus(s)} />
                    <StatusDot status={s} />
                    <span className="capitalize">{s}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        <SearchInput value={search} onChange={setSearch} placeholder="Search by name, extension, email, department..." />

        {/* Grid view */}
        {viewMode === 'grid' ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map(emp => (
              <button
                key={emp.id}
                onClick={() => setDrawerEmployee(emp)}
                className="rounded-xl border border-border bg-card p-5 shadow-sm text-left hover:shadow-md hover:border-primary/30 transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <AvatarInitials name={emp.fullName} department={emp.department} color={getColor(emp.department)} size="md" />
                    <StatusDot status={emp.onlineStatus} className="absolute -bottom-0.5 -right-0.5 ring-2 ring-card" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground truncate">{emp.fullName}</p>
                    <p className="text-xs text-muted-foreground truncate">{emp.jobTitle}</p>
                  </div>
                </div>
                <div className="mt-3 space-y-1.5">
                  <DepartmentBadge department={emp.department} color={getColor(emp.department)} />
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Phone className="h-3 w-3" /> Ext. {emp.extension}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground truncate">
                    <Mail className="h-3 w-3 shrink-0" /> {emp.email}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="p-3 text-left font-medium text-muted-foreground">Name</th>
                  <th className="p-3 text-left font-medium text-muted-foreground hidden md:table-cell">Title</th>
                  <th className="p-3 text-left font-medium text-muted-foreground hidden sm:table-cell">Department</th>
                  <th className="p-3 text-left font-medium text-muted-foreground">Ext.</th>
                  <th className="p-3 text-left font-medium text-muted-foreground hidden lg:table-cell">Email</th>
                  <th className="p-3 text-left font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(emp => (
                  <tr
                    key={emp.id}
                    onClick={() => setDrawerEmployee(emp)}
                    className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer"
                  >
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        <AvatarInitials name={emp.fullName} department={emp.department} color={getColor(emp.department)} size="sm" />
                        <span className="font-medium text-foreground">{emp.fullName}</span>
                      </div>
                    </td>
                    <td className="p-3 text-muted-foreground hidden md:table-cell">{emp.jobTitle}</td>
                    <td className="p-3 hidden sm:table-cell">
                      <DepartmentBadge department={emp.department} color={getColor(emp.department)} />
                    </td>
                    <td className="p-3 text-muted-foreground">{emp.extension}</td>
                    <td className="p-3 text-muted-foreground hidden lg:table-cell">{emp.email}</td>
                    <td className="p-3"><StatusDot status={emp.onlineStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {drawerEmployee && (
        <>
          <div className="fixed inset-0 z-40 bg-foreground/20" onClick={() => setDrawerEmployee(null)} />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-card shadow-xl border-l border-border animate-slide-in-right overflow-y-auto">
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-foreground">Contact Details</h2>
                <button onClick={() => setDrawerEmployee(null)} className="rounded-lg p-2 text-muted-foreground hover:bg-muted">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex items-center gap-4">
                <div className="relative">
                  <AvatarInitials name={drawerEmployee.fullName} department={drawerEmployee.department} color={getColor(drawerEmployee.department)} size="lg" />
                  <StatusDot status={drawerEmployee.onlineStatus} className="absolute -bottom-0.5 -right-0.5 ring-2 ring-card h-3.5 w-3.5" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-foreground">{drawerEmployee.fullName}</h3>
                  <p className="text-sm text-muted-foreground">{drawerEmployee.jobTitle}</p>
                  <DepartmentBadge department={drawerEmployee.department} color={getColor(drawerEmployee.department)} className="mt-1" />
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-3 text-sm">
                  <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-foreground">{drawerEmployee.location}</span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 text-sm">
                    <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                    <a href={`mailto:${drawerEmployee.email}`} className="text-primary hover:underline">{drawerEmployee.email}</a>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => copyToClipboard(drawerEmployee.email, 'Email')}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 text-sm">
                    <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-foreground">Ext. {drawerEmployee.extension}</span>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => copyToClipboard(drawerEmployee.extension, 'Extension')}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {drawerEmployee.mobile && (
                  <div className="flex items-center gap-3 text-sm">
                    <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-foreground">{drawerEmployee.mobile}</span>
                  </div>
                )}

                <div className="flex items-center gap-2 text-sm">
                  <StatusDot status={drawerEmployee.onlineStatus} />
                  <span className="capitalize text-foreground">{drawerEmployee.onlineStatus}</span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
