import { api } from '@/lib/api';
import { API_BASE_URL } from '@/lib/apiBase';
import type { ActivityLog, ActionType } from '@/data/mockData';

interface BackendAuditLog {
  id: string;
  user_id?: string;
  user_email: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details?: Record<string, unknown> | null;
  ip_address?: string;
  created_at: string;
}

function mapAuditLog(log: BackendAuditLog): ActivityLog {
  return {
    id: log.id,
    timestamp: log.created_at,
    actor: log.user_email.split('@')[0],
    action: log.action as ActionType,
    target:
      (typeof log.details?.name === 'string' && log.details.name) ||
      (typeof log.details?.email === 'string' && log.details.email) ||
      log.entity_type,
  };
}

export const auditService = {
  async getLogs(): Promise<ActivityLog[]> {
    const logs = await api.get<BackendAuditLog[]>('/admin/audit-logs');
    return logs.map(mapAuditLog);
  },

  async exportLogs(): Promise<string> {
    const url = `${API_BASE_URL}/admin/audit-logs/export`;
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
