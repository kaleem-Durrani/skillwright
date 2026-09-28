import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { useMotionKit } from '@/lib/motion';

export type PopoverProps = ComponentPropsWithoutRef<typeof PopoverPrimitive.Root>;

/**
 * A popover in this app is NON-MODAL, and the default is set here rather than at
 * the call site so that a caller cannot get it wrong by forgetting.
 *
 * Radix defaults `modal` to true, which is the wrong contract for what this
 * holds. Modal means the rest of the page is `aria-hidden` and inert while the
 * panel is open, and focus is held inside it — a DIALOG's contract, for a task
 * the user has to finish. Every popover in this codebase is a disclosure: prose
 * beside the control that opened it, dismissible by Escape or an outside click,
 * with nothing to complete and nothing to decide before the page is usable again.
 * Hiding the screen the reader is reading ABOUT, to show them a sentence about
 * that screen, is the wrong trade — and it is the one that made the description
 * hard to find in the first place.
 *
 * A caller that genuinely needs modal behaviour passes `modal`; the prop is
 * still honoured, this only changes the default.
 */
export function Popover({ modal = false, ...props }: PopoverProps) {
  return <PopoverPrimitive.Root modal={modal} {...props} />;
}

export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

/**
 * The surface itself.
 *
 * NOT `DropdownMenuContent`, and that is a measured difference rather than a
 * stylistic one. A Radix `menu` may own only menuitem / menuitemcheckbox /
 * menuitemradio / group / separator, and `NotificationBell.tsx` carries the
 * record of what happens when it owns anything else: axe reported
 * `aria-required-children` at CRITICAL against that panel in both themes, and
 * the fix in this file's sibling comment is still outstanding. A popover is
 * `role="dialog"` with no such restriction, so arbitrary content — which is the
 * entire point of moving a description in here — is legal here and illegal
 * there.
 *
 * Sizing is deliberately NOT set here. A popover is a disclosure for whatever
 * its caller is disclosing, and the two things that have to be measured differ
 * per use: how wide a sentence reads at, and how tall the content may be before
 * it needs to scroll. A default width here would be a number invented in
 * isolation; the call site knows both.
 *
 * `outline-none` because Radix focuses the content itself on open (it is
 * `tabIndex={-1}` and holds no further focusable child here), and a focus ring
 * around the whole panel says "you are typing in a field" about a box the user
 * is only reading.
 */
export const PopoverContent = forwardRef<
  ElementRef<typeof PopoverPrimitive.Content>,
  ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(function PopoverContent({ className, sideOffset = 6, children, ...props }, ref) {
  const { variants } = useMotionKit();
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        collisionPadding={12}
        className={cn(
          'z-50 rounded-lg border border-line-subtle bg-overlay p-3 shadow-e3',
          'origin-[var(--radix-popover-content-transform-origin)]',
          'outline-none',
          className,
        )}
        asChild
        {...props}
      >
        <motion.div variants={variants.pop} initial="hidden" animate="visible">
          {children}
        </motion.div>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
});
