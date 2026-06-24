import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '../../../utils/classNames';

export interface PopoverProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  modal?: boolean;
  side?: React.ComponentProps<typeof PopoverPrimitive.Content>['side'];
  align?: React.ComponentProps<typeof PopoverPrimitive.Content>['align'];
  sideOffset?: number;
  alignOffset?: number;
  avoidCollisions?: boolean;
  collisionBoundary?: React.ComponentProps<typeof PopoverPrimitive.Content>['collisionBoundary'];
  collisionPadding?: React.ComponentProps<typeof PopoverPrimitive.Content>['collisionPadding'];
  arrowPadding?: number;
  sticky?: React.ComponentProps<typeof PopoverPrimitive.Content>['sticky'];
  hideWhenDetached?: boolean;
  onOpenAutoFocus?: React.ComponentProps<typeof PopoverPrimitive.Content>['onOpenAutoFocus'];
  onCloseAutoFocus?: React.ComponentProps<typeof PopoverPrimitive.Content>['onCloseAutoFocus'];
  onEscapeKeyDown?: React.ComponentProps<typeof PopoverPrimitive.Content>['onEscapeKeyDown'];
  onPointerDownOutside?: React.ComponentProps<
    typeof PopoverPrimitive.Content
  >['onPointerDownOutside'];
  onFocusOutside?: React.ComponentProps<typeof PopoverPrimitive.Content>['onFocusOutside'];
  onInteractOutside?: React.ComponentProps<typeof PopoverPrimitive.Content>['onInteractOutside'];
  forceMount?: boolean;
  container?: React.ComponentProps<typeof PopoverPrimitive.Portal>['container'];
  className?: string;
  showArrow?: boolean;
  arrowWidth?: number;
  arrowHeight?: number;
  showClose?: boolean;
  closeButtonClassName?: string;
  focusRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Popover Component
 *
 * A flexible popover component built on Radix UI Popover primitives.
 * Supports all Radix Popover APIs via props spreading.
 *
 * @example
 * // Simple usage with string content
 * <Popover trigger={<button>Click me</button>}>
 *   This is a popover
 * </Popover>
 *
 * @example
 * // With React element content
 * <Popover trigger={<button>Click me</button>}>
 *   <div>
 *     <strong>Rich content</strong>
 *     <p>With multiple elements</p>
 *   </div>
 * </Popover>
 *
 * @example
 * // Set position (side, align, offsets)
 * <Popover
 *   trigger={<button>Click me</button>}
 *   side="top" // 'top' | 'right' | 'bottom' | 'left'
 *   align="center" // 'start' | 'center' | 'end'
 *   sideOffset={8} // Distance from trigger (in pixels)
 *   alignOffset={4} // Additional offset for alignment
 * >
 *   Positioned popover
 * </Popover>
 *
 * @example
 * // Set collision boundary and padding
 * <Popover
 *   trigger={<button>Click me</button>}
 *   side="bottom"
 *   avoidCollisions={true} // Auto-adjust position to avoid collisions
 *   collisionBoundary={[document.body]} // Element(s) to check collisions against
 *   collisionPadding={8} // Padding around collision boundary
 * >
 *   Collision-aware popover
 * </Popover>
 *
 * @example
 * // Controlled popover (programmatic control)
 * <Popover
 *   trigger={<button>Click me</button>}
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   defaultOpen={false}
 * >
 *   Controlled popover
 * </Popover>
 *
 * @example
 * // Modal popover (traps focus)
 * <Popover
 *   trigger={<button>Click me</button>}
 *   modal={true}
 * >
 *   Modal popover
 * </Popover>
 *
 * @example
 * // With arrow
 * <Popover
 *   trigger={<button>Click me</button>}
 *   showArrow={true}
 *   arrowWidth={10}
 *   arrowHeight={5}
 * >
 *   Popover with arrow
 * </Popover>
 *
 * @example
 * // With close button
 * <Popover
 *   trigger={<button>Click me</button>}
 *   showClose={true}
 * >
 *   Popover with close button
 * </Popover>
 *
 * @example
 * // Custom focus handlers
 * <Popover
 *   trigger={<button>Click me</button>}
 *   onOpenAutoFocus={(e) => e.preventDefault()}
 *   onCloseAutoFocus={(e) => e.preventDefault()}
 *   onEscapeKeyDown={(e) => console.log('Escape pressed')}
 * >
 *   Custom focus handlers
 * </Popover>
 *
 * @example
 * // Complete example with all positioning options
 * <Popover
 *   trigger={<button>Click me</button>}
 *   side="top"
 *   align="start"
 *   sideOffset={10}
 *   alignOffset={5}
 *   avoidCollisions={true}
 *   collisionBoundary={[document.body]}
 *   collisionPadding={8}
 *   arrowPadding={0}
 *   sticky="partial" // 'always' | 'partial'
 *   hideWhenDetached={false}
 *   showArrow={true}
 *   arrowWidth={10}
 *   arrowHeight={5}
 *   modal={false}
 * >
 *   Fully configured popover
 * </Popover>
 */
export const Popover = ({
  trigger,
  children,
  open,
  defaultOpen,
  onOpenChange,
  modal = false,
  side,
  align = 'center',
  sideOffset = 4,
  alignOffset,
  avoidCollisions = true,
  collisionBoundary,
  collisionPadding = 0,
  arrowPadding = 0,
  sticky = 'partial',
  hideWhenDetached,
  onOpenAutoFocus,
  onCloseAutoFocus,
  onEscapeKeyDown,
  onPointerDownOutside,
  onFocusOutside,
  onInteractOutside,
  forceMount,
  container,
  className,
  showArrow = false,
  arrowWidth = 10,
  arrowHeight = 5,
  showClose = false,
  closeButtonClassName,
  focusRef,
}: PopoverProps): React.ReactElement => {
  const handleOpenAutoFocus = React.useCallback(
    (event: Event) => {
      if (focusRef) {
        event.preventDefault();
        focusRef.current?.focus();
      }
      onOpenAutoFocus?.(event);
    },
    [focusRef, onOpenAutoFocus],
  );

  return (
    <PopoverPrimitive.Root
      data-slot='popover'
      {...(open !== undefined && { open })}
      {...(defaultOpen !== undefined && { defaultOpen })}
      {...(onOpenChange !== undefined && { onOpenChange })}
      {...(modal !== undefined && { modal })}
    >
      <PopoverPrimitive.Trigger asChild data-slot='popover-trigger'>
        {trigger}
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal
        data-slot='popover-portal'
        {...(container !== undefined && { container })}
      >
        <PopoverPrimitive.Content
          data-slot='popover-content'
          {...(side !== undefined && { side })}
          align={align}
          sideOffset={sideOffset}
          {...(alignOffset !== undefined && { alignOffset })}
          avoidCollisions={avoidCollisions}
          {...(collisionBoundary !== undefined && { collisionBoundary })}
          collisionPadding={collisionPadding}
          arrowPadding={arrowPadding}
          sticky={sticky}
          {...(hideWhenDetached !== undefined && { hideWhenDetached })}
          {...(onOpenAutoFocus !== undefined || focusRef !== undefined
            ? { onOpenAutoFocus: handleOpenAutoFocus }
            : undefined)}
          {...(onCloseAutoFocus !== undefined && { onCloseAutoFocus })}
          {...(onEscapeKeyDown !== undefined && { onEscapeKeyDown })}
          {...(onPointerDownOutside !== undefined && { onPointerDownOutside })}
          {...(onFocusOutside !== undefined && { onFocusOutside })}
          {...(onInteractOutside !== undefined && { onInteractOutside })}
          {...(forceMount === true && { forceMount: true })}
          className={cn(
            'bg-popover text-popover-foreground',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'data-[side=bottom]:slide-in-from-top-2',
            'data-[side=left]:slide-in-from-right-2',
            'data-[side=right]:slide-in-from-left-2',
            'data-[side=top]:slide-in-from-bottom-2',
            'z-[60] w-fit origin-[--radix-popover-content-transform-origin]',
            'rounded-md border p-4 shadow-md outline-hidden',
            className,
          )}
        >
          {children}
          {showArrow && (
            <PopoverPrimitive.Arrow
              className={cn('fill-popover')}
              width={arrowWidth}
              height={arrowHeight}
            />
          )}
          {showClose && (
            <PopoverPrimitive.Close
              className={cn(
                'absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none',
                closeButtonClassName,
              )}
              aria-label='Close'
            >
              <svg
                xmlns='http://www.w3.org/2000/svg'
                width='15'
                height='15'
                viewBox='0 0 15 15'
                fill='none'
              >
                <path
                  d='M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z'
                  fill='currentColor'
                  fillRule='evenodd'
                  clipRule='evenodd'
                />
              </svg>
            </PopoverPrimitive.Close>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
};

Popover.displayName = 'Popover';
