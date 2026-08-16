import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '@/lib/cn';

export interface ScrollAreaProps extends ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> {
  orientation?: 'vertical' | 'horizontal' | 'both';
  viewportClassName?: string;
}

/**
 * `type="scroll"` rather than "always": a custom scrollbar that is permanently
 * visible on a touch device is chrome the platform already draws better. This
 * shows ours only once a scroll actually happens.
 */
export const ScrollArea = forwardRef<ElementRef<typeof ScrollAreaPrimitive.Root>, ScrollAreaProps>(
  function ScrollArea(
    { className, children, orientation = 'vertical', viewportClassName, ...props },
    ref,
  ) {
    return (
      <ScrollAreaPrimitive.Root
        ref={ref}
        type="scroll"
        scrollHideDelay={600}
        className={cn('relative overflow-hidden', className)}
        {...props}
      >
        <ScrollAreaPrimitive.Viewport className={cn('size-full [&>div]:!block', viewportClassName)}>
          {children}
        </ScrollAreaPrimitive.Viewport>

        {(orientation === 'vertical' || orientation === 'both') && (
          <ScrollBar orientation="vertical" />
        )}
        {(orientation === 'horizontal' || orientation === 'both') && (
          <ScrollBar orientation="horizontal" />
        )}
        <ScrollAreaPrimitive.Corner />
      </ScrollAreaPrimitive.Root>
    );
  },
);

function ScrollBar({ orientation }: { orientation: 'vertical' | 'horizontal' }) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      orientation={orientation}
      className={cn(
        'flex touch-none select-none p-0.5 transition-colors',
        orientation === 'vertical' ? 'w-2.5' : 'h-2.5 flex-col',
      )}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-line-strong/60" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}
