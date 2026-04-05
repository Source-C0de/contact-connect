import { useState } from 'react';
import { mockSyncLogs, type SyncLog } from '@/data/mockData';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { RefreshCw, CheckCircle, XCircle } from 'lucide-react';
import { toast } from 'sonner';

export default function SyncSettings() {
  const [outlookEnabled, setOutlookEnabled] = useState(true);
  const [ucmEnabled, setUcmEnabled] = useState(true);
  const [outlookSyncing, setOutlookSyncing] = useState(false);
  const [ucmSyncing, setUcmSyncing] = useState(false);
  const [logs, setLogs] = useState<SyncLog[]>(mockSyncLogs);

  const handleSync = (type: 'outlook' | 'ucm') => {
    const setSyncing = type === 'outlook' ? setOutlookSyncing : setUcmSyncing;
    setSyncing(true);
    setTimeout(() => {
      setSyncing(false);
      const newLog: SyncLog = {
        id: String(Date.now()),
        timestamp: new Date().toLocaleString(),
        type,
        status: Math.random() > 0.2 ? 'Success' : 'Failed',
        recordsAffected: Math.floor(Math.random() * 50) + 10,
      };
      setLogs(prev => [newLog, ...prev]);
      toast.success(`${type === 'outlook' ? 'Outlook' : 'UCM'} sync completed`);
    }, 2000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Sync Settings</h1>
        <p className="text-sm text-muted-foreground">Configure data synchronization</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Outlook */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Microsoft 365 / Outlook</h2>
            <div className="flex items-center gap-2">
              <Switch checked={outlookEnabled} onCheckedChange={setOutlookEnabled} />
              <Label className="text-sm">{outlookEnabled ? 'On' : 'Off'}</Label>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">Last sync: Today at 08:00 AM</p>
          <Button onClick={() => handleSync('outlook')} disabled={!outlookEnabled || outlookSyncing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${outlookSyncing ? 'animate-spin' : ''}`} />
            {outlookSyncing ? 'Syncing...' : 'Sync Now'}
          </Button>
        </div>

        {/* UCM */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">UCM System</h2>
            <div className="flex items-center gap-2">
              <Switch checked={ucmEnabled} onCheckedChange={setUcmEnabled} />
              <Label className="text-sm">{ucmEnabled ? 'On' : 'Off'}</Label>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">Last sync: Today at 08:00 AM</p>
          <Button onClick={() => handleSync('ucm')} disabled={!ucmEnabled || ucmSyncing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${ucmSyncing ? 'animate-spin' : ''}`} />
            {ucmSyncing ? 'Syncing...' : 'Sync Now'}
          </Button>
        </div>
      </div>

      {/* Logs */}
      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="p-5 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Sync Logs</h2>
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
              {logs.map(log => (
                <tr key={log.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="p-3 text-muted-foreground">{log.timestamp}</td>
                  <td className="p-3 capitalize text-foreground">{log.type}</td>
                  <td className="p-3">
                    <span className="inline-flex items-center gap-1">
                      {log.status === 'Success' ? (
                        <CheckCircle className="h-4 w-4 text-success" />
                      ) : (
                        <XCircle className="h-4 w-4 text-destructive" />
                      )}
                      <span className={log.status === 'Success' ? 'text-success' : 'text-destructive'}>{log.status}</span>
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
