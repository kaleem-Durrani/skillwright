import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { motion } from 'motion/react';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useMotionKit } from '@/lib/motion';
import { useFieldControlProps } from './FormField.js';

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export interface SelectTriggerProps extends ComponentPropsWithoutRef<
  typeof SelectPrimitive.Trigger
> {
  placeholder?: string;
}

export const SelectTrigger = forwardRef<
  ElementRef<typeof SelectPrimitive.Trigger>,
  SelectTriggerProps
>(function SelectTrigger({ className, children, placeholder, ...props }, ref) {
  const wired = useFieldControlProps(props);
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-[var(--control-radius)]',
        'min-h-[var(--control-height-md)] border border-[var(--control-border)] bg-[var(--control-bg)] px-3',
        'text-start text-base text-fg md:text-sm',
        'transition-[border-color,box-shadow] duration-[var(--duration-fast)]',
        'outline-none focus-visible:border-line-focus focus-visible:ring-2 focus-visible:ring-line-focus/35',
        'disabled:cursor-not-allowed disabled:bg-sunken disabled:text-fg-disabled',
        'data-[placeholder]:text-[var(--control-placeholder)]',
        'aria-[invalid=true]:border-line-danger aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-danger/25',
        className,
      )}
      {...props}
      {...wired}
    >
      <span className="truncate">
        {children ?? <SelectPrimitive.Value placeholder={placeholder} />}
      </span>
      <SelectPrimitive.Icon asChild>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-fg-tertiary" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});

export const SelectContent = forwardRef<
  ElementRef<typeof SelectPrimitive.Content>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(function SelectContent({ className, children, position = 'popper', ...props }, ref) {
  const { variants } = useMotionKit();
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        position={position}
        sideOffset={6}
        collisionPadding={12}
        className={cn(
          'z-50 overflow-hidden rounded-lg border border-line-subtle bg-overlay shadow-e3',
          'w-[var(--radix-select-trigger-width)] [max-block-size:var(--radix-select-content-available-height)]',
          className,
        )}
        asChild
        {...props}
      >
        <motion.div variants={variants.pop} initial="hidden" animate="visible">
          <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center text-fg-tertiary">
            <ChevronUp aria-hidden="true" className="size-4" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center text-fg-tertiary">
            <ChevronDown aria-hidden="true" className="size-4" />
          </SelectPrimitive.ScrollDownButton>
        </motion.div>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});

export interface SelectItemProps extends ComponentPropsWithoutRef<typeof SelectPrimitive.Item> {
  hint?: ReactNode;
}

export const SelectItem = forwardRef<ElementRef<typeof SelectPrimitive.Item>, SelectItemProps>(
  function SelectItem({ className, children, hint, ...props }, ref) {
    return (
      <SelectPrimitive.Item
        ref={ref}
        className={cn(
          'relative flex tap w-full cursor-pointer flex-col justify-center gap-0.5 rounded-md py-2 pe-8 ps-2.5 text-sm',
          'outline-none select-none data-[highlighted]:bg-hover',
          'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
          'md:min-h-9 md:min-w-0',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        {hint ? <span className="text-xs text-fg-tertiary">{hint}</span> : null}
        <SelectPrimitive.ItemIndicator className="absolute end-2.5 top-1/2 -translate-y-1/2">
          <Check aria-hidden="true" className="size-4 text-fg-brand" />
        </SelectPrimitive.ItemIndicator>
      </SelectPrimitive.Item>
    );
  },
);

export function SelectLabel({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn(
        'px-2.5 py-1.5 text-2xs font-semibold tracking-wide text-fg-tertiary uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function SelectSeparator({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      className={cn('-mx-1 my-1 h-px bg-line-subtle', className)}
      {...props}
    />
  );
}
