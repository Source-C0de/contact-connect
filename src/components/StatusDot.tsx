import { cn } from '@/lib/utils';
import type { OnlineStatus } from '@/data/mockData';

interface StatusDotProps {
  status: OnlineStatus;
  className?: string;
}

const dotClasses: Record<OnlineStatus, string> = {
  online: 'bg-success animate-pulse-dot',
  away: 'bg-warning',
  offline: 'bg-muted-foreground/40',
};

export function StatusDot({ status, className }: StatusDotProps) {
  return (
    <span className={cn('inline-block h-2.5 w-2.5 rounded-full', dotClasses[status], className)} />
  );
}
