import { useState } from 'react';
import { mockSystemUsers, type SystemUser, type UserRole } from '@/data/mockData';
import { AvatarInitials } from '@/components/AvatarInitials';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { UserPlus, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

export default function UserManagement() {
  const [users, setUsers] = useState<SystemUser[]>(mockSystemUsers);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('user');

  const handleRoleChange = (userId: string, role: UserRole) => {
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role } : u));
    toast.success('Role updated');
  };

  const handleToggleStatus = (userId: string) => {
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, status: u.status === 'active' ? 'inactive' : 'active' } : u));
    toast.success('User status updated');
  };

  const handleResetPassword = (userName: string) => {
    toast.success(`Password reset email sent to ${userName}`);
  };

  const handleInvite = () => {
    if (!inviteEmail.trim()) return;
    const newUser: SystemUser = {
      id: String(Date.now()),
      name: inviteEmail.split('@')[0],
      email: inviteEmail,
      role: inviteRole,
      lastLogin: 'Never',
      status: 'active',
    };
    setUsers(prev => [...prev, newUser]);
    setShowInvite(false);
    setInviteEmail('');
    toast.success('Invitation sent');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">User Management</h1>
          <p className="text-sm text-muted-foreground">Manage system access and roles</p>
        </div>
        <Button onClick={() => setShowInvite(true)}>
          <UserPlus className="mr-2 h-4 w-4" /> Invite User
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="p-3 text-left font-medium text-muted-foreground">User</th>
              <th className="p-3 text-left font-medium text-muted-foreground hidden sm:table-cell">Email</th>
              <th className="p-3 text-left font-medium text-muted-foreground">Role</th>
              <th className="p-3 text-left font-medium text-muted-foreground hidden md:table-cell">Last Login</th>
              <th className="p-3 text-left font-medium text-muted-foreground">Status</th>
              <th className="p-3 text-left font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => (
              <tr key={user.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                <td className="p-3">
                  <div className="flex items-center gap-3">
                    <AvatarInitials name={user.name} size="sm" />
                    <span className="font-medium text-foreground">{user.name}</span>
                  </div>
                </td>
                <td className="p-3 text-muted-foreground hidden sm:table-cell">{user.email}</td>
                <td className="p-3">
                  <Select value={user.role} onValueChange={v => handleRoleChange(user.id, v as UserRole)}>
                    <SelectTrigger className="w-28 h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="user">User</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td className="p-3 text-muted-foreground hidden md:table-cell">{user.lastLogin}</td>
                <td className="p-3">
                  <button
                    onClick={() => handleToggleStatus(user.id)}
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      user.status === 'active' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {user.status}
                  </button>
                </td>
                <td className="p-3">
                  <Button size="sm" variant="ghost" onClick={() => handleResetPassword(user.name)}>
                    <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent>
          <DialogHeader><DialogTitle>Invite User</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="user@corp.com" type="email" />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={inviteRole} onValueChange={v => setInviteRole(v as UserRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="user">User</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInvite(false)}>Cancel</Button>
            <Button onClick={handleInvite}>Send Invite</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
