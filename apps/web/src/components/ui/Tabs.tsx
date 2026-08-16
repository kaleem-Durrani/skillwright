import {
  createContext,
  useCallback,
  useContext,
  useId,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { useMotionKit } from '@/lib/motion';

interface TabsState {
  value: string | undefined;
  indicatorId: string;
}
const TabsContext = createContext<TabsState>({ value: undefined, indicatorId: 'tabs' });

export interface TabsProps extends Omit<
  ComponentPropsWithoutRef<typeof TabsPrimitive.Root>,
  'onValueChange'
> {
  onValueChange?: (value: string) => void;
}

/**
 * Tracks the active value itself so the underline can be a single shared element
 * that slides, rather than one border per trigger that pops. Radix does not
 * expose the active value to trigger children, so this wrapper does.
 */
export function Tabs({
  value,
  defaultValue,
  onValueChange,
  className,
  children,
  ...props
}: TabsProps) {
  const [internal, setInternal] = useState(defaultValue);
  const indicatorId = useId();
  const current = value ?? internal;

  const handleChange = useCallback(
    (next: string) => {
      if (value === undefined) setInternal(next);
      onValueChange?.(next);
    },
    [value, onValueChange],
  );

  return (
    <TabsContext.Provider value={{ value: current, indicatorId }}>
      <TabsPrimitive.Root
        value={current}
        onValueChange={handleChange}
        className={cn('flex flex-col gap-4', className)}
        {...props}
      >
        {children}
      </TabsPrimitive.Root>
    </TabsContext.Provider>
  );
}

/**
 * Scrolls horizontally at the base viewport instead of wrapping or shrinking.
 * Four tabs of real words do not fit across 375px, and a wrapped tab row reads
 * as two unrelated rows of links.
 */
export function TabsList({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return (
    <div className="scroll-x relative -mx-[var(--shell-gutter)] px-[var(--shell-gutter)] md:mx-0 md:px-0">
      <TabsPrimitive.List
        className={cn(
          'inline-flex w-auto items-center gap-1 border-b border-line-subtle',
          'min-w-full',
          className,
        )}
        {...props}
      >
        {children}
      </TabsPrimitive.List>
    </div>
  );
}

export interface TabsTriggerProps extends ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> {
  /** Right-hand count, e.g. pending enrolments. */
  count?: number;
  icon?: ReactNode;
}

export function TabsTrigger({
  className,
  value,
  children,
  count,
  icon,
  ...props
}: TabsTriggerProps) {
  const { value: active, indicatorId } = useContext(TabsContext);
  const { reduced, transitions } = useMotionKit();
  const isActive = active === value;

  return (
    <TabsPrimitive.Trigger
      value={value}
      className={cn(
        'relative flex tap shrink-0 items-center gap-2 px-3 pb-2.5 pt-2 text-sm font-medium whitespace-nowrap',
        'text-fg-secondary transition-colors duration-[var(--duration-fast)]',
        'outline-none hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-focus',
        'data-[state=active]:text-fg',
        'md:min-h-10 md:min-w-0',
        className,
      )}
      {...props}
    >
      {icon}
      {children}
      {typeof count === 'number' ? (
        <span
          className={cn(
            'rounded-full px-1.5 py-0.5 text-2xs font-semibold tabular-nums',
            isActive ? 'bg-brand-soft text-brand-on-soft' : 'bg-neutral-soft text-neutral-fg',
          )}
        >
          {count}
        </span>
      ) : null}

      {isActive ? (
        <motion.span
          aria-hidden="true"
          // Shared layoutId makes the underline travel between tabs. With
          // reduced motion the id is dropped so it simply appears in place.
          layoutId={reduced ? undefined : `tab-indicator-${indicatorId}`}
          transition={transitions.fast}
          className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand"
        />
      ) : null}
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn(
        'outline-none focus-visible:outline-2 focus-visible:outline-line-focus',
        className,
      )}
      {...props}
    />
  );
}
