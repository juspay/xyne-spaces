import { useEffect } from 'react';
import { toast } from 'sonner';
import { roomActor } from '../../../machines/roomMachine';

const CONFIRM_TIMEOUT_MS = 6000;

/**
 * While a transcription toggle is in-flight (awaiting the agent's authoritative
 * `transcription_state` confirmation), fail safe: if no confirmation arrives within
 * the timeout, clear the pending flag and surface an error. The privacy state is
 * never optimistically flipped, so on failure the UI simply keeps the last confirmed
 * state — it can never show "off" while the agent is still capturing.
 */
export function useTranscriptionPendingTimeout(pending: boolean): void {
  useEffect(() => {
    if (!pending) return;
    const id = setTimeout(() => {
      toast.error('Could not reach Xyne Automatic. Please try again.', {
        id: 'transcription-timeout',
      });
      roomActor.send({ type: 'TRANSCRIPTION_TIMEOUT' });
    }, CONFIRM_TIMEOUT_MS);
    return (): void => clearTimeout(id);
  }, [pending]);
}
