import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useFieldControlProps } from './FormField.js';

export const controlBase = [
  'w-full rounded-[var(--control-radius)] border bg-[var(--control-bg)]',
  'text-fg placeholder:text-[var(--control-placeholder)]',
  'transition-[border-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-standard)]',
  'outline-none focus-visible:border-line-focus focus-visible:ring-2 focus-visible:ring-line-focus/35',
  'disabled:cursor-not-allowed disabled:bg-sunken disabled:text-fg-disabled',
  'aria-[invalid=true]:border-line-danger aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-danger/25',
].join(' ');

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Icon or text rendered inside the control, before the value. */
  leading?: ReactNode;
  /** Icon or button rendered inside the control, after the value. */
  trailing?: ReactNode;
}

/**
 * Height is 44px at the base viewport and only relaxes from `md` up. The
 * adornment slots are absolutely positioned so the text never reflows when one
 * appears (a password reveal toggle, for example).
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, leading, trailing, type = 'text', ...props },
  ref,
) {
  const wired = useFieldControlProps(props);
  return (
    <div className="relative flex items-center">
      {leading ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3 text-fg-tertiary"
        >
          {leading}
        </span>
      ) : null}
      <input
        ref={ref}
        type={type}
        className={cn(
          controlBase,
          'min-h-[var(--control-height-md)] border-[var(--control-border)] px-3 text-base md:text-sm',
          leading && 'ps-10',
          trailing && 'pe-11',
          className,
        )}
        {...props}
        {...wired}
      />
      {trailing ? (
        <span className="absolute inset-y-0 end-0 flex items-center pe-1.5 text-fg-tertiary">
          {trailing}
        </span>
      ) : null}
    </div>
  );
});
