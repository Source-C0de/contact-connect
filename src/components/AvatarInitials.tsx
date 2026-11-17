import { useState } from 'react';
import { cn } from '@/lib/utils';

interface AvatarInitialsProps {
  name: string;
  department?: string;
  /** Department color (hex). Falls back to neutral grey when omitted. */
  color?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /**
   * Absolute URL of a profile picture. When present the picture is shown over
   * the initials; if it fails to load we keep the initials so the UI never
   * shows a broken image.
   */
  src?: string | null;
}

const sizeClasses = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-lg',
};

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

export function AvatarInitials({
  name, department, color, size = 'md', className, src,
}: AvatarInitialsProps) {
  const bgColor = color || '#6B7280';
  // Flips to true when the browser cannot decode the picture. It stays
  // flipped so we don't retry on every render.
  const [failed, setFailed] = useState(false);
  const showImage = !!src && !failed;

  return (
    <div
      className={cn('relative flex items-center justify-center overflow-hidden rounded-full font-semibold text-white shrink-0', sizeClasses[size], className)}
      style={{ backgroundColor: bgColor }}
      data-testid="avatar-initials"
    >
      {/* The initials stay in the DOM underneath the picture: they are the
          loading placeholder and the fallback if the picture is missing. */}
      {getInitials(name)}

      {showImage && (
        <img
          src={src!}
          alt={name}
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
