import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';
import { initials } from '@/lib/format';

const avatarVariants = cva(
  'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-sunken select-none',
  {
    variants: {
      size: {
        xs: 'size-6 text-2xs',
        sm: 'size-8 text-xs',
        md: 'size-10 text-sm',
        lg: 'size-12 text-base',
        xl: 'size-16 text-lg',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export interface AvatarProps extends VariantProps<typeof avatarVariants> {
  name: string;
  src?: string | null;
  className?: string;
  /** Small status dot, bottom-end. */
  presence?: 'online' | 'offline' | null;
}

/**
 * The image is decorative: the person's name is always adjacent in every place
 * this is used, so an alt text would just repeat it. When the image fails, the
 * monogram fallback carries no accessible name either — for the same reason.
 */
export function Avatar({ name, src, size, className, presence = null }: AvatarProps) {
  return (
    <span className={cn('relative inline-flex', className)}>
      <AvatarPrimitive.Root className={cn(avatarVariants({ size }))}>
        {src ? <AvatarPrimitive.Image src={src} alt="" className="size-full object-cover" /> : null}
        <AvatarPrimitive.Fallback
          // Delay avoids a monogram flashing before a cached image paints.
          delayMs={src ? 120 : 0}
          className="flex size-full items-center justify-center bg-brand-soft font-medium text-brand-on-soft"
          aria-hidden="true"
        >
          {initials(name)}
        </AvatarPrimitive.Fallback>
      </AvatarPrimitive.Root>

      {presence ? (
        <span
          className={cn(
            'absolute -end-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-[var(--card-bg)]',
            presence === 'online' ? 'bg-success' : 'bg-neutral',
          )}
        >
          <span className="sr-only">{presence === 'online' ? 'Online' : 'Offline'}</span>
        </span>
      ) : null}
    </span>
  );
}

export { avatarVariants };
