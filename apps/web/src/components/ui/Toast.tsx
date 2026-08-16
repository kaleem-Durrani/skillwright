import { useSyncExternalStore, type ReactNode } from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, CircleAlert, Info, TriangleAlert, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useMotionKit } from '@/lib/motion';
import { ApiError } from '@/lib/problem';
import { IconButton } from './Button.js';

export type ToastTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface ToastRecord {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
  duration: number;
  action?: { label: string; onClick: () => void };
}

type Listener = () => void;

/**
 * A module-level store rather than a context.
 *
 * WHY: a toast is frequently raised from a mutation callback, an error boundary,
 * or a socket handler — places that are not inside the React tree that owns the
 * viewport. Threading a context through all of them means every one of those
 * call sites becomes a hook, and error handlers cannot be hooks.
 */
const listeners = new Set<Listener>();
let toasts: ToastRecord[] = [];

function emit() {
  toasts = [...toasts];
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot() {
  return toasts;
}

export interface ToastOptions {
  description?: string;
  tone?: ToastTone;
  /** Milliseconds. Errors default to twice as long as successes. */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

export function toast(title: string, options: ToastOptions = {}): string {
  const tone = options.tone ?? 'neutral';
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const record: ToastRecord = {
    id,
    title,
    tone,
    duration: options.duration ?? (tone === 'danger' ? 8000 : 4000),
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.action !== undefined ? { action: options.action } : {}),
  };
  // Cap the stack: a burst of socket errors must not bury the whole screen.
  toasts = [...toasts.slice(-2), record];
  emit();
  return id;
}

toast.success = (title: string, options: ToastOptions = {}) =>
  toast(title, { ...options, tone: 'success' });
toast.error = (title: string, options: ToastOptions = {}) =>
  toast(title, { ...options, tone: 'danger' });
toast.warning = (title: string, options: ToastOptions = {}) =>
  toast(title, { ...options, tone: 'warning' });
toast.info = (title: string, options: ToastOptions = {}) =>
  toast(title, { ...options, tone: 'info' });

/** Turn an unknown thrown value into a toast a user can act on. */
toast.fromError = (error: unknown, fallback = 'Something went wrong') => {
  if (error instanceof ApiError) {
    return toast(error.userMessage, {
      tone: 'danger',
      description: error.status >= 500 ? `Reference: ${error.requestId}` : undefined,
    });
  }
  return toast(fallback, { tone: 'danger' });
};

export function dismissToast(id: string) {
  toasts = toasts.filter((entry) => entry.id !== id);
  emit();
}

const TONE_ICON: Record<ToastTone, ReactNode> = {
  neutral: <Info aria-hidden="true" className="size-5" />,
  info: <Info aria-hidden="true" className="size-5" />,
  success: <CheckCircle2 aria-hidden="true" className="size-5" />,
  warning: <TriangleAlert aria-hidden="true" className="size-5" />,
  danger: <CircleAlert aria-hidden="true" className="size-5" />,
};

const TONE_CLASS: Record<ToastTone, string> = {
  neutral: 'text-fg-tertiary',
  info: 'text-info-fg',
  success: 'text-success-fg',
  warning: 'text-warning-fg',
  danger: 'text-danger-fg',
};

/**
 * Mount once, at the app root.
 *
 * The viewport sits ABOVE the bottom tab bar on mobile — a toast that covers the
 * navigation is a toast that traps the user for its whole duration — and moves
 * to the top-end corner from `md` up, where the sidebar owns the left edge.
 */
export function Toaster() {
  const items = useSyncExternalStore(subscribe, snapshot, snapshot);
  const { variants } = useMotionKit();

  return (
    <ToastPrimitive.Provider swipeDirection="right" duration={4000}>
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <ToastPrimitive.Root
            key={item.id}
            duration={item.duration}
            onOpenChange={(open) => {
              if (!open) dismissToast(item.id);
            }}
            asChild
            forceMount
          >
            <motion.li
              layout
              variants={variants.toast}
              initial="hidden"
              animate="visible"
              exit="exit"
              className={cn(
                'pointer-events-auto flex w-full items-start gap-3 rounded-lg border border-line-subtle bg-overlay p-3 shadow-e3',
                'data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]',
                'data-[swipe=cancel]:translate-x-0',
              )}
            >
              <span className={cn('mt-px shrink-0', TONE_CLASS[item.tone])}>
                {TONE_ICON[item.tone]}
              </span>

              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <ToastPrimitive.Title className="text-sm font-semibold text-fg">
                  {item.title}
                </ToastPrimitive.Title>
                {item.description ? (
                  <ToastPrimitive.Description className="text-xs text-fg-secondary">
                    {item.description}
                  </ToastPrimitive.Description>
                ) : null}
                {item.action ? (
                  <ToastPrimitive.Action
                    altText={item.action.label}
                    onClick={item.action.onClick}
                    className="mt-1.5 self-start rounded-md px-2 py-1.5 text-xs font-semibold text-fg-brand hover:bg-hover"
                  >
                    {item.action.label}
                  </ToastPrimitive.Action>
                ) : null}
              </div>

              <ToastPrimitive.Close asChild>
                <IconButton
                  aria-label="Dismiss notification"
                  icon={<X className="size-4" />}
                  size="sm"
                  className="-me-1 -mt-1 shrink-0"
                />
              </ToastPrimitive.Close>
            </motion.li>
          </ToastPrimitive.Root>
        ))}
      </AnimatePresence>

      <ToastPrimitive.Viewport
        className={cn(
          'pointer-events-none fixed z-[60] flex list-none flex-col gap-2 outline-none',
          // base: above the tab bar and the home indicator
          'inset-x-0 bottom-0 p-3 pb-[calc(var(--shell-tabbar-h)+var(--shell-safe-bottom)+0.75rem)]',
          // md and up: no tab bar exists, so the corner is free
          'md:inset-x-auto md:top-0 md:bottom-auto md:end-0 md:w-[24rem] md:p-4 md:pb-4',
        )}
      />
    </ToastPrimitive.Provider>
  );
}
