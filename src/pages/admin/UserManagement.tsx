import { useState, useEffect } from 'react';
import { adminService } from '@/services/adminService';
import type { SystemUser, UserRole } from '@/data/mockData';
import { AvatarInitials } from '@/components/AvatarInitials';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  UserPlus, Eye, KeyRound, UserX, Monitor, Globe, Cpu, Wifi,
  RefreshCw, Clock, LogOut
} from 'lucide-react';
import { toast } from 'sonner';
import type { SessionSettings } from '@/services/adminService';

export default function UserManagement() {
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals state
  const [showInvite, setShowInvite] = useState(false);
  const [viewingUser, setViewingUser] = useState<SystemUser | null>(null);
  const [passwordUser, setPasswordUser] = useState<SystemUser | null>(null);
  const [showSessionSettings, setShowSessionSettings] = useState(false);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('user');
  const [invitePassword, setInvitePassword] = useState('');

  // Set password form
  const [newPassword, setNewPassword] = useState('');

  // Session settings
  const [sessionSettings, setSessionSettings] = useState<SessionSettings | null>(null);
  const [timeoutMins, setTimeoutMins] = useState(30);
  const [logoutOnClose, setLogoutOnClose] = useState(false);
  const [savingSession, setSavingSession] = useState(false);

  useEffect(() => {
    fetchUsers();
    fetchSessionSettings();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const data = await adminService.getUsers();
      setUsers(data);
    } catch (err) {
      // Surface the actual error so we can tell a network blip from a 401/403.
      const status = (err as { status?: number } | null)?.status;
      const msg = (err as Error | null)?.message || 'Failed to load users';
      toast.error(status ? `Failed to load users (HTTP ${status})` : msg);
    } finally {
      setLoading(false);
    }
  };

  const fetchSessionSettings = async () => {
    try {
      const s = await adminService.getSessionSettings();
      setSessionSettings(s);
      setTimeoutMins(s.inactivity_timeout_minutes);
      setLogoutOnClose(s.logout_on_browser_close);
    } catch {
      // Non-critical — leave the summary bar hidden.
    }
  };

  const handleRoleChange = async (userId: string, role: UserRole) => {
    try {
      await adminService.changeRole(userId, role);
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role } : u));
      toast.success('Role updated');
    } catch {
      toast.error('Failed to update role');
    }
  };

  const handleToggleStatus = async (user: SystemUser) => {
    try {
      await adminService.deactivateUser(user.id);
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, status: u.status === 'active' ? 'inactive' : 'active' } : u));
      toast.success('User status updated');
    } catch {
      toast.error('Failed to update status');
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !invitePassword.trim()) {
      toast.error('Email and password are required');
      return;
    }
    try {
      await adminService.inviteUser(inviteEmail, inviteRole, invitePassword);
      toast.success('User created successfully');
      setShowInvite(false);
      setInviteEmail('');
      setInvitePassword('');
      setInviteRole('user');
      fetchUsers();
    } catch (e: any) {
      toast.error(e.message || 'Failed to create user');
    }
  };

  const handleSetPassword = async () => {
    if (!newPassword.trim() || newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    try {
      await adminService.setPassword(passwordUser!.id, newPassword);
      toast.success(`Password updated for ${passwordUser!.name}`);
      setPasswordUser(null);
      setNewPassword('');
    } catch {
      toast.error('Failed to update password');
    }
  };

  const handleSaveSessionSettings = async () => {
    setSavingSession(true);
    try {
      const updated = await adminService.updateSessionSettings({
        inactivity_timeout_minutes: timeoutMins,
        logout_on_browser_close: logoutOnClose,
      });
      setSessionSettings(updated);
      toast.success('Session policy saved');
      setShowSessionSettings(false);
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSavingSession(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">User Management</h1>
          <p className="text-sm text-muted-foreground">Manage system access, roles, and session policy</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowSessionSettings(true)}>
            <Clock className="mr-2 h-4 w-4" />
            Session Policy
          </Button>
          <Button onClick={() => setShowInvite(true)}>
            <UserPlus className="mr-2 h-4 w-4" /> Create User
          </Button>
        </div>
      </div>

      {/* Session policy summary bar */}
      {sessionSettings && (
        <div className="flex items-center gap-6 rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            Inactivity timeout: <strong className="text-foreground ml-1">
              {sessionSettings.inactivity_timeout_minutes === 0 ? 'Disabled' : `${sessionSettings.inactivity_timeout_minutes} min`}
            </strong>
          </span>
          <span className="flex items-center gap-1.5">
            <LogOut className="h-3.5 w-3.5" />
            Logout on close: <strong className="text-foreground ml-1">
              {sessionSettings.logout_on_browser_close ? 'Enabled' : 'Disabled'}
            </strong>
          </span>
        </div>
      )}

      {/* Users table */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="p-3 text-left font-medium text-muted-foreground">User</th>
              <th className="p-3 text-left font-medium text-muted-foreground hidden sm:table-cell">Email</th>
              <th className="p-3 text-left font-medium text-muted-foreground">Role</th>
              <th className="p-3 text-left font-medium text-muted-foreground hidden lg:table-cell">Last Login</th>
              <th className="p-3 text-left font-medium text-muted-foreground hidden md:table-cell">Last OS</th>
              <th className="p-3 text-left font-medium text-muted-foreground">Status</th>
              <th className="p-3 text-left font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">Loading users...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No users found</td></tr>
            ) : users.map(user => (
              <tr key={user.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                <td className="p-3">
                  <div className="flex items-center gap-3">
                    <AvatarInitials name={user.name} size="sm" />
                    <span className="font-medium text-foreground">{user.name}</span>
                  </div>
                </td>
                <td className="p-3 text-muted-foreground hidden sm:table-cell">{user.email}</td>
                <td className="p-3">
                  <Select value={user.role} onValueChange={v => handleRoleChange(user.id, v as UserRole)}>
                    <SelectTrigger className="w-24 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="user">User</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td className="p-3 text-muted-foreground hidden lg:table-cell text-xs">{user.lastLogin}</td>
                <td className="p-3 hidden md:table-cell">
                  {user.lastOS ? (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Monitor className="h-3 w-3" />{user.lastOS}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground/40">—</span>
                  )}
                </td>
                <td className="p-3">
                  <button
                    onClick={() => handleToggleStatus(user)}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                      user.status === 'active'
                        ? 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    {user.status}
                  </button>
                </td>
                <td className="p-3">
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      title="View device info"
                      onClick={() => setViewingUser(user)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      title="Set password"
                      onClick={() => { setPasswordUser(user); setNewPassword(''); }}
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* === Device Info Modal === */}
      <Dialog open={!!viewingUser} onOpenChange={() => setViewingUser(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Monitor className="h-5 w-5 text-primary" />
              PC Configuration
            </DialogTitle>
            <DialogDescription>
              Last recorded device info for <strong>{viewingUser?.name}</strong>
            </DialogDescription>
          </DialogHeader>

          {viewingUser && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <InfoCard
                  icon={<Monitor className="h-4 w-4 text-blue-500" />}
                  label="Operating System"
                  value={viewingUser.lastOS}
                />
                <InfoCard
                  icon={<Globe className="h-4 w-4 text-violet-500" />}
                  label="Browser"
                  value={viewingUser.lastBrowser}
                />
                <InfoCard
                  icon={<Cpu className="h-4 w-4 text-amber-500" />}
                  label="Architecture"
                  value={viewingUser.architecture}
                />
                <InfoCard
                  icon={<Wifi className="h-4 w-4 text-emerald-500" />}
                  label="IP Address"
                  value={viewingUser.lastIP}
                />
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                <strong className="block mb-1 text-foreground">Last login</strong>
                {viewingUser.lastLogin}
              </div>

              <div className="flex gap-2">
                <Badge variant={viewingUser.status === 'active' ? 'default' : 'secondary'}>
                  {viewingUser.status}
                </Badge>
                <Badge variant="outline">{viewingUser.role}</Badge>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setViewingUser(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* === Set Password Modal === */}
      <Dialog open={!!passwordUser} onOpenChange={() => setPasswordUser(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" />
              Set Password
            </DialogTitle>
            <DialogDescription>
              Setting password for <strong>{passwordUser?.name}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>New Password</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Minimum 6 characters"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordUser(null)}>Cancel</Button>
            <Button onClick={handleSetPassword}>Set Password</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* === Create User Modal === */}
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              Create User Account
            </DialogTitle>
            <DialogDescription>
              The user can immediately login with these credentials.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="user@corp.com"
                type="email"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Initial Password</Label>
              <Input
                value={invitePassword}
                onChange={e => setInvitePassword(e.target.value)}
                placeholder="Minimum 6 characters"
                type="password"
              />
            </div>
            <div className="space-y-1.5">
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
            <Button onClick={handleInvite}>Create Account</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* === Session Settings Modal === */}
      <Dialog open={showSessionSettings} onOpenChange={setShowSessionSettings}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              Session Policy
            </DialogTitle>
            <DialogDescription>
              Configure how user sessions are managed across the organization.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-2">
            {/* Inactivity Timeout */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Inactivity Timeout</Label>
              <p className="text-xs text-muted-foreground">
                Automatically log users out after a period of inactivity. Set to 0 to disable.
              </p>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min={0}
                  max={480}
                  value={timeoutMins}
                  onChange={e => setTimeoutMins(parseInt(e.target.value) || 0)}
                  className="w-28"
                />
                <span className="text-sm text-muted-foreground">minutes</span>
                {timeoutMins === 0 && (
                  <Badge variant="secondary" className="text-xs">Disabled</Badge>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                {[15, 30, 60, 120].map(t => (
                  <button
                    key={t}
                    onClick={() => setTimeoutMins(t)}
                    className={`rounded-full px-3 py-1 text-xs border transition-colors ${
                      timeoutMins === t
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {t} min
                  </button>
                ))}
              </div>
            </div>

            {/* Logout on browser close */}
            <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/30 p-4">
              <div className="space-y-1">
                <p className="text-sm font-medium flex items-center gap-2">
                  <LogOut className="h-4 w-4 text-muted-foreground" />
                  Logout on Browser Close
                </p>
                <p className="text-xs text-muted-foreground">
                  When enabled, users are logged out when they close the browser tab or window.
                </p>
              </div>
              <Switch
                checked={logoutOnClose}
                onCheckedChange={setLogoutOnClose}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSessionSettings(false)}>Cancel</Button>
            <Button onClick={handleSaveSessionSettings} disabled={savingSession}>
              {savingSession ? (
                <><RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" /> Saving...</>
              ) : 'Save Policy'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Small reusable info card for device modal
function InfoCard({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string | null }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="text-sm font-medium text-foreground">
        {value || <span className="text-muted-foreground/50 font-normal italic">Not yet recorded</span>}
      </p>
    </div>
  );
}
