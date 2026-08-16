import { useCallback, useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';

export interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Fired the moment the last box is filled — the user should not hunt for a button. */
  onComplete?: (value: string) => void;
  length?: number;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  /** Names the whole group; each box gets its own positional label. */
  label: string;
  describedBy?: string;
  className?: string;
}

const DIGITS = /\d/g;

/**
 * Six separate boxes rather than one text field.
 *
 * WHY, given that one field is less code: the six-box layout is what every
 * authenticator flow on every platform now looks like, and it makes the expected
 * length visible before the user starts typing. The cost is that it has to be
 * built correctly — auto-advance, backspace-to-previous, arrow keys, and above
 * all PASTE, because on a phone the code arrives in a notification the user
 * copies wholesale. A paste that fills only the first box is the single most
 * common defect in this pattern.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  disabled = false,
  invalid = false,
  autoFocus = false,
  label,
  describedBy,
  className,
}: OtpInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const completed = useRef(false);

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (value.length === length && !completed.current) {
      completed.current = true;
      onComplete?.(value);
    }
    if (value.length < length) completed.current = false;
  }, [value, length, onComplete]);

  const focusAt = useCallback((index: number) => {
    const target = refs.current[Math.max(0, Math.min(index, refs.current.length - 1))];
    target?.focus();
    target?.select();
  }, []);

  const setDigit = useCallback(
    (index: number, digit: string) => {
      const next = value.padEnd(length, ' ').split('');
      next[index] = digit;
      onChange(next.join('').trimEnd().replace(/ /g, ''));
    },
    [value, length, onChange],
  );

  const handleInput = (index: number, raw: string) => {
    const digits = raw.match(DIGITS)?.join('') ?? '';
    if (!digits) {
      // A cleared box truncates rather than leaving a hole in the middle.
      onChange(value.slice(0, index));
      return;
    }
    if (digits.length > 1) {
      // Autofill on iOS delivers the whole code into whichever box has focus.
      const merged = (value.slice(0, index) + digits).slice(0, length);
      onChange(merged);
      focusAt(merged.length);
      return;
    }
    setDigit(index, digits);
    focusAt(index + 1);
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (value[index]) {
        onChange(value.slice(0, index));
        focusAt(index);
      } else {
        onChange(value.slice(0, Math.max(0, index - 1)));
        focusAt(index - 1);
      }
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusAt(index - 1);
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusAt(index + 1);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const digits = event.clipboardData.getData('text').match(DIGITS)?.join('') ?? '';
    if (!digits) return;
    const next = digits.slice(0, length);
    onChange(next);
    focusAt(next.length);
  };

  return (
    <div
      role="group"
      aria-label={label}
      aria-describedby={describedBy}
      className={cn('flex items-center justify-between gap-1.5 sm:gap-2', className)}
    >
      {Array.from({ length }, (_, index) => (
        <input
          key={index}
          ref={(element) => {
            refs.current[index] = element;
          }}
          value={value[index] ?? ''}
          onChange={(event) => handleInput(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={handlePaste}
          onFocus={(event) => event.target.select()}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-label={`Digit ${index + 1} of ${length}`}
          // `one-time-code` on the FIRST box only: repeating it makes Safari
          // offer the suggestion six times and fill only the box that was tapped.
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={length}
          type="text"
          className={cn(
            // 44px minimum on both axes, and it grows with the viewport rather
            // than shrinking six boxes to fit a narrow one.
            'tap w-full flex-1 rounded-[var(--control-radius)] border text-center font-mono text-lg font-semibold',
            'bg-[var(--control-bg)] text-fg tabular-nums',
            'transition-[border-color,box-shadow] duration-[var(--duration-fast)]',
            'outline-none focus-visible:border-line-focus focus-visible:ring-2 focus-visible:ring-line-focus/35',
            'disabled:cursor-not-allowed disabled:bg-sunken disabled:text-fg-disabled',
            invalid ? 'border-line-danger' : 'border-[var(--control-border)]',
            'sm:text-xl',
          )}
        />
      ))}
    </div>
  );
}
