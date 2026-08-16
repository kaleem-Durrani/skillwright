import type { HTMLAttributes, ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-neutral-soft text-neutral-fg',
        brand: 'bg-brand-soft text-brand-on-soft',
        success: 'bg-success-soft text-success-fg',
        warning: 'bg-warning-soft text-warning-fg',
        danger: 'bg-danger-soft text-danger-fg',
        info: 'bg-info-soft text-info-fg',
      },
      variant: {
        soft: '',
        solid: '',
        outline: 'bg-transparent border',
      },
      size: {
        sm: 'px-1.5 py-0.5 text-2xs',
        md: 'px-2 py-0.5 text-xs',
      },
    },
    compoundVariants: [
      { variant: 'solid', tone: 'neutral', class: 'bg-neutral text-fg-on-status' },
      { variant: 'solid', tone: 'brand', class: 'bg-brand text-fg-on-brand' },
      { variant: 'solid', tone: 'success', class: 'bg-success text-fg-on-status' },
      { variant: 'solid', tone: 'warning', class: 'bg-warning text-fg-on-status' },
      { variant: 'solid', tone: 'danger', class: 'bg-danger text-fg-on-brand' },
      { variant: 'solid', tone: 'info', class: 'bg-info text-fg-on-status' },
      { variant: 'outline', tone: 'neutral', class: 'border-neutral-line text-neutral-fg' },
      { variant: 'outline', tone: 'brand', class: 'border-line-brand text-fg-brand' },
      { variant: 'outline', tone: 'success', class: 'border-success-line text-success-fg' },
      { variant: 'outline', tone: 'warning', class: 'border-warning-line text-warning-fg' },
      { variant: 'outline', tone: 'danger', class: 'border-danger-line text-danger-fg' },
      { variant: 'outline', tone: 'info', class: 'border-info-line text-info-fg' },
    ],
    defaultVariants: { tone: 'neutral', variant: 'soft', size: 'md' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  icon?: ReactNode;
}

/** A label, never a control. If it can be clicked it is a Button. */
export function Badge({ className, tone, variant, size, icon, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, variant, size }), className)} {...props}>
      {icon}
      {children}
    </span>
  );
}

export { badgeVariants };
