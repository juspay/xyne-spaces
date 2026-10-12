import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { refreshOatsRecordings } from './usePaginatedOatsRecordings';
import { getRecordingContext, sendRecordingEvent } from './useRecordingStore';
import { recordingService } from '../services/Recording/recordingService';
import {
  calculateRecordingElapsedMs,
  logRecordingError,
  NO_TRANSCRIPT_RECORDING_TITLE,
} from '../utils/recordingUtils';

/** Stops the live recording action */
export function useStopRecording(): () => void {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  return useCallback((): void => {
    const { startTime, pauseStartedAt, accumulatedPausedMs, externalId, title, transcripts } =
      getRecordingContext();
    const isViewingThisRecording =
      Boolean(externalId) && pathname.replace(/\/+$/, '').endsWith(`/recordings/${externalId}`);
    const stoppedRecordingId = externalId;
    const capturedNothing = transcripts.length === 0;
    const alreadyTitled = Boolean(title?.trim());
    const durationMs = calculateRecordingElapsedMs(startTime, pauseStartedAt, accumulatedPausedMs);
    const endedAtMs = Date.now();

    sendRecordingEvent({ type: 'stopRecording' });

    // The recording just transitioned to ENDED — land the user on its detail
    if (stoppedRecordingId && !isViewingThisRecording) {
      void navigate(`/recordings/${stoppedRecordingId}`, {
        state: { justStopped: true, durationMs, endedAtMs, hasTranscript: !capturedNothing },
      });
    }

    if (!stoppedRecordingId || alreadyTitled || !capturedNothing) {
      refreshOatsRecordings();
      return;
    }

    void recordingService
      .updateRecordingTitle(stoppedRecordingId, NO_TRANSCRIPT_RECORDING_TITLE)
      .catch(err => logRecordingError('useStopRecording.titleUntranscribed', err))
      .finally(refreshOatsRecordings);
  }, [pathname, navigate]);
}
