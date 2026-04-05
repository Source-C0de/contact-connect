import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import type { UserRole } from '@/data/mockData';

interface RoleGuardProps {
  role: UserRole;
  children: React.ReactNode;
}

export function RoleGuard({ role, children }: RoleGuardProps) {
  const { user } = useAuth();

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) {
    const redirect = user.role === 'admin' ? '/admin/dashboard' : '/user/directory';
    return <Navigate to={redirect} replace />;
  }

  return <>{children}</>;
}
