import { useEffect, useMemo, useState } from 'react';
import type { ActionType } from '@/data/mockData';
import { auditService } from '@/services/auditService';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Download, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface ActivityLog {
  id: string;
  timestamp: string;
  actor: string;
  action: ActionType;
  target: string;
}

export default function ActivityLogPage() {
  const [actionFilter, setActionFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await auditService.getLogs();
      setLogs(data);
    } catch (err) {
      // Surface the outage instead of silently showing an empty table.
      setError(err instanceof Error ? err.message : 'Failed to load activity logs');
      toast.error('Could not load activity logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLogs();
  }, []);

  const filtered = useMemo(() => {
    let result = [...logs];
    if (actionFilter !== 'all') result = result.filter(l => l.action === actionFilter);
    if (dateFrom) result = result.filter(l => l.timestamp >= dateFrom);
    if (dateTo) result = result.filter(l => l.timestamp <= dateTo + ' 23:59');
    return result;
  }, [logs, actionFilter, dateFrom, dateTo]);

  const exportCsv = async () => {
    try {
      const csv = await auditService.exportLogs();
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'activity_log.csv';
      a.click();
      URL.revokeObjectURL(url);
      toast.success('CSV exported');
    } catch {
      toast.error('CSV export failed');
    }
  };

  const actionColors: Record<ActionType, string> = {
    Created: 'bg-primary/10 text-primary',
    Updated: 'bg-info/10 text-info',
    Deleted: 'bg-destructive/10 text-destructive',
    Deactivated: 'bg-warning/10 text-warning',
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Activity Log</h1>
          <p className="text-sm text-muted-foreground">Audit trail of all actions</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void loadLogs()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button variant="outline" onClick={() => void exportCsv()}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Action type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Actions</SelectItem>
            <SelectItem value="Created">Created</SelectItem>
            <SelectItem value="Updated">Updated</SelectItem>
            <SelectItem value="Deleted">Deleted</SelectItem>
            <SelectItem value="Deactivated">Deactivated</SelectItem>
          </SelectContent>
        </Select>
        <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        <span className="text-sm text-muted-foreground">to</span>
        <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-40" />
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="p-3 text-left font-medium text-muted-foreground">Timestamp</th>
              <th className="p-3 text-left font-medium text-muted-foreground">Actor</th>
              <th className="p-3 text-left font-medium text-muted-foreground">Action</th>
              <th className="p-3 text-left font-medium text-muted-foreground">Target</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4} className="p-6 text-center text-muted-foreground">
                  Loading activity logs…
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="p-6 text-center text-muted-foreground">
                  No activity recorded yet.
                </td>
              </tr>
            )}
            {filtered.map(log => (
              <tr key={log.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                <td className="p-3 text-muted-foreground whitespace-nowrap">
                  {new Date(log.timestamp).toLocaleString()}
                </td>
                <td className="p-3 font-medium text-foreground">{log.actor}</td>
                <td className="p-3">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${actionColors[log.action] ?? 'bg-muted text-muted-foreground'}`}>
                    {log.action}
                  </span>
                </td>
                <td className="p-3 text-foreground">{log.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
