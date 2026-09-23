import { useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { roomActor } from '../../../machines/roomMachine';

/**
 * Toast to everyone but the actor (host or delegate) when transcription is
 * paused/resumed. The actor gets useTranscriptionHostToast's Undo toast instead.
 */
export function useTranscriptionToggleNotice(
  notice: { enabled: boolean; byName: string; byIdentity?: string } | null,
  isActor: boolean,
): void {
  const dismiss = useCallback(() => {
    roomActor.send({ type: 'DISMISS_TRANSCRIPTION_NOTICE' });
  }, []);

  useEffect(() => {
    // The actor gets their own toast (useTranscriptionHostToast) — skip it here.
    if (!notice || isActor) return;

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
  }, [notice, isActor, dismiss]);
}
