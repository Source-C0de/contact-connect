import { cn } from '@/lib/utils';

interface AvatarInitialsProps {
  name: string;
  department?: string;
  /** Department color (hex). Falls back to neutral grey when omitted. */
  color?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-lg',
};

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

export function AvatarInitials({ name, department, color, size = 'md', className }: AvatarInitialsProps) {
  const bgColor = color || '#6B7280';

  return (
    <div
      className={cn('flex items-center justify-center rounded-full font-semibold text-white shrink-0', sizeClasses[size], className)}
      style={{ backgroundColor: bgColor }}
      data-testid="avatar-initials"
    >
      {getInitials(name)}
    </div>
  );
}
