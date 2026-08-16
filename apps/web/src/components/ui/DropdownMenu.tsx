import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { motion } from 'motion/react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useMotionKit } from '@/lib/motion';

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;
export const DropdownMenuRadioGroup = Menu.RadioGroup;

/**
 * Enter animation only.
 *
 * WHY no exit: Radix owns this component's mount lifecycle and unmounts on close
 * before an AnimatePresence sibling could react. A 140ms fade-out on a menu the
 * user has already dismissed is invisible anyway — the click that closed it has
 * already moved their attention elsewhere.
 */
export const DropdownMenuContent = forwardRef<
  ElementRef<typeof Menu.Content>,
  ComponentPropsWithoutRef<typeof Menu.Content>
>(function DropdownMenuContent({ className, sideOffset = 6, children, ...props }, ref) {
  const { variants } = useMotionKit();
  return (
    <Menu.Portal>
      <Menu.Content
        ref={ref}
        sideOffset={sideOffset}
        collisionPadding={12}
        className={cn(
          'z-50 min-w-[12rem] overflow-hidden rounded-lg border border-line-subtle bg-overlay p-1 shadow-e3',
          // Never taller than the space Radix measured for it.
          '[max-block-size:var(--radix-dropdown-menu-content-available-height)] overflow-y-auto',
          'origin-[var(--radix-dropdown-menu-content-transform-origin)]',
          className,
        )}
        asChild
        {...props}
      >
        <motion.div variants={variants.pop} initial="hidden" animate="visible">
          {children}
        </motion.div>
      </Menu.Content>
    </Menu.Portal>
  );
});

const itemBase = cn(
  'relative flex tap w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm',
  'outline-none select-none',
  'focus:bg-hover data-[highlighted]:bg-hover',
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
  // Pointer devices get a tighter row; touch keeps the 44px target.
  'md:min-h-9 md:min-w-0 md:py-1.5',
);

export interface DropdownMenuItemProps extends ComponentPropsWithoutRef<typeof Menu.Item> {
  icon?: ReactNode;
  /** Destructive rows are tinted and always sit last, after a separator. */
  destructive?: boolean;
}

export const DropdownMenuItem = forwardRef<ElementRef<typeof Menu.Item>, DropdownMenuItemProps>(
  function DropdownMenuItem({ className, icon, destructive, children, ...props }, ref) {
    return (
      <Menu.Item
        ref={ref}
        className={cn(
          itemBase,
          destructive
            ? 'text-danger-fg focus:bg-danger-soft data-[highlighted]:bg-danger-soft'
            : 'text-fg',
          className,
        )}
        {...props}
      >
        {icon ? <span className="shrink-0 text-fg-tertiary">{icon}</span> : null}
        <span className="flex-1 truncate text-start">{children}</span>
      </Menu.Item>
    );
  },
);

export const DropdownMenuCheckboxItem = forwardRef<
  ElementRef<typeof Menu.CheckboxItem>,
  ComponentPropsWithoutRef<typeof Menu.CheckboxItem>
>(function DropdownMenuCheckboxItem({ className, children, ...props }, ref) {
  return (
    <Menu.CheckboxItem ref={ref} className={cn(itemBase, 'ps-8 text-fg', className)} {...props}>
      <Menu.ItemIndicator className="absolute start-2.5 flex items-center">
        <Check aria-hidden="true" className="size-4" />
      </Menu.ItemIndicator>
      {children}
    </Menu.CheckboxItem>
  );
});

export const DropdownMenuRadioItem = forwardRef<
  ElementRef<typeof Menu.RadioItem>,
  ComponentPropsWithoutRef<typeof Menu.RadioItem>
>(function DropdownMenuRadioItem({ className, children, ...props }, ref) {
  return (
    <Menu.RadioItem ref={ref} className={cn(itemBase, 'ps-8 text-fg', className)} {...props}>
      <Menu.ItemIndicator className="absolute start-3 flex items-center">
        <span className="size-2 rounded-full bg-brand" />
      </Menu.ItemIndicator>
      {children}
    </Menu.RadioItem>
  );
});

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof Menu.Label>) {
  return (
    <Menu.Label
      className={cn(
        'px-2.5 py-1.5 text-2xs font-semibold tracking-wide text-fg-tertiary uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof Menu.Separator>) {
  return <Menu.Separator className={cn('-mx-1 my-1 h-px bg-line-subtle', className)} {...props} />;
}
