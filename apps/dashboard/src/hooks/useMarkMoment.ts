/**
 * Marking a moment during a recording.
 *
 * Shared by the floating note-taker overlay and the live recording detail screen —
 * only one of the two is on screen at a time, but both flag the same session, so the
 * derivation of the timestamps lives here rather than in either component.
 */

import { useCallback } from 'react';
import { toast } from 'sonner';
import { useRecordingStore, sendRecordingEvent } from './useRecordingStore';
import { useZero } from './useZero';
import { calculateRecordingElapsedMs, logRecordingError } from '../utils/recordingUtils';
import { mutators } from '../zero/mutators';

/** Marked moments snapshot the transcript line they sit on; cap it so the JSON stays small. */
const MARKED_MOMENT_TEXT_LIMIT = 500;

export interface UseMarkMomentReturn {
  /** Flag the current point in the recording. No-op when `canMark` is false. */
  markMoment: () => void;
  /** False when this tab isn't running the recording in question — nothing to mark. */
  canMark: boolean;
}

/**
 * @param recordingExternalId Restricts marking to this recording. Callers tied to a
 *   specific recording (the detail screen) must pass it: another recording could be
 *   running in this tab, and marking would otherwise land on the wrong one.
 */
export function useMarkMoment(recordingExternalId?: string): UseMarkMomentReturn {
  const status = useRecordingStore(context => context.status);
  const externalId = useRecordingStore(context => context.externalId);
  const startTime = useRecordingStore(context => context.startTime);
  const pauseStartedAt = useRecordingStore(context => context.pauseStartedAt);
  const accumulatedPausedMs = useRecordingStore(context => context.accumulatedPausedMs);
  const transcripts = useRecordingStore(context => context.transcripts);
  const zero = useZero();

  const canMark =
    Boolean(externalId) &&
    (status === 'recording' || status === 'paused') &&
    (recordingExternalId === undefined || recordingExternalId === externalId);

  const persistMarkedMoment = useCallback(
    async (callId: string, timestampSeconds: number, text: string): Promise<void> => {
      try {
        const result = await zero.mutate(
          mutators.calls.markMoment({
            callId,
            type: 'moment',
            timestampSeconds,
            text: text.slice(0, MARKED_MOMENT_TEXT_LIMIT),
          }),
        ).server;
        if (result.type === 'error') {
          throw new Error(result.error?.message ?? 'Failed to save marked moment');
        }
      } catch (err) {
        logRecordingError('useMarkMoment.persistMarkedMoment', err);
        toast.warning('Moment marked, but it may not be saved with this recording.');
      }
    },
    [zero],
  );

  const markMoment = useCallback((): void => {
    if (!externalId || !canMark) return;

    const firstEntry = transcripts[0];
    const lastEntry = transcripts[transcripts.length - 1];
    const anchor = firstEntry?.spokenAt ?? startTime ?? Date.now();
    const timestampSeconds = Math.max(0, Math.round((Date.now() - anchor) / 1000));
    const elapsedMs = calculateRecordingElapsedMs(startTime, pauseStartedAt, accumulatedPausedMs);

    sendRecordingEvent({
      type: 'markMoment',
      moment: { transcriptId: lastEntry?.id ?? null, timestampSeconds, elapsedMs },
    });

    void persistMarkedMoment(externalId, timestampSeconds, lastEntry?.text ?? '');
  }, [
    accumulatedPausedMs,
    canMark,
    externalId,
    pauseStartedAt,
    persistMarkedMoment,
    startTime,
    transcripts,
  ]);

  return { markMoment, canMark };
}
