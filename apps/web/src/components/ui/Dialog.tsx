import {
  createContext,
  useCallback,
  useContext,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useMotionKit } from '@/lib/motion';
import { IconButton } from './Button.js';

interface DialogState {
  open: boolean;
}
const DialogContext = createContext<DialogState>({ open: false });

export interface DialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

/**
 * Wraps Radix so the open state is readable by DialogContent.
 *
 * WHY: exit animations need the element to stay mounted after `open` flips to
 * false. Radix unmounts it immediately unless `forceMount` is set, and
 * `forceMount` needs someone to decide when the tree renders at all — that is
 * AnimatePresence, and AnimatePresence needs the boolean.
 */
export function Dialog({ open, defaultOpen = false, onOpenChange, children }: DialogProps) {
  const [internal, setInternal] = useState(defaultOpen);
  const isControlled = open !== undefined;
  const value = isControlled ? open : internal;

  const handleChange = useCallback(
    (next: boolean) => {
      if (!isControlled) setInternal(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  return (
    <DialogContext.Provider value={{ open: value }}>
      <DialogPrimitive.Root open={value} onOpenChange={handleChange}>
        {children}
      </DialogPrimitive.Root>
    </DialogContext.Provider>
  );
}

export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/**
 * `title` is omitted from the DOM attributes because this component's `title` is
 * rendered content (a ReactNode heading), not the string `title` tooltip attribute.
 * The drag/animation handlers are omitted because the rest props are spread onto a
 * `motion.div`, and Motion redefines those four with its own (PanInfo /
 * AnimationDefinition) signatures — passing React's DOM versions through is a type
 * error and would silently not fire the way a caller expects.
 */
type DialogDivAttributes = Omit<
  HTMLAttributes<HTMLDivElement>,
  'title' | 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'
>;

export interface DialogContentProps extends DialogDivAttributes {
  title: ReactNode;
  /** Rendered as the accessible description; omit only if the body is self-evident. */
  description?: ReactNode;
  footer?: ReactNode;
  /** Hide the corner close button — for flows the user must resolve. */
  dismissible?: boolean;
}

/**
 * Bottom-anchored and full-bleed at the base viewport, because a centred modal
 * on a phone puts its actions under the user's thumb reach and its close button
 * in the far corner. It becomes a centred card from `sm` up.
 */
export function DialogContent({
  title,
  description,
  footer,
  dismissible = true,
  className,
  children,
  ...props
}: DialogContentProps) {
  const { open } = useContext(DialogContext);
  const { variants, transitions } = useMotionKit();

  return (
    <AnimatePresence>
      {open ? (
        <DialogPrimitive.Portal forceMount>
          <DialogPrimitive.Overlay asChild forceMount>
            <motion.div
              className="fixed inset-0 z-50 bg-scrim backdrop-blur-[2px]"
              variants={variants.fade}
              initial="hidden"
              animate="visible"
              exit="exit"
            />
          </DialogPrimitive.Overlay>

          <DialogPrimitive.Content asChild forceMount>
            <motion.div
              className={cn(
                'fixed z-50 flex flex-col bg-overlay text-fg shadow-e4',
                // mobile: docked to the bottom edge, safe-area aware
                'inset-x-0 bottom-0 [max-block-size:90dvh] rounded-t-2xl',
                'pb-[var(--shell-safe-bottom)]',
                // sm and up: a centred card
                'sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[min(32rem,calc(100dvw-3rem))]',
                'sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:pb-0',
                'focus:outline-none',
                className,
              )}
              variants={variants.sheetBottom}
              initial="hidden"
              animate="visible"
              exit="exit"
              transition={transitions.normal}
              {...props}
            >
              {/* Drag affordance. Decorative — the sheet is dismissed by the
                  overlay, Escape, or the close button, all of which are real. */}
              <div
                aria-hidden="true"
                className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line sm:hidden"
              />

              <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-2 sm:px-6 sm:pt-5">
                <div className="flex flex-col gap-1">
                  <DialogPrimitive.Title className="font-display text-lg font-semibold sm:text-xl">
                    {title}
                  </DialogPrimitive.Title>
                  {description ? (
                    <DialogPrimitive.Description className="text-sm text-fg-secondary">
                      {description}
                    </DialogPrimitive.Description>
                  ) : null}
                </div>
                {dismissible ? (
                  <DialogPrimitive.Close asChild>
                    <IconButton
                      aria-label="Close dialog"
                      icon={<X className="size-5" />}
                      className="-me-1.5 -mt-1.5"
                    />
                  </DialogPrimitive.Close>
                ) : null}
              </div>

              <div className="scroll-y flex-1 px-4 py-2 text-sm sm:px-6">{children}</div>

              {footer ? (
                <div className="flex flex-col gap-2 px-4 pt-3 pb-4 sm:flex-row sm:justify-end sm:px-6 sm:pb-5">
                  {footer}
                </div>
              ) : null}
            </motion.div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      ) : null}
    </AnimatePresence>
  );
}
