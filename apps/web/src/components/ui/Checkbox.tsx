import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useFieldControlProps } from './FormField.js';

export interface CheckboxProps extends ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> {
  label?: ReactNode;
  hint?: ReactNode;
}

/**
 * The 20px box sits inside a 44px hit area supplied by the wrapping label, so
 * the target is thumb-sized without the control looking like a toggle switch.
 */
export const Checkbox = forwardRef<ElementRef<typeof CheckboxPrimitive.Root>, CheckboxProps>(
  function Checkbox({ className, label, hint, id, ...props }, ref) {
    const wired = useFieldControlProps(id === undefined ? {} : { id });

    const box = (
      <CheckboxPrimitive.Root
        ref={ref}
        className={cn(
          'peer flex size-5 shrink-0 items-center justify-center rounded-xs border border-[var(--control-border)] bg-[var(--control-bg)]',
          'transition-colors duration-[var(--duration-fast)]',
          'outline-none focus-visible:ring-2 focus-visible:ring-line-focus/40 focus-visible:border-line-focus',
          'data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-fg-on-brand',
          'data-[state=indeterminate]:border-brand data-[state=indeterminate]:bg-brand data-[state=indeterminate]:text-fg-on-brand',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
        {...wired}
      >
        <CheckboxPrimitive.Indicator className="flex items-center justify-center">
          {props.checked === 'indeterminate' ? (
            <Minus aria-hidden="true" className="size-3.5" strokeWidth={3} />
          ) : (
            <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />
          )}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
    );

    if (!label) return box;

    return (
      <label className="flex tap cursor-pointer items-start gap-3 py-2 select-none">
        {box}
        <span className="flex flex-col gap-0.5">
          <span className="text-sm text-fg peer-disabled:text-fg-disabled">{label}</span>
          {hint ? <span className="text-xs text-fg-tertiary">{hint}</span> : null}
        </span>
      </label>
    );
  },
);
