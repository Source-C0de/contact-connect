import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { employeeService } from '@/services/employeeService';
import type { Employee } from '@/data/mockData';
import { useDepartmentColors } from '@/hooks/useDepartmentColors';
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
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [mobile, setMobile] = useState('');
  const [editing, setEditing] = useState(false);
  const { getColor } = useDepartmentColors();

  /**
   * Resolve the signed-in user's employee record from the live directory.
   *
   * The account email identifies their directory entry. If the account has
   * no linked record (e.g. an admin account without a personal entry) we
   * show the account details instead of inventing one.
   */
  const loadEmployee = useCallback(async () => {
    if (!user?.email) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const employees = await employeeService.getAll({ search: user.email });
      // Prefer an exact email match — a search may return partial hits.
      const match =
        employees.find(e => e.email.toLowerCase() === user.email.toLowerCase()) ??
        employees[0] ??
        null;
      setEmployee(match);
      setNotFound(!match);
      if (match) setMobile(match.mobile || '');
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [user?.email]);

  useEffect(() => {
    void loadEmployee();
  }, [loadEmployee]);

  const handleSave = async () => {
    if (!employee) return;
    try {
      await employeeService.update(employee.id, { mobile });
      setEmployee({ ...employee, mobile });
      setEditing(false);
      toast.success('Mobile number updated');
    } catch {
      toast.error('Could not save your mobile number');
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">My Profile</h1>
          <p className="text-sm text-muted-foreground">Your contact information</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Loading your profile…
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">My Profile</h1>
        <p className="text-sm text-muted-foreground">Your contact information</p>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-6">
        {notFound || !employee ? (
          <>
            {/* No linked directory record — fall back to the account itself. */}
            <div className="flex items-center gap-4">
              <AvatarInitials name={user?.name || user?.email || 'User'} color="#6B7280" size="lg" />
              <div>
                <h2 className="text-xl font-bold text-foreground">{user?.name || user?.email}</h2>
                <p className="text-sm text-muted-foreground">
                  No directory record is linked to this account yet.
                </p>
              </div>
            </div>
            <hr className="border-border" />
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4" /> Email
              </div>
              <p className="text-sm font-medium text-foreground">{user?.email}</p>
            </div>
          </>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center gap-4">
              <div className="relative">
                <AvatarInitials
                  name={employee.fullName}
                  department={employee.department}
                  color={getColor(employee.department)}
                  size="lg"
                />
                <StatusDot
                  status={employee.onlineStatus}
                  className="absolute -bottom-0.5 -right-0.5 ring-2 ring-card h-3.5 w-3.5"
                />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground">{employee.fullName}</h2>
                <p className="text-sm text-muted-foreground">{employee.jobTitle}</p>
                <DepartmentBadge
                  department={employee.department}
                  color={getColor(employee.department)}
                  className="mt-1"
                />
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
                  <Input
                    value={mobile}
                    onChange={e => setMobile(e.target.value)}
                    className="max-w-xs"
                  />
                  <Button onClick={() => void handleSave()}>Save</Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditing(false);
                      setMobile(employee.mobile);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <p className="text-sm text-foreground">{mobile || 'Not set'}</p>
                  <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
