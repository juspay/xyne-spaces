/**
 * Flagging a moment during a live call.
 *
 * The offset is measured from the call's start, which is what the timeline counts
 * from.
 */

import { useCallback } from 'react';
import { toast } from 'sonner';
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
 * @param callStartedAtMs The call's own start, epoch ms. Not the viewer's join time —
 *   a rejoin would reset that and drop the flag back at zero.
 * @param isAllowed The mutator accepts the call's creator only, so the button is
 *   hidden rather than left to fail for everyone else.
 */
export function useCallMarkMoment(
  externalId: string | null,
  callStartedAtMs: number | null,
  isAllowed: boolean,
): UseCallMarkMomentReturn {
  const zero = useZero();

  const canMark = Boolean(externalId) && isAllowed;

  const markMoment = useCallback((): void => {
    if (!externalId || !canMark) return;

    // No known start means nothing to measure against.
    const timestampSeconds = callStartedAtMs
      ? Math.max(0, Math.round((Date.now() - callStartedAtMs) / 1000))
      : 0;

    void (async (): Promise<void> => {
      try {
        const result = await zero.mutate(
          mutators.calls.markMoment({
            callId: externalId,
            type: 'moment',
            timestampSeconds,
            text: '',
          }),
        ).server;
        if (result.type === 'error') {
          throw new Error(result.error?.message ?? 'Failed to save marked moment');
        }
        // Nothing on screen changes, so the toast is the only receipt.
        toast.success('Moment marked');
      } catch (err) {
        logRecordingError('useCallMarkMoment.markMoment', err);
        toast.error('Could not mark this moment');
      }
    })();
  }, [callStartedAtMs, canMark, externalId, zero]);

  return { markMoment, canMark };
}
