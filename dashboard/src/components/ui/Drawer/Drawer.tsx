import React, { ReactNode, RefObject, useEffect } from 'react';
import { Drawer as DrawerPrimitive } from 'vaul';
import { cn } from '../../../utils/classNames';
import { useNativeDrawerBridge } from '../../../hooks/useNativeDrawerBridge';

export interface DrawerProps {
  trigger?: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  focusRef?: RefObject<HTMLElement | null>;
}

/**
 * Drawer Component
 *
 * A flexible drawer component built on Vaul primitives.
 *
 * @example
 * // Simple usage
 * <Drawer trigger={<button>Open</button>}>
 *   <p>Drawer content</p>
 * </Drawer>
 *
 * @example
 * // Controlled
 * <Drawer open={isOpen} onOpenChange={setIsOpen}>
 *   <p>Content</p>
 * </Drawer>
 */
export const Drawer = ({
  trigger,
  children,
  open,
  onOpenChange,
  title,
  description,
  focusRef,
}: DrawerProps): React.ReactElement => {
  useNativeDrawerBridge({ open, onOpenChange });

  useEffect(() => {
    if (focusRef && open) {
      requestAnimationFrame(() => {
        focusRef.current?.focus();
      });
    }
  }, [focusRef, open]);

  return (
    <DrawerPrimitive.Root
      {...(open !== undefined && { open })}
      {...(onOpenChange !== undefined && { onOpenChange })}
      modal={true}
      direction='bottom'
      repositionInputs={false}
    >
      {trigger && <DrawerPrimitive.Trigger asChild>{trigger}</DrawerPrimitive.Trigger>}

      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Overlay
          className={cn('fixed inset-0 bg-black/50 backdrop-blur-sm z-50')}
        />

        <DrawerPrimitive.Content
          className={cn(
            'fixed z-50 flex flex-col',
            'bottom-0 left-0 right-0 max-h-[96%] rounded-t-[20px] ',
            'bg-background',
            'focus:outline-none',
          )}
        >
          {/* Drag handle */}
          <div className='mx-auto mt-4 h-2 w-[100px] rounded-full bg-muted-foreground/30' />

          <div className='overflow-auto flex-1'>
            {/* Hidden title and description for accessibility */}
            {title && <DrawerPrimitive.Title className='hidden'>{title}</DrawerPrimitive.Title>}
            {description && (
              <DrawerPrimitive.Description className='hidden'>
                {description}
              </DrawerPrimitive.Description>
            )}

            {/* Content */}
            <div className={cn('')}>{children}</div>
          </div>
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  );
};

Drawer.displayName = 'Drawer';
