import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '../../../utils/classNames';

export interface TooltipProps extends React.ComponentProps<typeof TooltipPrimitive.Root> {
  children: React.ReactNode;
  content: string | React.ReactNode;
  delayDuration?: number;
  skipDelayDuration?: number;
  side?: React.ComponentProps<typeof TooltipPrimitive.Content>['side'];
  align?: React.ComponentProps<typeof TooltipPrimitive.Content>['align'];
  sideOffset?: number;
  alignOffset?: number;
  avoidCollisions?: boolean;
  collisionBoundary?: React.ComponentProps<typeof TooltipPrimitive.Content>['collisionBoundary'];
  collisionPadding?: React.ComponentProps<typeof TooltipPrimitive.Content>['collisionPadding'];
  sticky?: React.ComponentProps<typeof TooltipPrimitive.Content>['sticky'];
  hideWhenDetached?: boolean;
  className?: string;
  providerProps?: Omit<
    React.ComponentProps<typeof TooltipPrimitive.Provider>,
    'delayDuration' | 'skipDelayDuration'
  >;
}

/**
 * Tooltip Component
 *
 * A flexible tooltip component built on Radix UI Tooltip primitives.
 * Supports all Radix Tooltip APIs via props spreading.
 *
 * @example
 * // Simple usage with string content
 * <Tooltip content="This is a tooltip">
 *   <button>Hover me</button>
 * </Tooltip>
 *
 * @example
 * // With React element content
 * <Tooltip
 *   content={
 *     <div>
 *       <strong>Rich content</strong>
 *       <p>With multiple elements</p>
 *     </div>
 *   }
 * >
 *   <button>Hover me</button>
 * </Tooltip>
 *
 * @example
 * // Set delay duration (how long to wait before showing tooltip)
 * <Tooltip
 *   content="Delayed tooltip"
 *   delayDuration={500} // 500ms delay
 *   skipDelayDuration={300} // 300ms delay when moving between tooltips
 * >
 *   <button>Hover me</button>
 * </Tooltip>
 *
 * @example
 * // Set position (side, align, offsets)
 * <Tooltip
 *   content="Positioned tooltip"
 *   side="top" // 'top' | 'right' | 'bottom' | 'left'
 *   align="center" // 'start' | 'center' | 'end'
 *   sideOffset={8} // Distance from trigger (in pixels)
 *   alignOffset={4} // Additional offset for alignment
 * >
 *   <button>Hover me</button>
 * </Tooltip>
 *
 * @example
 * // Set collision boundary and padding
 * <Tooltip
 *   content="Collision-aware tooltip"
 *   side="bottom"
 *   avoidCollisions={true} // Auto-adjust position to avoid collisions
 *   collisionBoundary={[document.body]} // Element(s) to check collisions against
 *   collisionPadding={8} // Padding around collision boundary
 * >
 *   <button>Hover me</button>
 * </Tooltip>
 *
 * @example
 * // Controlled tooltip (programmatic control)
 * <Tooltip
 *   content="Controlled tooltip"
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   defaultOpen={false}
 * >
 *   <button>Click me</button>
 * </Tooltip>
 *
 * @example
 * // Complete example with all positioning options
 * <Tooltip
 *   content="Fully configured tooltip"
 *   delayDuration={300}
 *   skipDelayDuration={0}
 *   side="top"
 *   align="start"
 *   sideOffset={10}
 *   alignOffset={5}
 *   avoidCollisions={true}
 *   collisionBoundary={[document.body]}
 *   collisionPadding={8}
 *   sticky="partial" // 'always' | 'partial'
 *   hideWhenDetached={false}
 * >
 *   <button>Hover me</button>
 * </Tooltip>
 */
export const Tooltip = ({
  children,
  content,
  delayDuration = 0,
  skipDelayDuration,
  side,
  align = 'center',
  sideOffset = 0,
  alignOffset,
  avoidCollisions = true,
  collisionBoundary,
  collisionPadding = 0,
  sticky = 'partial',
  hideWhenDetached,
  className,
  providerProps,
  ...rootProps
}: TooltipProps): React.ReactElement => {
  return (
    <TooltipPrimitive.Provider
      data-slot='tooltip-provider'
      delayDuration={delayDuration}
      {...(skipDelayDuration !== undefined && { skipDelayDuration })}
      {...providerProps}
    >
      <TooltipPrimitive.Root data-slot='tooltip' {...rootProps}>
        <TooltipPrimitive.Trigger asChild data-slot='tooltip-trigger'>
          {children}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            data-slot='tooltip-content'
            {...(side !== undefined && { side })}
            align={align}
            sideOffset={sideOffset}
            {...(alignOffset !== undefined && { alignOffset })}
            avoidCollisions={avoidCollisions}
            {...(collisionBoundary !== undefined && { collisionBoundary })}
            collisionPadding={collisionPadding}
            sticky={sticky}
            {...(hideWhenDetached !== undefined && { hideWhenDetached })}
            className={cn(
              'bg-foreground text-background',
              'animate-in fade-in-0 zoom-in-95',
              'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
              'data-[side=bottom]:slide-in-from-top-2',
              'data-[side=left]:slide-in-from-right-2',
              'data-[side=right]:slide-in-from-left-2',
              'data-[side=top]:slide-in-from-bottom-2',
              'z-[60] w-fit origin-[--radix-tooltip-content-transform-origin]',
              'rounded-md px-3 py-1.5 text-xs text-balance',
              className,
            )}
          >
            {content}
            <TooltipPrimitive.Arrow className='bg-foreground fill-foreground z-[60] size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]' />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
};

Tooltip.displayName = 'Tooltip';

export default Tooltip;
