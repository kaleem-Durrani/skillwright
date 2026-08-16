import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { controlBase } from './Input.js';
import { useFieldControlProps } from './FormField.js';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Grows with the content instead of scrolling inside a fixed box. */
  autoResize?: boolean;
}

/**
 * `field-sizing: content` does the auto-grow natively where it is supported and
 * degrades to a normal scrolling textarea where it is not — no ResizeObserver,
 * no scrollHeight write-back, no layout thrash on every keystroke.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, autoResize = false, rows = 4, ...props },
  ref,
) {
  const wired = useFieldControlProps(props);
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        controlBase,
        'block resize-y border-[var(--control-border)] px-3 py-2.5 text-base leading-relaxed md:text-sm',
        autoResize && '[field-sizing:content] resize-none',
        className,
      )}
      {...props}
      {...wired}
    />
  );
});
