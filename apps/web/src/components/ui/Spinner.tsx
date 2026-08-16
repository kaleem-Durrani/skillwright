import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const spinnerVariants = cva('inline-block shrink-0 rounded-full border-current', {
  variants: {
    size: {
      sm: 'size-4 border-2',
      md: 'size-5 border-2',
      lg: 'size-8 border-[3px]',
    },
  },
  defaultVariants: { size: 'md' },
});

export interface SpinnerProps extends VariantProps<typeof spinnerVariants> {
  className?: string;
  /**
   * Announced to assistive tech. Pass `null` when the spinner sits inside a
   * control that already announces its own busy state (Button does).
   */
  label?: string | null;
}

/**
 * A spinner is a promise that something is happening. It uses a CSS keyframe
 * rather than Motion because it must keep turning inside a Suspense fallback,
 * where React may not have committed a Motion tree yet.
 */
export function Spinner({ size, className, label = null }: SpinnerProps) {
  return (
    <span
      className={cn(
        spinnerVariants({ size }),
        'border-r-transparent motion-safe:[animation:sw-spin_0.7s_linear_infinite]',
        className,
      )}
      role={label ? 'status' : undefined}
      aria-hidden={label ? undefined : true}
    >
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
