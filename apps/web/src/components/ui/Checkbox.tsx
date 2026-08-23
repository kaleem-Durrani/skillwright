import {
  forwardRef,
  useId,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type ReactNode,
} from 'react';
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
 *
 * `hint` is a DESCRIPTION, not part of the name. Both used to sit inside the wrapping
 * `<label>`, and everything inside a label is the control's accessible NAME — so a
 * checkbox whose hint explained a policy in two sentences announced as one 57-word
 * name, with no description at all, and a screen-reader user had to hear the whole
 * essay before learning what the control was. The hint now lives outside the label and
 * is wired through `aria-describedby`, which is what a browser reads second and on
 * request.
 */
export const Checkbox = forwardRef<ElementRef<typeof CheckboxPrimitive.Root>, CheckboxProps>(
  function Checkbox({ className, label, hint, id, ...props }, ref) {
    const wired = useFieldControlProps(id === undefined ? {} : { id });
    const hintId = useId();
    // Merged rather than replaced: inside a FormField, `wired` may already carry the
    // field's own description, and dropping it would trade one silence for another.
    const describedBy =
      hint === undefined
        ? wired['aria-describedby']
        : [wired['aria-describedby'], hintId].filter(Boolean).join(' ');

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
        {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
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
      <div className="flex flex-col">
        {/*
          Only the label is inside the `<label>`; the hint is a SIBLING carrying the id
          the box points at. That is the whole difference between a description and a
          57-word name — see the note on this component.

          The hint is indented to the label's text column (box 20px + gap 12px) so it
          reads as belonging to the control rather than to whatever follows it.
        */}
        <label className="flex tap cursor-pointer items-start gap-3 py-2 select-none">
          {box}
          <span className="text-sm text-fg peer-disabled:text-fg-disabled">{label}</span>
        </label>
        {hint ? (
          <span id={hintId} className="ps-8 pb-1 text-xs text-fg-tertiary">
            {hint}
          </span>
        ) : null}
      </div>
    );
  },
);
