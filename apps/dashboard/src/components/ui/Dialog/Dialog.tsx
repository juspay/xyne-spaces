import React, { ReactNode, RefObject, useState, useEffect, useSyncExternalStore } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import Drawer from '../Drawer';
import { cn } from '../../../utils/classNames';
import { useOverlayEffect } from '../../../machines/stateMachine';
import { useScope } from '../../../shortcuts';

// Surfaces raised above dialogs: Ask AI in voice mode, which the user keeps talking to while a
// dialog is open. A modal dialog would lock their scrolling and trap the focus that Space-to-talk
// needs, so while one is up a dialog opens non-modal, looking and closing just the same.
let raisedSurfaces = 0;
const raisedListeners = new Set<() => void>();
const subscribeRaised = (listener: () => void): (() => void) => {
  raisedListeners.add(listener);
  return (): void => {
    raisedListeners.delete(listener);
  };
};
const changeRaised = (by: number): void => {
  raisedSurfaces += by;
  raisedListeners.forEach(listener => listener());
};
// A click, focus or Escape there belongs to that surface, not to the dialog under it.
const isInRaised = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest('[data-above-dialogs]') !== null;

/** While `active`, the caller is a surface marked `data-above-dialogs`, so dialogs open non-modal. */
export function useRaiseAboveDialogs(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    changeRaised(1);
    return (): void => changeRaised(-1);
  }, [active]);
}

const OVERLAY_CLASS_NAME = cn(
  'fixed inset-0 bg-black/50 backdrop-blur-sm',
  'data-[state=open]:animate-in data-[state=closed]:animate-out',
  'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
);

export interface DialogProps {
  trigger?: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  className?: string;
  /**
   * Tailwind z-index class for the overlay + content. Defaults to `z-50`. Raise
   * it (e.g. `z-[10000]`) when the dialog is opened from inside a higher-z
   * surface such as the Cmd+K dialog (`z-[9999]`).
   */
  zIndexClassName?: string;
  focusRef?: RefObject<HTMLElement | null>;
  /**
   * Escape hatch for the dialog's open auto-focus. When provided it takes
   * precedence over `focusRef` — e.g. pass `(e) => e.preventDefault()` to stop
   * the dialog stealing focus so a child can manage focus on its own schedule.
   */
  onOpenAutoFocus?: (e: Event) => void;
  onEscapeKeyDown?: React.ComponentPropsWithoutRef<
    typeof DialogPrimitive.Content
  >['onEscapeKeyDown'];
  onPointerDownOutside?: React.ComponentPropsWithoutRef<
    typeof DialogPrimitive.Content
  >['onPointerDownOutside'];
  onInteractOutside?: React.ComponentPropsWithoutRef<
    typeof DialogPrimitive.Content
  >['onInteractOutside'];
  testId?: string;
  /** Keep the Radix modal on small screens instead of switching to the default drawer. */
  mobileVariant?: 'drawer' | 'dialog';
}

/**
 * Dialog Component
 *
 * A flexible dialog component built on Radix UI Dialog primitives.
 *
 * @example
 * // Simple usage
 * <Dialog trigger={<button>Open</button>}>
 *   <p>Dialog content</p>
 * </Dialog>
 *
 * @example
 * // Controlled
 * <Dialog open={isOpen} onOpenChange={setIsOpen}>
 *   <p>Content</p>
 * </Dialog>
 */
export const Dialog = ({
  trigger,
  children,
  open,
  onOpenChange,
  title,
  description,
  className,
  zIndexClassName = 'z-50',
  focusRef,
  onOpenAutoFocus,
  onEscapeKeyDown,
  onPointerDownOutside,
  onInteractOutside,
  testId,
  mobileVariant = 'drawer',
}: DialogProps): React.ReactElement => {
  const [isMobile, setIsMobile] = useState(false);
  useOverlayEffect(open ?? false);
  // Claims the keyboard for as long as the dialog is up, so shortcuts belonging
  // to the page behind it stay out of the way.
  useScope('modal', open ?? false);
  // Settled while the dialog is closed, since switching an open one would remount its content. One
  // the page does not control stays modal: when it opens is not known here.
  const raised = useSyncExternalStore(subscribeRaised, () => raisedSurfaces > 0);
  const wantsModal = !(raised && open !== undefined);
  const [modal, setModal] = useState(wantsModal);
  if (!open && modal !== wantsModal) setModal(wantsModal);

  // Detect screen size changes
  useEffect(() => {
    const checkMobile = (): void => {
      setIsMobile(window.innerWidth < 600);
    };

    // Initial check
    checkMobile();

    // Add listener for window resize
    window.addEventListener('resize', checkMobile);

    // Cleanup
    return (): void => window.removeEventListener('resize', checkMobile);
  }, []);

  // Use Drawer for mobile screens
  if (isMobile && mobileVariant === 'drawer') {
    return (
      <Drawer
        {...(trigger !== undefined && { trigger })}
        {...(open !== undefined && { open })}
        {...(onOpenChange !== undefined && { onOpenChange })}
      >
        {children}
      </Drawer>
    );
  }

  // Use Dialog for desktop screens
  return (
    <DialogPrimitive.Root
      {...(open !== undefined && { open })}
      {...(onOpenChange !== undefined && { onOpenChange })}
      modal={modal}
    >
      {trigger && <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>}

      <DialogPrimitive.Portal>
        {modal ? (
          <DialogPrimitive.Overlay className={cn(OVERLAY_CLASS_NAME, zIndexClassName)} />
        ) : (
          // Radix draws none for a non-modal dialog. A click on this one is outside the dialog,
          // which closes it as the modal overlay does.
          <div
            data-state={open ? 'open' : 'closed'}
            className={cn(OVERLAY_CLASS_NAME, zIndexClassName)}
          />
        )}

        <DialogPrimitive.Content
          {...(onOpenAutoFocus
            ? { onOpenAutoFocus }
            : focusRef !== undefined && {
                onOpenAutoFocus: (event: Event) => {
                  event.preventDefault();
                  if (focusRef.current) {
                    focusRef.current.focus();
                  } else {
                    // focusRef may not be populated yet (e.g. child assigns it in a
                    // ref callback that hasn't fired). Retry after the next paint.
                    requestAnimationFrame(() => {
                      focusRef.current?.focus();
                    });
                  }
                },
              })}
          onInteractOutside={event => {
            const target = (event.detail?.originalEvent?.target ?? null) as Element | null;
            // A toast, or a surface raised above dialogs (Ask AI in voice mode), is not outside.
            if (
              isInRaised(target) ||
              target?.closest?.('[data-sonner-toast], [data-sonner-toaster]')
            ) {
              event.preventDefault();
              return;
            }
            onInteractOutside?.(event);
          }}
          onEscapeKeyDown={event => {
            if (isInRaised(event.target)) {
              event.preventDefault();
              return;
            }
            onEscapeKeyDown?.(event);
          }}
          {...(onPointerDownOutside && { onPointerDownOutside })}
          data-testid={testId ?? 'dialog-content'}
          className={cn(
            'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
            'w-full',
            'max-w-md',
            'bg-popover text-popover-foreground rounded-lg shadow-lg',
            'outline-none focus:outline-none',
            zIndexClassName,
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]',
            'data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]',
            'duration-200',
            className,
          )}
        >
          {/* Hidden title and description for accessibility */}
          {title && <DialogPrimitive.Title className='hidden'>{title}</DialogPrimitive.Title>}
          {description && (
            <DialogPrimitive.Description className='hidden'>
              {description}
            </DialogPrimitive.Description>
          )}

          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

Dialog.displayName = 'Dialog';

export default Dialog;
