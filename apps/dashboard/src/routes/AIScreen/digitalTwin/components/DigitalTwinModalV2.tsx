import { ReactElement, ReactNode } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { cn } from '@/utils/classNames';

/**
 * Shared modal shell for the Digital Twin dialogs. Wraps the base `Dialog`
 * primitive (whose title/description are a11y-only) with a visible header,
 * scrollable body, and optional footer — the shape the reference app's
 * `Dialog` gave for free.
 */
export const DigitalTwinModal = ({
  open,
  onClose,
  title,
  description,
  footer,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}): ReactElement => (
  <Dialog
    open={open}
    onOpenChange={next => {
      if (!next) onClose();
    }}
    title={title}
    className={cn('max-w-lg', className)}
  >
    <div className='flex max-h-[85vh] flex-col gap-4 overflow-y-auto p-6'>
      <div className='flex flex-col gap-1'>
        <h2 className='text-base font-semibold text-foreground'>{title}</h2>
        {description && <p className='text-sm text-muted-foreground'>{description}</p>}
      </div>
      {children}
      {footer && <div className='flex items-center justify-end gap-2 pt-1'>{footer}</div>}
    </div>
  </Dialog>
);
