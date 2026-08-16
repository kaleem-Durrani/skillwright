import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner.js';

/**
 * Five variants, no more. Each one answers a different question:
 *   primary   — the single most important action on the screen
 *   secondary — a real alternative to it
 *   ghost     — an action that lives inside another surface (toolbars, cards)
 *   danger    — destructive, and always paired with a confirmation
 *   link      — navigation wearing a button's clothes
 *
 * Sizes are 44px tall at the base viewport, unconditionally. They only shrink
 * from `md` up, where a pointer is doing the aiming.
 */
const buttonVariants = cva(
  [
    'relative inline-flex items-center justify-center gap-2',
    'rounded-md font-medium whitespace-nowrap select-none',
    'transition-[background-color,border-color,color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-standard)]',
    'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-focus',
    'disabled:pointer-events-none disabled:opacity-50',
    'aria-busy:pointer-events-none',
    // Touch devices only: kill the 300ms tap highlight without killing focus.
    '[-webkit-tap-highlight-color:transparent] touch-manipulation',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-brand text-fg-on-brand shadow-e1 hover:bg-brand-hover active:bg-brand-active',
        secondary: 'bg-surface text-fg border border-line hover:bg-hover active:bg-active',
        ghost: 'bg-transparent text-fg-secondary hover:bg-hover hover:text-fg active:bg-active',
        danger: 'bg-danger text-fg-on-brand shadow-e1 hover:brightness-110 active:brightness-95',
        link: 'bg-transparent text-fg-link underline underline-offset-4 decoration-1 hover:decoration-2',
      },
      size: {
        sm: 'tap px-3 text-sm md:min-h-[var(--control-height-sm)] md:min-w-0 md:px-2.5',
        md: 'tap px-4 text-sm md:min-h-[var(--control-height-md)] md:min-w-0',
        lg: 'min-h-[var(--control-height-lg)] px-5 text-base',
        icon: 'tap p-0 md:size-[var(--control-height-md)] md:min-h-0 md:min-w-0',
      },
      block: {
        // Mobile default for primary form actions: thumbs are at the bottom edge.
        true: 'w-full',
        false: '',
      },
    },
    compoundVariants: [
      // cva emits compound classes AFTER the variant classes, so this is what
      // wins the twMerge conflict against the size variant's own padding.
      { variant: 'link', class: 'px-0' },
    ],
    defaultVariants: { variant: 'primary', size: 'md', block: false },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Render as the single child element (a router Link, usually). */
  asChild?: boolean;
  /** Swaps the leading slot for a spinner and blocks interaction. */
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size,
    block,
    asChild = false,
    loading = false,
    leadingIcon,
    trailingIcon,
    children,
    disabled,
    type,
    ...props
  },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      // An unspecified <button> inside a <form> submits it. That default has
      // caused more accidental submits than it has ever saved keystrokes.
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(buttonVariants({ variant, size, block }), className)}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {/* Slot demands EXACTLY ONE child, so `asChild` passes the caller's
          element through untouched. Icons and the loading spinner belong to the
          plain-button path; a Link that also wants an icon puts it inside the
          Link, where it is that element's own business. */}
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <Spinner size="sm" /> : leadingIcon}
          {children}
          {!loading && trailingIcon}
        </>
      )}
    </Comp>
  );
});

export interface IconButtonProps extends Omit<
  ButtonProps,
  'children' | 'leadingIcon' | 'trailingIcon' | 'block'
> {
  /**
   * REQUIRED, at the type level, deliberately.
   *
   * An icon-only control has no accessible name unless one is supplied, and a
   * lint rule that can be silenced with a disable comment is not a guarantee.
   * Making the prop non-optional means an unlabelled IconButton does not compile.
   */
  'aria-label': string;
  icon: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, size = 'icon', variant = 'ghost', className, ...props },
  ref,
) {
  return (
    <Button
      ref={ref}
      size={size}
      variant={variant}
      className={cn('shrink-0', className)}
      {...props}
    >
      {icon}
    </Button>
  );
});

export { buttonVariants };
