import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { mockEmployees, DEPARTMENT_COLORS } from '@/data/mockData';
import { AvatarInitials } from '@/components/AvatarInitials';
import { DepartmentBadge } from '@/components/DepartmentBadge';
import { StatusDot } from '@/components/StatusDot';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Mail, Phone, MapPin, Building2 } from 'lucide-react';
import { toast } from 'sonner';

export default function UserProfile() {
  const { user } = useAuth();
  // Find matching employee by email
  const employee = mockEmployees.find(e => e.email === user?.email) || mockEmployees[0];
  const [mobile, setMobile] = useState(employee.mobile);
  const [editing, setEditing] = useState(false);

  const handleSave = () => {
    setEditing(false);
    toast.success('Mobile number updated');
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">My Profile</h1>
        <p className="text-sm text-muted-foreground">Your contact information</p>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="relative">
            <AvatarInitials name={employee.fullName} department={employee.department} size="lg" />
            <StatusDot status={employee.onlineStatus} className="absolute -bottom-0.5 -right-0.5 ring-2 ring-card h-3.5 w-3.5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">{employee.fullName}</h2>
            <p className="text-sm text-muted-foreground">{employee.jobTitle}</p>
            <DepartmentBadge department={employee.department} color={DEPARTMENT_COLORS[employee.department]} className="mt-1" />
          </div>
        </div>

        <hr className="border-border" />

        {/* Details */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Mail className="h-4 w-4" /> Email
            </div>
            <p className="text-sm font-medium text-foreground">{employee.email}</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Phone className="h-4 w-4" /> Extension
            </div>
            <p className="text-sm font-medium text-foreground">{employee.extension}</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4" /> Location
            </div>
            <p className="text-sm font-medium text-foreground">{employee.location}</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Building2 className="h-4 w-4" /> Department
            </div>
            <p className="text-sm font-medium text-foreground">{employee.department}</p>
          </div>
        </div>

        <hr className="border-border" />

        {/* Editable mobile */}
        <div className="space-y-3">
          <Label className="text-sm font-semibold text-foreground">Mobile Number</Label>
          {editing ? (
            <div className="flex gap-3">
              <Input value={mobile} onChange={e => setMobile(e.target.value)} className="max-w-xs" />
              <Button onClick={handleSave}>Save</Button>
              <Button variant="outline" onClick={() => { setEditing(false); setMobile(employee.mobile); }}>Cancel</Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <p className="text-sm text-foreground">{mobile || 'Not set'}</p>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
