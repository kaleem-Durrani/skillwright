import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const cardVariants = cva(
  'rounded-[var(--card-radius)] bg-[var(--card-bg)] text-fg transition-shadow duration-[var(--duration-fast)]',
  {
    variants: {
      variant: {
        outlined: 'border border-[var(--card-border)]',
        raised: 'border border-[var(--card-border)] shadow-e2',
        sunken: 'bg-sunken border border-transparent',
        ghost: 'bg-transparent border border-transparent',
      },
      interactive: {
        // A whole-card link. `focus-within` because the real focus lands on the
        // anchor inside, not on the card itself.
        true: 'cursor-pointer hover:border-line hover:shadow-e2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-line-focus active:bg-hover',
        false: '',
      },
      padded: {
        true: 'p-[var(--card-padding)]',
        false: '',
      },
    },
    defaultVariants: { variant: 'outlined', interactive: false, padded: true },
  },
);

export interface CardProps
  extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, variant, interactive, padded, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(cardVariants({ variant, interactive, padded }), className)}
      {...props}
    />
  );
});

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 pb-3 md:flex-row md:items-start md:justify-between md:gap-4',
        className,
      )}
      {...props}
    />
  );
}

// `children` is destructured and placed explicitly rather than riding along in the
// spread: jsx-a11y/heading-has-content cannot see content arriving through
// `{...props}` and reports every heading built this way. Naming it satisfies the
// rule honestly, instead of silencing a check that is worth keeping at error.
export function CardTitle({ className, children, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('font-display text-lg leading-tight font-semibold text-fg', className)}
      {...props}
    >
      {children}
    </h3>
  );
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-fg-secondary', className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('text-sm text-fg-secondary', className)} {...props} />;
}

/**
 * Actions stack full-width on mobile and sit inline from `sm` up. Stacking is
 * the base because two 44px buttons side by side do not fit at 375px once the
 * card padding is subtracted.
 */
export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 pt-4 sm:flex-row sm:items-center sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}

export { cardVariants };
