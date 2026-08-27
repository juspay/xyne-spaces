import { ReactElement, ReactNode } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive. */
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
}

/**
 * Minimal confirm dialog for the claw-agents surface, built on the shared
 * `Dialog` primitive (whose `title`/`description` are a11y-only, so the visible
 * copy is rendered in the body here).
 */
export const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  loading = false,
  onConfirm,
}: ConfirmDialogProps): ReactElement => (
  <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
    <div className='flex flex-col gap-4 p-6'>
      <div className='flex flex-col gap-1.5'>
        <h2 className='text-base font-semibold text-foreground'>{title}</h2>
        {description && <p className='text-sm text-muted-foreground'>{description}</p>}
      </div>
      <div className='flex justify-end gap-2'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() => onOpenChange(false)}
          data-track-category='Claw Agents'
          data-track-name='CANCEL_CONFIRM_DIALOG'
          disabled={loading}
        >
          {cancelLabel}
        </Button>
        <Button
          type='button'
          variant={danger ? 'destructive' : 'default'}
          size='sm'
          loading={loading}
          onClick={onConfirm}
          data-track-category='Claw Agents'
          data-track-name='CONFIRM_DIALOG_ACTION'
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  </Dialog>
);
