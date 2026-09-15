import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { roomActor } from '../../../machines/roomMachine';

/**
 * Host-only confirmation toast shown when they stop transcription, with an Undo
 * action to bring the agent back (see the "Transcription off … Undo" design).
 * Fires on the local on -> off transition, only for the host.
 */
export function useTranscriptionHostToast(isTranscriptionEnabled: boolean, isHost: boolean): void {
  const prevEnabled = useRef(isTranscriptionEnabled);

  useEffect(() => {
    const was = prevEnabled.current;
    prevEnabled.current = isTranscriptionEnabled;
    if (!isHost) return;

    if (was && !isTranscriptionEnabled) {
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
    } else if (!was && isTranscriptionEnabled) {
      // Resumed — clear the "off" toast.
      toast.dismiss('transcription-host-toast');
    }
  }, [isTranscriptionEnabled, isHost]);
}
