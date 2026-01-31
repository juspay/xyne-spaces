import * as React from 'react';
import * as HoverCardPrimitive from '@radix-ui/react-hover-card';
import { cn } from '../../../utils/classNames';

export interface HoverCardProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  openDelay?: number;
  closeDelay?: number;
  side?: React.ComponentProps<typeof HoverCardPrimitive.Content>['side'];
  align?: React.ComponentProps<typeof HoverCardPrimitive.Content>['align'];
  sideOffset?: number;
  alignOffset?: number;
  avoidCollisions?: boolean;
  collisionBoundary?: React.ComponentProps<typeof HoverCardPrimitive.Content>['collisionBoundary'];
  collisionPadding?: React.ComponentProps<typeof HoverCardPrimitive.Content>['collisionPadding'];
  arrowPadding?: number;
  sticky?: React.ComponentProps<typeof HoverCardPrimitive.Content>['sticky'];
  hideWhenDetached?: boolean;
  className?: string;
  showArrow?: boolean;
}

/**
 * HoverCard Component
 *
 * A flexible hover card component built on Radix UI HoverCard primitives.
 * Supports all Radix HoverCard APIs via props spreading.
 *
 * @example
 * // Simple usage with string content
 * <HoverCard trigger={<button>Hover me</button>}>
 *   This is a hover card
 * </HoverCard>
 *
 * @example
 * // With React element content
 * <HoverCard trigger={<button>Hover me</button>}>
 *   <div>
 *     <strong>Rich content</strong>
 *     <p>With multiple elements</p>
 *   </div>
 * </HoverCard>
 *
 * @example
 * // Set delay duration (how long to wait before showing/hiding hover card)
 * <HoverCard
 *   trigger={<button>Hover me</button>}
 *   openDelay={700} // 700ms delay before opening
 *   closeDelay={300} // 300ms delay before closing
 * >
 *   Delayed hover card
 * </HoverCard>
 *
 * @example
 * // Set position (side, align, offsets)
 * <HoverCard
 *   trigger={<button>Hover me</button>}
 *   side="top" // 'top' | 'right' | 'bottom' | 'left'
 *   align="center" // 'start' | 'center' | 'end'
 *   sideOffset={8} // Distance from trigger (in pixels)
 *   alignOffset={4} // Additional offset for alignment
 * >
 *   Positioned hover card
 * </HoverCard>
 *
 * @example
 * // Set collision boundary and padding
 * <HoverCard
 *   trigger={<button>Hover me</button>}
 *   side="bottom"
 *   avoidCollisions={true} // Auto-adjust position to avoid collisions
 *   collisionBoundary={[document.body]} // Element(s) to check collisions against
 *   collisionPadding={8} // Padding around collision boundary
 * >
 *   Collision-aware hover card
 * </HoverCard>
 *
 * @example
 * // Controlled hover card (programmatic control)
 * <HoverCard
 *   trigger={<button>Click me</button>}
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   defaultOpen={false}
 * >
 *   Controlled hover card
 * </HoverCard>
 *
 * @example
 * // With arrow
 * <HoverCard
 *   trigger={<button>Hover me</button>}
 *   showArrow={true}
 * >
 *   Hover card with arrow
 * </HoverCard>
 *
 * @example
 * // Complete example with all positioning options
 * <HoverCard
 *   trigger={<button>Hover me</button>}
 *   openDelay={700}
 *   closeDelay={300}
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
 * >
 *   Fully configured hover card
 * </HoverCard>
 */
export const HoverCard = ({
  trigger,
  children,
  open,
  defaultOpen,
  onOpenChange,
  openDelay,
  closeDelay = 0,
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
  className,
  showArrow = false,
}: HoverCardProps): React.ReactElement => {
  return (
    <HoverCardPrimitive.Root
      data-slot='hover-card'
      {...(open !== undefined && { open })}
      {...(defaultOpen !== undefined && { defaultOpen })}
      {...(onOpenChange !== undefined && { onOpenChange })}
      {...(openDelay !== undefined && { openDelay })}
      {...(closeDelay !== undefined && { closeDelay })}
    >
      <HoverCardPrimitive.Trigger asChild data-slot='hover-card-trigger'>
        {trigger}
      </HoverCardPrimitive.Trigger>
      <HoverCardPrimitive.Portal data-slot='hover-card-portal'>
        <HoverCardPrimitive.Content
          data-slot='hover-card-content'
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
          className={cn(
            'bg-popover text-popover-foreground',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'data-[side=bottom]:slide-in-from-top-2',
            'data-[side=left]:slide-in-from-right-2',
            'data-[side=right]:slide-in-from-left-2',
            'data-[side=top]:slide-in-from-bottom-2',
            'z-50 w-64 origin-[--radix-hover-card-content-transform-origin]',
            'rounded-md border p-4 shadow-md outline-hidden',
            className,
          )}
        >
          {children}
          {showArrow && (
            <HoverCardPrimitive.Arrow className={cn('fill-popover')} width={10} height={5} />
          )}
        </HoverCardPrimitive.Content>
      </HoverCardPrimitive.Portal>
    </HoverCardPrimitive.Root>
  );
};

HoverCard.displayName = 'HoverCard';

export default HoverCard;
