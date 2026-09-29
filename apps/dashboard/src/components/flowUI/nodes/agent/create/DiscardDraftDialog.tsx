import type { ReactElement } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';

interface DiscardDraftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Delete the unsaved draft from this browser and leave. */
  onConfirm: () => void;
  /** Leave but keep the draft; it reopens on the next visit to Create Agent. */
  onKeepForLater?: () => void;
}

const DESCRIPTION =
  'This agent isn’t saved yet. Keep the draft in this browser to finish it later, or discard it.';

export function DiscardDraftDialog({
  open,
  onOpenChange,
  onConfirm,
  onKeepForLater,
}: DiscardDraftDialogProps): ReactElement {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title='Leave without saving?'
      description={DESCRIPTION}
      className='max-w-md p-6'
      zIndexClassName='z-[60]'
    >
      <div className='flex flex-col gap-4'>
        <div className='flex flex-col gap-1'>
          <p className='text-base font-medium text-foreground'>Leave without saving?</p>
          <p className='text-sm leading-5 text-muted-foreground'>{DESCRIPTION}</p>
        </div>
        <div className='flex flex-wrap justify-end gap-2'>
          <Button
            variant='ghost'
            type='button'
            onClick={() => onOpenChange(false)}
            className='h-auto rounded-xl px-3 py-2.5 text-[15px]'
            data-track-category='AGENT_ARTIFACT'
            data-track-name='KEEP_EDITING_DRAFT'
          >
            Keep editing
          </Button>
          {onKeepForLater ? (
            <Button
              variant='outline'
              type='button'
              onClick={onKeepForLater}
              className='h-auto rounded-xl px-3 py-2.5 text-[15px]'
              data-track-category='AGENT_ARTIFACT'
              data-track-name='KEEP_DRAFT_FOR_LATER'
            >
              Keep draft
            </Button>
          ) : null}
          <Button
            variant='destructive'
            type='button'
            onClick={onConfirm}
            className='h-auto rounded-xl px-3 py-2.5 text-[15px]'
            data-track-category='AGENT_ARTIFACT'
            data-track-name='CONFIRM_DISCARD_DRAFT'
          >
            Discard draft
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
