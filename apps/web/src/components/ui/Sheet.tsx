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

const SheetContext = createContext<{ open: boolean }>({ open: false });

export interface SheetProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

export function Sheet({ open, defaultOpen = false, onOpenChange, children }: SheetProps) {
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
    <SheetContext.Provider value={{ open: value }}>
      <DialogPrimitive.Root open={value} onOpenChange={handleChange}>
        {children}
      </DialogPrimitive.Root>
    </SheetContext.Provider>
  );
}

export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

/**
 * See Dialog.tsx: `title` here is rendered content rather than the DOM tooltip
 * attribute, and the four drag/animation handlers are redefined by Motion on the
 * `motion.div` these rest props are spread onto.
 */
type SheetDivAttributes = Omit<
  HTMLAttributes<HTMLDivElement>,
  'title' | 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'
>;

export interface SheetContentProps extends SheetDivAttributes {
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  /** Which edge it docks to from `md` up. Below md it is always a bottom sheet. */
  side?: 'end' | 'start';
}

/**
 * A drawer for secondary content: filters, a detail preview, a form that is too
 * long for a dialog.
 *
 * Below `md` it is a bottom sheet — a side panel on a 375px screen is either a
 * full-screen takeover pretending to be a panel, or a 280px column with nothing
 * usable in it. From `md` up it becomes the side panel it wants to be.
 */
export function SheetContent({
  title,
  description,
  footer,
  side = 'end',
  className,
  children,
  ...props
}: SheetContentProps) {
  const { open } = useContext(SheetContext);
  const { variants, transitions } = useMotionKit();

  return (
    <AnimatePresence>
      {open ? (
        <DialogPrimitive.Portal forceMount>
          <DialogPrimitive.Overlay asChild forceMount>
            <motion.div
              className="fixed inset-0 z-50 bg-scrim"
              variants={variants.fade}
              initial="hidden"
              animate="visible"
              exit="exit"
            />
          </DialogPrimitive.Overlay>

          <DialogPrimitive.Content asChild forceMount>
            <motion.div
              className={cn(
                'fixed z-50 flex flex-col bg-overlay text-fg shadow-e4 focus:outline-none',
                // base: bottom sheet
                'inset-x-0 bottom-0 [block-size:85dvh] rounded-t-2xl pb-[var(--shell-safe-bottom)]',
                // md and up: an edge-docked panel, full height
                'md:inset-y-0 md:[block-size:100dvh] md:w-[min(28rem,80dvw)] md:rounded-none md:pb-0',
                side === 'end'
                  ? 'md:end-0 md:start-auto md:border-s md:border-line-subtle'
                  : 'md:start-0 md:end-auto md:border-e md:border-line-subtle',
                className,
              )}
              /* Different geometry, different motion: it slides up from the
                 bottom on a phone and in from the edge on a desktop. */
              variants={variants.sheetBottom}
              initial="hidden"
              animate="visible"
              exit="exit"
              transition={transitions.normal}
              {...props}
            >
              <div
                aria-hidden="true"
                className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line md:hidden"
              />

              <div className="flex items-start justify-between gap-3 border-b border-line-subtle px-4 pt-4 pb-3 md:pt-5">
                <div className="flex flex-col gap-1">
                  <DialogPrimitive.Title className="font-display text-lg font-semibold">
                    {title}
                  </DialogPrimitive.Title>
                  {description ? (
                    <DialogPrimitive.Description className="text-sm text-fg-secondary">
                      {description}
                    </DialogPrimitive.Description>
                  ) : null}
                </div>
                <DialogPrimitive.Close asChild>
                  <IconButton
                    aria-label="Close panel"
                    icon={<X className="size-5" />}
                    className="-me-1.5 -mt-1.5"
                  />
                </DialogPrimitive.Close>
              </div>

              <div className="scroll-y flex-1 px-4 py-4 text-sm">{children}</div>

              {footer ? (
                <div className="flex flex-col gap-2 border-t border-line-subtle px-4 py-3 md:flex-row md:justify-end">
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
