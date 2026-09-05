/**
 * Flagging a moment during a live call.
 *
 * The Scribe overlay measures its offset against the transcript it already holds.
 * A LiveKit call has no client-side transcript — transcription runs in the
 * server-side agent — so this sends wall-clock epoch seconds instead, and
 * transcriptService.rebasePendingMarkedMoments moves the moment onto the
 * transcript's clock once the call ends. `timestampSeconds` is provisional,
 * standing in only for a call that never produces a transcript.
 */

import { useCallback } from 'react';
import { useSelector } from '@xstate/react';
import { toast } from 'sonner';
import { roomActor } from '../../../machines/roomMachine';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { logRecordingError } from '../../../utils/recordingUtils';

export interface UseCallMarkMomentReturn {
  /** Flag the current point in the call. No-op when `canMark` is false. */
  markMoment: () => void;
  /** False when there is no live call, or the viewer may not mark this one. */
  canMark: boolean;
}

/**
 * @param externalId The live call to mark against.
 * @param isAllowed Whether this viewer may mark. The `calls.markMoment` mutator
 *   accepts the call's creator only, so the button is hidden rather than left to
 *   fail for everyone else.
 */
export function useCallMarkMoment(
  externalId: string | null,
  isAllowed: boolean,
): UseCallMarkMomentReturn {
  const callStartTime = useSelector(roomActor, state => state.context.callStartTime);
  const zero = useZero();

  const canMark = Boolean(externalId) && isAllowed;

  const markMoment = useCallback((): void => {
    if (!externalId || !canMark) return;

    const now = Date.now();
    // Provisional only — the server rebases this against the transcript's first
    // line. Without a known start there is nothing to measure, so it starts at 0.
    const timestampSeconds = callStartTime
      ? Math.max(0, Math.round((now - callStartTime) / 1000))
      : 0;

    void (async (): Promise<void> => {
      try {
        const result = await zero.mutate(
          mutators.calls.markMoment({
            callId: externalId,
            type: 'moment',
            timestampSeconds,
            text: '',
            markedAtEpochSeconds: Math.round(now / 1000),
          }),
        ).server;
        if (result.type === 'error') {
          throw new Error(result.error?.message ?? 'Failed to save marked moment');
        }
        // Nothing on screen changes — unlike the Scribe overlay, which drops a
        // divider into its live transcript — so the toast is the only receipt.
        toast.success('Moment marked');
      } catch (err) {
        logRecordingError('useCallMarkMoment.markMoment', err);
        toast.error('Could not mark this moment');
      }
    })();
  }, [callStartTime, canMark, externalId, zero]);

  return { markMoment, canMark };
}
