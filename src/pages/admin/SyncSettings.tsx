import { useCallback, useEffect, useState } from 'react';
import { syncService, type SyncSetting } from '@/services/syncService';
import type { SyncLog, SyncType } from '@/data/mockData';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { RefreshCw, CheckCircle, XCircle } from 'lucide-react';
import { toast } from 'sonner';

const SOURCES: { type: SyncType; label: string; description: string }[] = [
  {
    type: 'outlook',
    label: 'Microsoft 365 / Outlook',
    description: 'Reconciles employee records against the Exchange directory.',
  },
  {
    type: 'ucm',
    label: 'UCM System',
    description: 'Reconciles employee records against the on-premise HR system.',
  },
];

export default function SyncSettings() {
  const [settings, setSettings] = useState<Record<SyncType, SyncSetting | null>>({
    outlook: null,
    ucm: null,
  });
  const [syncing, setSyncing] = useState<Record<SyncType, boolean>>({
    outlook: false,
    ucm: false,
  });
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settingList, logList] = await Promise.all([
        syncService.getSettings(),
        syncService.getLogs(),
      ]);
      const next = { outlook: null, ucm: null } as Record<SyncType, SyncSetting | null>;
      for (const s of settingList) {
        if (s.sync_type === 'outlook' || s.sync_type === 'ucm') {
          next[s.sync_type] = s;
        }
      }
      setSettings(next);
      setLogs(logList);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load sync settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggle = async (type: SyncType, enabled: boolean) => {
    // Optimistic update so the switch feels instant.
    setSettings(prev => ({
      ...prev,
      [type]: prev[type] ? { ...prev[type]!, is_enabled: enabled } : prev[type],
    }));
    try {
      await syncService.toggleSetting(type, enabled);
      toast.success(`${type === 'outlook' ? 'Outlook' : 'UCM'} sync ${enabled ? 'enabled' : 'disabled'}`);
    } catch (err) {
      // Roll back on failure so the UI reflects the server's state.
      setSettings(prev => ({
        ...prev,
        [type]: prev[type] ? { ...prev[type]!, is_enabled: !enabled } : prev[type],
      }));
      toast.error('Could not update sync setting');
    }
  };

  const handleSync = async (type: SyncType) => {
    setSyncing(prev => ({ ...prev, [type]: true }));
    try {
      const result = await syncService.runSync(type);
      toast.success(
        `${type === 'outlook' ? 'Outlook' : 'UCM'} sync completed — ${result.records_affected} record(s)`,
      );
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed');
      await load();
    } finally {
      setSyncing(prev => ({ ...prev, [type]: false }));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Sync Settings</h1>
        <p className="text-sm text-muted-foreground">Configure data synchronization</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {SOURCES.map(source => {
          const setting = settings[source.type];
          const enabled = !!setting?.is_enabled;
          const lastRun = setting?.last_run;
          return (
            <div key={source.type} className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">{source.label}</h2>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={enabled}
                    onCheckedChange={(v) => void handleToggle(source.type, v)}
                    aria-label={`Toggle ${source.label} sync`}
                  />
                  <Label className="text-sm">{enabled ? 'On' : 'Off'}</Label>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{source.description}</p>
              <p className="text-sm text-muted-foreground">
                Last sync: {lastRun ? new Date(lastRun).toLocaleString() : 'Never'}
              </p>
              <Button
                onClick={() => void handleSync(source.type)}
                disabled={!enabled || syncing[source.type]}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${syncing[source.type] ? 'animate-spin' : ''}`} />
                {syncing[source.type] ? 'Syncing...' : 'Sync Now'}
              </Button>
            </div>
          );
        })}
      </div>

      {/* Logs */}
      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="p-5 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Sync Logs</h2>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="p-3 text-left font-medium text-muted-foreground">Timestamp</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Type</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Records</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-muted-foreground">
                    Loading sync logs…
                  </td>
                </tr>
              )}
              {!loading && logs.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-muted-foreground">
                    No sync runs recorded yet.
                  </td>
                </tr>
              )}
              {logs.map(log => (
                <tr key={log.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="p-3 text-muted-foreground whitespace-nowrap">
                    {new Date(log.timestamp).toLocaleString()}
                  </td>
                  <td className="p-3 capitalize text-foreground">{log.type}</td>
                  <td className="p-3">
                    <span className="inline-flex items-center gap-1">
                      {log.status === 'Success' ? (
                        <CheckCircle className="h-4 w-4 text-success" />
                      ) : (
                        <XCircle className="h-4 w-4 text-destructive" />
                      )}
                      <span className={log.status === 'Success' ? 'text-success' : 'text-destructive'}>
                        {log.status}
                      </span>
                    </span>
                  </td>
                  <td className="p-3 text-muted-foreground">{log.recordsAffected}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
