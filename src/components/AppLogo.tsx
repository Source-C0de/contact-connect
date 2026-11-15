import { cn } from '@/lib/utils';

interface AppLogoProps {
  /**
   * `plain` renders the bare image — use on light surfaces (the login card),
   * where the logo's own white background blends in.
   * `card` wraps it in a white rounded card — use on dark surfaces (the
   * sidebar), so the white background reads as intentional branding instead
   * of a pasted rectangle.
   */
  variant?: 'plain' | 'card';
  className?: string;
}

export function AppLogo({ variant = 'plain', className }: AppLogoProps) {
  const image = (
    <img
      src="/picture.webp"
      alt="Mohammed Alkhuraiji Industrial Co."
      className="h-full w-auto object-contain"
    />
  );

  if (variant === 'card') {
    return (
      <div
        className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-1', className)}
        data-testid="app-logo"
      >
        {image}
      </div>
    );
  }

  return (
    <div className={cn('flex shrink-0 items-center justify-center', className)} data-testid="app-logo">
      {image}
    </div>
  );
}
