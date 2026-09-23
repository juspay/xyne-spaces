import { useEffect } from 'react';
import { toast } from 'sonner';
import { roomActor } from '../../../machines/roomMachine';

interface TranscriptionToggleNotice {
  enabled: boolean;
  byName: string;
  byIdentity?: string;
}

/**
 * "Transcription off … Undo" toast for whoever performed the toggle (host or
 * delegate). Caller passes `isActor`, falling back to a role check if `by` is absent.
 */
export function useTranscriptionHostToast(
  notice: TranscriptionToggleNotice | null,
  isActor: boolean,
): void {
  useEffect(() => {
    if (!notice || !isActor) return;

    if (!notice.enabled) {
      toast('Transcription off', {
        id: 'transcription-host-toast',
        description: 'Everyone in the call was notified. You can add Xyne Automatic back anytime.',
        duration: 8000,
        closeButton: true,
        action: {
          label: 'Undo',
          onClick: () => roomActor.send({ type: 'TOGGLE_TRANSCRIPTION' }),
        },
      });
    } else {
      // Resumed — clear the "off" toast.
      toast.dismiss('transcription-host-toast');
    }
  }, [notice, isActor]);
}
