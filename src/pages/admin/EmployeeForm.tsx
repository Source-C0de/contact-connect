import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { employeeService } from '@/services/employeeService';
import { departmentService } from '@/services/departmentService';
import type { Employee, Department } from '@/data/mockData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { AvatarInitials } from '@/components/AvatarInitials';
import { toast } from 'sonner';

interface FormData {
  fullName: string;
  jobTitle: string;
  department: string;
  email: string;
  extension: string;
  mobile: string;
  location: string;
  status: 'active' | 'inactive';
}

export default function EmployeeForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = !!id;
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState<FormData>({
    fullName: '', jobTitle: '', department: '', email: '',
    extension: '', mobile: '', location: '', status: 'active',
  });

  const [departments, setDepartments] = useState<Department[]>([]);

  useEffect(() => {
    departmentService.getAll().then(deps => {
      setDepartments(deps);
      if (id) {
        employeeService.getById(id).then(emp => {
          const deptId = deps.find(d => d.name === emp.department)?.id || '';
          if (emp) setForm({
            fullName: emp.fullName, jobTitle: emp.jobTitle, department: deptId,
            email: emp.email, extension: emp.extension, mobile: emp.mobile,
            location: emp.location, status: emp.status,
          });
        });
      }
    });
  }, [id]);

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.fullName.trim()) errs.fullName = 'Full name is required';
    if (!form.jobTitle.trim()) errs.jobTitle = 'Job title is required';
    if (!form.department) errs.department = 'Department is required';
    if (!form.email.trim()) errs.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'Invalid email format';
    if (!form.extension.trim()) errs.extension = 'Extension is required';
    else if (!/^\d{3,4}$/.test(form.extension)) errs.extension = 'Must be 3 or 4 digits';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      if (isEdit && id) {
        await employeeService.update(id, {
          fullName: form.fullName,
          jobTitle: form.jobTitle,
          email: form.email,
          extension: form.extension,
          mobile: form.mobile,
          location: form.location,
          status: form.status,
          department_id: form.department,
        } as any);
        toast.success('Employee updated');
      } else {
        await employeeService.create({
          full_name: form.fullName,
          job_title: form.jobTitle,
          department_id: form.department,
          work_email: form.email,
          extension: form.extension,
          mobile: form.mobile || undefined,
          office_location: form.location || undefined,
        });
        toast.success('Employee created');
      }
      navigate('/admin/directory');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      toast.error(`Failed to save employee: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  const updateField = (field: keyof FormData, value: string) => {
    setForm(f => ({ ...f, [field]: value }));
    if (errors[field]) setErrors(e => ({ ...e, [field]: '' }));
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{isEdit ? 'Edit Employee' : 'Add Employee'}</h1>
        <p className="text-sm text-muted-foreground">{isEdit ? 'Update employee information' : 'Add a new employee to the directory'}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 rounded-xl border border-border bg-card p-6 shadow-sm">
        {/* Avatar preview */}
        <div className="flex items-center gap-4">
          <AvatarInitials name={form.fullName || 'N A'} department={form.department} size="lg" />
          <div>
            <p className="text-sm font-medium text-foreground">{form.fullName || 'New Employee'}</p>
            <p className="text-xs text-muted-foreground">{form.department || 'No department'}</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="fullName">Full Name *</Label>
            <Input id="fullName" value={form.fullName} onChange={e => updateField('fullName', e.target.value)} />
            {errors.fullName && <p className="text-xs text-destructive">{errors.fullName}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="jobTitle">Job Title *</Label>
            <Input id="jobTitle" value={form.jobTitle} onChange={e => updateField('jobTitle', e.target.value)} />
            {errors.jobTitle && <p className="text-xs text-destructive">{errors.jobTitle}</p>}
          </div>
          <div className="space-y-2">
            <Label>Department *</Label>
            <Select value={form.department} onValueChange={v => updateField('department', v)}>
              <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
              <SelectContent>
                {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {errors.department && <p className="text-xs text-destructive">{errors.department}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Work Email *</Label>
            <Input id="email" type="email" value={form.email} onChange={e => updateField('email', e.target.value)} />
            {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="extension">UCM Extension *</Label>
            <Input id="extension" value={form.extension} onChange={e => updateField('extension', e.target.value)} placeholder="3 or 4 digits" />
            {errors.extension && <p className="text-xs text-destructive">{errors.extension}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="mobile">Mobile Number</Label>
            <Input id="mobile" value={form.mobile} onChange={e => updateField('mobile', e.target.value)} placeholder="+1 (555) 000-0000" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="location">Office Location</Label>
            <Input id="location" value={form.location} onChange={e => updateField('location', e.target.value)} />
          </div>
          <div className="flex items-center gap-3 sm:col-span-2">
            <Switch
              checked={form.status === 'active'}
              onCheckedChange={v => setForm(f => ({ ...f, status: v ? 'active' : 'inactive' }))}
            />
            <Label>Active</Label>
          </div>
        </div>

        <div className="flex gap-3 justify-end">
          <Button type="button" variant="outline" onClick={() => navigate('/admin/directory')}>Cancel</Button>
          <Button type="submit" disabled={loading}>
            {loading ? 'Saving...' : isEdit ? 'Update Employee' : 'Add Employee'}
          </Button>
        </div>
      </form>
    </div>
  );
}
