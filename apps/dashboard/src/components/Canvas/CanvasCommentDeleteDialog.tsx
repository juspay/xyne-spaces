import Button from '../ui/Button';
import { Dialog } from '../ui/Dialog/Dialog';

interface CanvasCommentDeleteDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function CanvasCommentDeleteDialog({
  open,
  onCancel,
  onConfirm,
}: CanvasCommentDeleteDialogProps): React.JSX.Element {
  return (
    <Dialog
      open={open}
      onOpenChange={nextOpen => {
        if (!nextOpen) onCancel();
      }}
      title='Delete comment?'
      description='This comment will be permanently deleted. This action cannot be undone.'
      zIndexClassName='z-[110]'
      mobileVariant='dialog'
      onEscapeKeyDown={event => event.stopPropagation()}
    >
      <div data-canvas-comment-delete-dialog='true' className='p-6'>
        <h2 className='mb-2 text-[18px] font-semibold text-foreground'>Delete comment?</h2>
        <p className='mb-6 text-[14px] leading-6 text-muted-foreground'>
          This comment will be permanently deleted. This action cannot be undone.
        </p>
        <div className='flex justify-end gap-3'>
          <Button
            variant='secondary'
            onClick={onCancel}
            data-track-category='CANVAS'
            data-track-name='CANCEL_DELETE_COMMENT'
          >
            Cancel
          </Button>
          <Button
            variant='destructive'
            onClick={onConfirm}
            data-track-category='CANVAS'
            data-track-name='CONFIRM_DELETE_COMMENT'
          >
            Delete
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
