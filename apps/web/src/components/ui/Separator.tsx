import * as SeparatorPrimitive from '@radix-ui/react-separator';
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/cn';

export interface SeparatorProps extends ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root> {
  /** Centred text inside the rule ("or"). Forces a decorative separator. */
  label?: string;
}

export function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  label,
  ...props
}: SeparatorProps) {
  if (label) {
    return (
      <div className={cn('flex items-center gap-3', className)} role="presentation">
        <span className="h-px flex-1 bg-line-subtle" />
        <span className="text-xs font-medium tracking-wide text-fg-tertiary uppercase">
          {label}
        </span>
        <span className="h-px flex-1 bg-line-subtle" />
      </div>
    );
  }

  return (
    <SeparatorPrimitive.Root
      orientation={orientation}
      decorative={decorative}
      className={cn(
        'shrink-0 bg-line-subtle',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  );
}
