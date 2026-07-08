import { api } from '@/lib/api';
import type { SyncLog, SyncType } from '@/data/mockData';

interface BackendSyncLog {
  id: string;
  sync_type: string;
  status: string;
  records_affected: number;
  error_message?: string | null;
  started_at: string;
  completed_at?: string | null;
  created_at?: string;
}

interface SyncSetting {
  id: string;
  sync_type: string;
  is_enabled: boolean;
  last_run: string | null;
  next_scheduled: string | null;
}

function mapSyncLog(log: BackendSyncLog): SyncLog {
  return {
    id: log.id,
    timestamp: log.started_at,
    type: log.sync_type as SyncType,
    status: log.status === 'success' ? 'Success' : 'Failed',
    recordsAffected: log.records_affected,
  };
}

export const syncService = {
  async getSettings(): Promise<SyncSetting[]> {
    return await api.get<SyncSetting[]>('/admin/sync/settings');
  },

  async toggleSetting(syncType: string, enabled: boolean): Promise<void> {
    await api.patch(`/admin/sync/settings/${syncType}`, { is_enabled: enabled });
  },

  async runSync(syncType: 'outlook' | 'ucm'): Promise<void> {
    await api.post(`/admin/sync/run/${syncType}`);
  },

  async getLogs(): Promise<SyncLog[]> {
    const logs = await api.get<BackendSyncLog[]>('/admin/sync/logs');
    return logs.map(mapSyncLog);
  },
};
