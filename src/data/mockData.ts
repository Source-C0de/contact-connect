export type OnlineStatus = 'online' | 'away' | 'offline';
export type EmployeeStatus = 'active' | 'inactive';
export type UserRole = 'admin' | 'user';
export type SyncType = 'outlook' | 'ucm';
export type ActionType = 'Created' | 'Updated' | 'Deleted' | 'Deactivated';

export interface Employee {
  id: string;
  fullName: string;
  jobTitle: string;
  department: string;
  email: string;
  extension: string;
  mobile: string;
  location: string;
  status: EmployeeStatus;
  onlineStatus: OnlineStatus;
  dateAdded: string;
  photoUrl?: string;
}

export interface Department {
  id: string;
  name: string;
  color: string;
  employeeCount: number;
}

export interface SystemUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  lastLogin: string;
  status: 'active' | 'inactive';
  // Device fingerprint (populated from login)
  lastIP?: string | null;
  lastOS?: string | null;
  lastBrowser?: string | null;
  architecture?: string | null;
}

export interface SyncLog {
  id: string;
  timestamp: string;
  type: SyncType;
  status: 'Success' | 'Failed';
  recordsAffected: number;
}

export interface ActivityLog {
  id: string;
  timestamp: string;
  actor: string;
  action: ActionType;
  target: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatar?: string;
}

export const mockEmployees: Employee[] = [
  { id: '1', fullName: 'Sarah Johnson', jobTitle: 'Senior Software Engineer', department: 'Engineering', email: 'sarah.johnson@corp.com', extension: '1001', mobile: '+1 (555) 234-5678', location: 'New York - Floor 3', status: 'active', onlineStatus: 'online', dateAdded: '2024-01-15' },
  { id: '2', fullName: 'Michael Chen', jobTitle: 'Product Manager', department: 'Engineering', email: 'michael.chen@corp.com', extension: '1002', mobile: '+1 (555) 345-6789', location: 'New York - Floor 3', status: 'active', onlineStatus: 'online', dateAdded: '2024-01-20' },
  { id: '3', fullName: 'Emily Rodriguez', jobTitle: 'UX Designer', department: 'Engineering', email: 'emily.rodriguez@corp.com', extension: '1003', mobile: '+1 (555) 456-7890', location: 'San Francisco - Floor 2', status: 'active', onlineStatus: 'away', dateAdded: '2024-02-01' },
  { id: '4', fullName: 'James Wilson', jobTitle: 'Sales Director', department: 'Sales', email: 'james.wilson@corp.com', extension: '2001', mobile: '+1 (555) 567-8901', location: 'Chicago - Floor 1', status: 'active', onlineStatus: 'online', dateAdded: '2024-01-10' },
  { id: '5', fullName: 'Amanda Foster', jobTitle: 'Account Executive', department: 'Sales', email: 'amanda.foster@corp.com', extension: '2002', mobile: '+1 (555) 678-9012', location: 'Chicago - Floor 1', status: 'active', onlineStatus: 'offline', dateAdded: '2024-02-15' },
  { id: '6', fullName: 'David Kim', jobTitle: 'Sales Representative', department: 'Sales', email: 'david.kim@corp.com', extension: '2003', mobile: '+1 (555) 789-0123', location: 'Chicago - Floor 1', status: 'inactive', onlineStatus: 'offline', dateAdded: '2024-03-01' },
  { id: '7', fullName: 'Rachel Thompson', jobTitle: 'HR Manager', department: 'HR', email: 'rachel.thompson@corp.com', extension: '3001', mobile: '+1 (555) 890-1234', location: 'New York - Floor 2', status: 'active', onlineStatus: 'online', dateAdded: '2024-01-05' },
  { id: '8', fullName: 'Daniel Martinez', jobTitle: 'HR Specialist', department: 'HR', email: 'daniel.martinez@corp.com', extension: '3002', mobile: '+1 (555) 901-2345', location: 'New York - Floor 2', status: 'active', onlineStatus: 'away', dateAdded: '2024-02-20' },
  { id: '9', fullName: 'Lisa Park', jobTitle: 'Recruiter', department: 'HR', email: 'lisa.park@corp.com', extension: '3003', mobile: '+1 (555) 012-3456', location: 'San Francisco - Floor 1', status: 'active', onlineStatus: 'online', dateAdded: '2024-03-10' },
  { id: '10', fullName: 'Robert Taylor', jobTitle: 'CFO', department: 'Finance', email: 'robert.taylor@corp.com', extension: '4001', mobile: '+1 (555) 123-4567', location: 'New York - Floor 5', status: 'active', onlineStatus: 'online', dateAdded: '2024-01-02' },
  { id: '11', fullName: 'Jennifer Lee', jobTitle: 'Financial Analyst', department: 'Finance', email: 'jennifer.lee@corp.com', extension: '4002', mobile: '+1 (555) 234-5679', location: 'New York - Floor 5', status: 'active', onlineStatus: 'offline', dateAdded: '2024-02-05' },
  { id: '12', fullName: 'Christopher Brown', jobTitle: 'Accountant', department: 'Finance', email: 'chris.brown@corp.com', extension: '4003', mobile: '+1 (555) 345-6780', location: 'New York - Floor 5', status: 'active', onlineStatus: 'away', dateAdded: '2024-03-15' },
  { id: '13', fullName: 'Jessica Adams', jobTitle: 'IT Director', department: 'IT', email: 'jessica.adams@corp.com', extension: '5001', mobile: '+1 (555) 456-7891', location: 'San Francisco - Floor 3', status: 'active', onlineStatus: 'online', dateAdded: '2024-01-08' },
  { id: '14', fullName: 'Andrew Clark', jobTitle: 'System Administrator', department: 'IT', email: 'andrew.clark@corp.com', extension: '5002', mobile: '+1 (555) 567-8902', location: 'San Francisco - Floor 3', status: 'active', onlineStatus: 'online', dateAdded: '2024-02-12' },
  { id: '15', fullName: 'Michelle Wang', jobTitle: 'Network Engineer', department: 'IT', email: 'michelle.wang@corp.com', extension: '5003', mobile: '+1 (555) 678-9013', location: 'San Francisco - Floor 3', status: 'inactive', onlineStatus: 'offline', dateAdded: '2024-03-20' },
  { id: '16', fullName: 'Kevin O\'Brien', jobTitle: 'Operations Manager', department: 'Operations', email: 'kevin.obrien@corp.com', extension: '6001', mobile: '+1 (555) 789-0124', location: 'Chicago - Floor 2', status: 'active', onlineStatus: 'online', dateAdded: '2024-01-12' },
  { id: '17', fullName: 'Stephanie Garcia', jobTitle: 'Supply Chain Analyst', department: 'Operations', email: 'stephanie.garcia@corp.com', extension: '6002', mobile: '+1 (555) 890-1235', location: 'Chicago - Floor 2', status: 'active', onlineStatus: 'away', dateAdded: '2024-02-25' },
  { id: '18', fullName: 'Thomas Wright', jobTitle: 'Logistics Coordinator', department: 'Operations', email: 'thomas.wright@corp.com', extension: '6003', mobile: '+1 (555) 901-2346', location: 'Chicago - Floor 2', status: 'active', onlineStatus: 'offline', dateAdded: '2024-03-05' },
  { id: '19', fullName: 'Nicole Harris', jobTitle: 'DevOps Engineer', department: 'Engineering', email: 'nicole.harris@corp.com', extension: '1004', mobile: '+1 (555) 012-3457', location: 'San Francisco - Floor 2', status: 'active', onlineStatus: 'online', dateAdded: '2024-03-25' },
  { id: '20', fullName: 'Brian Anderson', jobTitle: 'QA Engineer', department: 'Engineering', email: 'brian.anderson@corp.com', extension: '1005', mobile: '+1 (555) 123-4568', location: 'New York - Floor 3', status: 'active', onlineStatus: 'away', dateAdded: '2024-04-01' },
  { id: '21', fullName: 'Laura Mitchell', jobTitle: 'Business Analyst', department: 'Operations', email: 'laura.mitchell@corp.com', extension: '6004', mobile: '+1 (555) 234-5680', location: 'Chicago - Floor 2', status: 'active', onlineStatus: 'online', dateAdded: '2024-04-05' },
  { id: '22', fullName: 'Ryan Cooper', jobTitle: 'Frontend Developer', department: 'Engineering', email: 'ryan.cooper@corp.com', extension: '1006', mobile: '+1 (555) 345-6781', location: 'New York - Floor 3', status: 'active', onlineStatus: 'online', dateAdded: '2024-04-10' },
];

export const mockDepartments: Department[] = [
  { id: '1', name: 'Engineering', color: '#3B82F6', employeeCount: 6 },
  { id: '2', name: 'Sales', color: '#F59E0B', employeeCount: 3 },
  { id: '3', name: 'HR', color: '#EC4899', employeeCount: 3 },
  { id: '4', name: 'Finance', color: '#10B981', employeeCount: 3 },
  { id: '5', name: 'IT', color: '#8B5CF6', employeeCount: 3 },
  { id: '6', name: 'Operations', color: '#F97316', employeeCount: 4 },
];

export const mockSystemUsers: SystemUser[] = [
  { id: '1', name: 'Admin User', email: 'admin@corp.com', role: 'admin', lastLogin: '2024-04-05 09:15', status: 'active' },
  { id: '2', name: 'Sarah Johnson', email: 'user@corp.com', role: 'user', lastLogin: '2024-04-04 14:30', status: 'active' },
  { id: '3', name: 'Michael Chen', email: 'michael.chen@corp.com', role: 'user', lastLogin: '2024-04-03 11:00', status: 'active' },
  { id: '4', name: 'Rachel Thompson', email: 'rachel.thompson@corp.com', role: 'admin', lastLogin: '2024-04-02 16:45', status: 'active' },
  { id: '5', name: 'David Kim', email: 'david.kim@corp.com', role: 'user', lastLogin: '2024-03-28 08:20', status: 'inactive' },
];

export const mockSyncLogs: SyncLog[] = [
  { id: '1', timestamp: '2024-04-05 08:00', type: 'outlook', status: 'Success', recordsAffected: 45 },
  { id: '2', timestamp: '2024-04-05 08:00', type: 'ucm', status: 'Success', recordsAffected: 22 },
  { id: '3', timestamp: '2024-04-04 08:00', type: 'outlook', status: 'Success', recordsAffected: 43 },
  { id: '4', timestamp: '2024-04-04 08:00', type: 'ucm', status: 'Failed', recordsAffected: 0 },
  { id: '5', timestamp: '2024-04-03 08:00', type: 'outlook', status: 'Success', recordsAffected: 41 },
  { id: '6', timestamp: '2024-04-03 08:00', type: 'ucm', status: 'Success', recordsAffected: 22 },
  { id: '7', timestamp: '2024-04-02 08:00', type: 'outlook', status: 'Success', recordsAffected: 40 },
  { id: '8', timestamp: '2024-04-02 08:00', type: 'ucm', status: 'Success', recordsAffected: 21 },
];

export const mockActivityLogs: ActivityLog[] = [
  { id: '1', timestamp: '2024-04-05 09:30', actor: 'Admin User', action: 'Created', target: 'Ryan Cooper' },
  { id: '2', timestamp: '2024-04-05 09:15', actor: 'Admin User', action: 'Updated', target: 'Nicole Harris' },
  { id: '3', timestamp: '2024-04-04 16:00', actor: 'Rachel Thompson', action: 'Created', target: 'Laura Mitchell' },
  { id: '4', timestamp: '2024-04-04 14:30', actor: 'Admin User', action: 'Deactivated', target: 'David Kim' },
  { id: '5', timestamp: '2024-04-03 11:00', actor: 'Admin User', action: 'Updated', target: 'Brian Anderson' },
  { id: '6', timestamp: '2024-04-03 10:00', actor: 'Rachel Thompson', action: 'Created', target: 'Brian Anderson' },
  { id: '7', timestamp: '2024-04-02 09:00', actor: 'Admin User', action: 'Deactivated', target: 'Michelle Wang' },
  { id: '8', timestamp: '2024-04-01 15:00', actor: 'Admin User', action: 'Updated', target: 'James Wilson' },
  { id: '9', timestamp: '2024-04-01 10:00', actor: 'Rachel Thompson', action: 'Created', target: 'Stephanie Garcia' },
  { id: '10', timestamp: '2024-03-30 14:00', actor: 'Admin User', action: 'Deleted', target: 'Former Employee' },
];

export const mockAuthUsers: Record<string, AuthUser & { password: string }> = {
  'admin@corp.com': {
    id: 'auth-1',
    email: 'admin@corp.com',
    password: 'admin123',
    name: 'Admin User',
    role: 'admin',
  },
  'user@corp.com': {
    id: 'auth-2',
    email: 'user@corp.com',
    password: 'user123',
    name: 'Sarah Johnson',
    role: 'user',
  },
};
