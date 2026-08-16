import type { ReactElement, ReactNode } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { useMotionKit } from '@/lib/motion';

export const TooltipProvider = TooltipPrimitive.Provider;

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** Set only when there is nothing else to delay against. */
  delayDuration?: number;
}

/**
 * Progressive enhancement, never the only channel.
 *
 * A tooltip requires hover, and a touch device has no hover. Anything a user
 * MUST read has to be visible copy or an aria-label; this is for the extra
 * nicety a pointer user gets for free. Every IconButton in this app therefore
 * carries a real aria-label whether or not it is also wrapped in one of these.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  delayDuration = 250,
}: TooltipProps) {
  const { variants } = useMotionKit();

  return (
    <TooltipPrimitive.Root delayDuration={delayDuration}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={12}
          className={cn(
            'z-50 rounded-md bg-inverse px-2.5 py-1.5 text-xs font-medium text-fg-inverse shadow-e3',
            '[max-inline-size:16rem]',
          )}
          asChild
        >
          <motion.div variants={variants.pop} initial="hidden" animate="visible">
            {content}
            <TooltipPrimitive.Arrow
              className="fill-[var(--surface-inverse)]"
              width={10}
              height={5}
            />
          </motion.div>
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
