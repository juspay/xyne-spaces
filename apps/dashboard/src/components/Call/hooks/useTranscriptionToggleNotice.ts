import { useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { roomActor } from '../../../machines/roomMachine';

/**
 * Surfaces a toast to every participant when the host pauses/resumes the
 * transcription agent mid-call. The host who performed the action does not get
 * the toast (LiveKit does not echo published data to the sender), they see the
 * banner + tile change directly.
 */
export function useTranscriptionToggleNotice(
  notice: { enabled: boolean; byName: string } | null,
): void {
  const dismiss = useCallback(() => {
    roomActor.send({ type: 'DISMISS_TRANSCRIPTION_NOTICE' });
  }, []);

  useEffect(() => {
    if (!notice) return;

    if (notice.enabled) {
      toast.info('Transcription resumed', {
        id: 'transcription-toggle-notice',
        description: `${notice.byName} turned transcription back on for this call.`,
        duration: 6000,
        closeButton: true,
        onDismiss: dismiss,
        onAutoClose: dismiss,
      });
    } else {
      toast.warning('Transcription turned off', {
        id: 'transcription-toggle-notice',
        description: `${notice.byName} turned off transcription — nothing said from here on is captured.`,
        duration: 8000,
        closeButton: true,
        onDismiss: dismiss,
        onAutoClose: dismiss,
      });
    }
  }, [notice, dismiss]);
}
