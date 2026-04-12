import { api } from '@/lib/api';
import type { ActivityLog, ActionType } from '@/data/mockData';

interface BackendAuditLog {
  id: string;
  user_id: string;
  user_email: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: Record<string, unknown> | null;
  ip_address: string;
  created_at: string;
}

function mapAuditLog(log: BackendAuditLog): ActivityLog {
  return {
    id: log.id,
    timestamp: log.created_at,
    actor: log.user_email.split('@')[0],
    action: log.action as ActionType,
    target: log.entity_type,
  };
}

export const auditService = {
  async getLogs(): Promise<ActivityLog[]> {
    const logs = await api.get<BackendAuditLog[]>('/admin/audit-logs');
    return logs.map(mapAuditLog);
  },

  async exportLogs(): Promise<string> {
    const url = `${import.meta.env.VITE_API_URL || 'http://localhost:8080/api/v1'}/admin/audit-logs/export`;
    const token = localStorage.getItem('contacthub_access_token');
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to export audit logs');
    }

    return await response.text();
  },
};
