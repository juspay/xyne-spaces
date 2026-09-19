import type { ReactElement } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';

interface DiscardDraftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function DiscardDraftDialog({
  open,
  onOpenChange,
  onConfirm,
}: DiscardDraftDialogProps): ReactElement {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title='Discard this draft?'
      description='The conversation stays.'
      className='max-w-md p-6'
      zIndexClassName='z-[60]'
    >
      <div className='flex flex-col gap-4'>
        <div className='flex flex-col gap-1'>
          <p className='text-base font-medium text-xyne-fg-primary'>Discard this draft?</p>
          <p className='text-sm leading-5 text-xyne-fg-muted'>The conversation stays.</p>
        </div>
        <div className='flex justify-end gap-2'>
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
