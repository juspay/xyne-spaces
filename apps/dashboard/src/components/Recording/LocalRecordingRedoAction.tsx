import { useState, type ReactElement } from 'react';
import { toast } from 'sonner';
import { useLocalRecordingRedo } from '../../hooks/useLocalRecordingRedo';
import { ManualRedoError } from '../../services/Recording/offlineRecordingService';
import { Button } from '../ui/Button/Button';
import { Dialog } from '../ui/Dialog';

interface LocalRecordingRedoActionProps {
  callId: string;
  isOwner: boolean;
  isLive: boolean;
  alreadyRedone: boolean;
  trackCategory: string;
}

/**
 * Owner-only prompt on the recording detail screen: rebuild the transcript and
 * summary from the recording saved on this device. Renders nothing when this
 * device holds no local file for the call.
 */
export function LocalRecordingRedoAction({
  callId,
  isOwner,
  isLive,
  alreadyRedone,
  trackCategory,
}: LocalRecordingRedoActionProps): ReactElement | null {
  const { availability, state, trigger } = useLocalRecordingRedo(callId, {
    isOwner,
    isLive,
    alreadyRedone,
  });
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (availability === 'none' && state === 'idle') return null;

  const busy = state !== 'idle';
  const handleConfirm = (): void => {
    setConfirmOpen(false);
    void trigger()
      .then(() => toast.success('Transcript rebuilt from your local recording'))
      .catch((error: unknown) => {
        toast.error(
          error instanceof ManualRedoError
            ? error.message
            : 'Could not re-transcribe the local recording',
          { description: 'Your local recording is untouched. You can try again.' },
        );
      });
  };

  return (
    <div className='mt-5 flex flex-wrap items-center justify-between gap-2.5 border-t border-border pt-3'>
      <span className='text-xs text-muted-foreground'>
        Transcript or summary missing or incomplete? Rebuild it from the recording saved on this
        device.
      </span>
      <Button
        variant='outline'
        size='sm'
        loading={busy}
        disabled={busy}
        onClick={() => setConfirmOpen(true)}
        data-track-category={trackCategory}
        data-track-name='local_redo_open_confirm'
      >
        {state === 'uploading'
          ? 'Uploading recording…'
          : state === 'processing'
            ? 'Re-transcribing…'
            : 'Re-transcribe from local recording'}
      </Button>
      <Dialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title='Re-transcribe from local recording?'
        description='This replaces the current transcript and summary with new ones built from the recording saved on this device. It can only be done once for this recording.'
        testId='local-recording-redo-dialog'
      >
        <div className='flex justify-end gap-2 pt-2'>
          <Button variant='ghost' size='sm' onClick={() => setConfirmOpen(false)}>
            Cancel
          </Button>
          <Button
            size='sm'
            onClick={handleConfirm}
            data-track-category={trackCategory}
            data-track-name='local_redo_confirm'
          >
            Re-transcribe
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
