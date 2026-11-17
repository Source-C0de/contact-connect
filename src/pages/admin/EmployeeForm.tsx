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
import { PhotoUploadDialog } from '@/components/admin/PhotoUploadDialog';
import { useDepartmentColors } from '@/hooks/useDepartmentColors';
import { Image as ImageIcon } from 'lucide-react';
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
  const { getColor } = useDepartmentColors();

  // Profile picture state. A new employee has no id yet, so the picture can
  // only be set once the employee exists (the file is named after its id).
  const [photoUrl, setPhotoUrl] = useState<string | undefined>();
  const [photoOpen, setPhotoOpen] = useState(false);

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
          setPhotoUrl(emp.photoUrl);
        });
      }
    });
  }, [id]);

  const handleUploadPhoto = async (file: File) => {
    if (!id) return;
    const updated = await employeeService.uploadEmployeePhoto(id, file);
    setPhotoUrl(updated.photoUrl);
    toast.success('Profile picture updated');
  };

  const handleRemovePhoto = async () => {
    if (!id) return;
    const updated = await employeeService.removeEmployeePhoto(id);
    setPhotoUrl(updated.photoUrl);
    toast.success('Profile picture removed');
  };

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

  // The form holds a department ID; the display name is what the UI shows.
  const departmentName = departments.find(d => d.id === form.department)?.name || '';

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{isEdit ? 'Edit Employee' : 'Add Employee'}</h1>
        <p className="text-sm text-muted-foreground">{isEdit ? 'Update employee information' : 'Add a new employee to the directory'}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 rounded-xl border border-border bg-card p-6 shadow-sm">
        {/* Avatar preview */}
        <div className="flex items-center gap-4">
          <AvatarInitials name={form.fullName || 'N A'} department={form.department} color={getColor(departmentName)} src={photoUrl} size="lg" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{form.fullName || 'New Employee'}</p>
            <p className="text-xs text-muted-foreground">{departmentName || 'No department'}</p>
          </div>
          <div className="ml-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPhotoOpen(true)}
              disabled={!isEdit}
            >
              <ImageIcon className="mr-2 h-4 w-4" />
              {photoUrl ? 'Change picture' : 'Picture'}
            </Button>
            {!isEdit && (
              <p className="mt-1 text-xs text-muted-foreground">
                Save the employee first, then add a picture.
              </p>
            )}
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

      {/* Profile picture */}
      <PhotoUploadDialog
        open={photoOpen}
        onOpenChange={setPhotoOpen}
        personName={form.fullName || 'New Employee'}
        currentPhotoUrl={photoUrl}
        onUpload={handleUploadPhoto}
        onRemove={handleRemovePhoto}
      />
    </div>
  );
}
