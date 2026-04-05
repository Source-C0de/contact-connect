import { cn } from '@/lib/utils';

interface DepartmentBadgeProps {
  department: string;
  color?: string;
  className?: string;
}

export function DepartmentBadge({ department, color, className }: DepartmentBadgeProps) {
  return (
    <span
      className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', className)}
      style={{
        backgroundColor: color ? `${color}18` : undefined,
        color: color || undefined,
        border: color ? `1px solid ${color}30` : undefined,
      }}
    >
      {department}
    </span>
  );
}
