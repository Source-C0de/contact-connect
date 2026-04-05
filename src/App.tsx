import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { RoleGuard } from "@/components/RoleGuard";
import { AppLayout } from "@/components/AppLayout";
import LoginPage from "@/pages/LoginPage";
import AdminDashboard from "@/pages/admin/AdminDashboard";
import AdminDirectory from "@/pages/admin/AdminDirectory";
import EmployeeForm from "@/pages/admin/EmployeeForm";
import DepartmentManagement from "@/pages/admin/DepartmentManagement";
import UserManagement from "@/pages/admin/UserManagement";
import SyncSettings from "@/pages/admin/SyncSettings";
import ActivityLogPage from "@/pages/admin/ActivityLogPage";
import UserDirectoryPage from "@/pages/user/UserDirectoryPage";
import UserProfile from "@/pages/user/UserProfile";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

function AdminRoute({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <RoleGuard role="admin">
        <AppLayout>{children}</AppLayout>
      </RoleGuard>
    </ProtectedRoute>
  );
}

function UserRoute({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <RoleGuard role="user">
        <AppLayout>{children}</AppLayout>
      </RoleGuard>
    </ProtectedRoute>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<LoginPage />} />

            {/* Admin routes */}
            <Route path="/admin/dashboard" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
            <Route path="/admin/directory" element={<AdminRoute><AdminDirectory /></AdminRoute>} />
            <Route path="/admin/employees/new" element={<AdminRoute><EmployeeForm /></AdminRoute>} />
            <Route path="/admin/employees/:id/edit" element={<AdminRoute><EmployeeForm /></AdminRoute>} />
            <Route path="/admin/departments" element={<AdminRoute><DepartmentManagement /></AdminRoute>} />
            <Route path="/admin/users" element={<AdminRoute><UserManagement /></AdminRoute>} />
            <Route path="/admin/sync" element={<AdminRoute><SyncSettings /></AdminRoute>} />
            <Route path="/admin/logs" element={<AdminRoute><ActivityLogPage /></AdminRoute>} />

            {/* User routes */}
            <Route path="/user/directory" element={<UserRoute><UserDirectoryPage /></UserRoute>} />
            <Route path="/user/profile" element={<UserRoute><UserProfile /></UserRoute>} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
