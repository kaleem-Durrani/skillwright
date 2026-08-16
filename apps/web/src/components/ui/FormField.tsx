import { createContext, useContext, useId, type AriaAttributes, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Label } from './Label.js';

interface FieldContextValue {
  controlId: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/**
 * Read the wiring a parent FormField established.
 *
 * WHY context and not cloneElement: the control is frequently wrapped (a Select
 * trigger, an input with an adornment), and cloneElement only reaches the direct
 * child. Context reaches the control wherever it ended up.
 */
export function useFieldContext(): FieldContextValue | null {
  return useContext(FieldContext);
}

/** What a control needs from its FormField, and nothing else. */
export interface FieldControlWiring {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  required?: boolean;
}

/**
 * Returns ONLY the attributes the field owns, so a control can spread its own
 * props first and this second without either clobbering the other. An explicit
 * prop on the control always wins: nothing here overrides a value the caller set.
 */
export function useFieldControlProps(local: {
  id?: string;
  'aria-describedby'?: AriaAttributes['aria-describedby'];
  'aria-invalid'?: AriaAttributes['aria-invalid'];
  required?: boolean;
}): FieldControlWiring {
  const field = useFieldContext();
  if (!field) return {};

  const describedBy = [field.describedBy, local['aria-describedby']].filter(Boolean).join(' ');

  return {
    ...(local.id === undefined ? { id: field.controlId } : {}),
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    ...(field.invalid && local['aria-invalid'] === undefined
      ? { 'aria-invalid': true as const }
      : {}),
    ...(local.required === undefined && field.required ? { required: true } : {}),
  };
}

export interface FormFieldProps {
  label: ReactNode;
  children: ReactNode;
  /** Persistent help text. Always rendered above the error, never replaced by it. */
  hint?: ReactNode;
  /** Validation message. Its presence is what flips the field to invalid. */
  error?: string | null;
  required?: boolean;
  /** Override the generated id — only needed when a control cannot take one. */
  id?: string;
  className?: string;
  /** Right-aligned slot next to the label ("Forgot password?"). */
  action?: ReactNode;
}

/**
 * Wires a label, a hint, an error and a control together.
 *
 * WHY this exists instead of hand-writing the attributes: `aria-describedby`
 * must point at the hint AND the error, must drop the error id when there is no
 * error, and must never be clobbered by a control that sets its own. Three rules,
 * repeated at every input, is three rules that get broken.
 */
export function FormField({
  label,
  children,
  hint,
  error,
  required = false,
  id,
  className,
  action,
}: FormFieldProps) {
  const generatedId = useId();
  const controlId = id ?? `field-${generatedId}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <FieldContext.Provider value={{ controlId, describedBy, invalid: Boolean(error), required }}>
      <div className={cn('flex flex-col gap-1.5', className)}>
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor={controlId} required={required}>
            {label}
          </Label>
          {action}
        </div>

        {children}

        {hint ? (
          <p id={hintId} className="text-xs text-fg-tertiary">
            {hint}
          </p>
        ) : null}

        {error ? (
          <p
            id={errorId}
            // Polite, not assertive: a validation message that interrupts the
            // user mid-keystroke is worse than one they hear a beat later.
            role="status"
            aria-live="polite"
            className="flex items-start gap-1.5 text-xs font-medium text-danger-fg"
          >
            <AlertCircle aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}
