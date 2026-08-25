import type { ReactElement } from 'react';
import { MicOn, MultipleCrossCancelDefault } from '@xyne/icons';
import { Button } from '../../../components/ui/Button/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { formatRecordingDuration } from '../../../utils/recordingUtils';
import type { RecordingsV2PillRecording } from './RecordingsV2Pill';

export interface RecordingDeleteDialogProps {
  recording: RecordingsV2PillRecording | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export const RecordingDeleteDialog = ({
  recording,
  onOpenChange,
  onConfirm,
}: RecordingDeleteDialogProps): ReactElement => {
  const title = recording?.title?.trim() || 'Untitled recording';
  const durationMs =
    typeof recording?.endedAt === 'number'
      ? Math.max(0, recording.endedAt - recording.startedAt)
      : null;

  return (
    <Dialog
      open={!!recording}
      onOpenChange={onOpenChange}
      title='Delete recording'
      description={`${title}: everything in this recording will be permanently removed.`}
      className='max-w-md overflow-hidden rounded-xl p-0'
      testId='recordings-v2-delete-dialog'
    >
      <div className='flex items-center gap-2.5 border-b border-border py-3 pl-4 pr-3'>
        <span className='min-w-0 flex-1 truncate text-sm font-semibold text-foreground'>
          Delete recording
        </span>
        <button
          type='button'
          onClick={() => onOpenChange(false)}
          aria-label='Close'
          className='flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
          data-track-category='RecordingsV2'
          data-track-name='close_delete_recording_dialog'
        >
          <MultipleCrossCancelDefault size={14} />
        </button>
      </div>

      <div className='flex flex-col gap-3 p-4'>
        <div className='flex items-center gap-2 rounded-lg border border-border bg-muted px-2.5 py-2'>
          <MicOn size={13} className='shrink-0 text-muted-foreground' />
          <span className='min-w-0 flex-1 truncate text-xs font-semibold text-foreground'>
            {title}
          </span>
          <span className='shrink-0 text-xs font-medium tabular-nums text-muted-foreground'>
            {formatRecordingDuration(durationMs)}
          </span>
        </div>

        <p className='text-pretty text-xs leading-normal text-muted-foreground'>
          Everything in this recording will be permanently removed. This can’t be undone.
        </p>
      </div>

      <div className='flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-3.5 py-3'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() => onOpenChange(false)}
          data-track-category='RecordingsV2'
          data-track-name='cancel_delete_recording'
        >
          Cancel
        </Button>
        <Button
          type='button'
          variant='destructive'
          size='sm'
          onClick={onConfirm}
          data-track-category='RecordingsV2'
          data-track-name='confirm_delete_recording'
        >
          Delete
        </Button>
      </div>
    </Dialog>
  );
};

export default RecordingDeleteDialog;
