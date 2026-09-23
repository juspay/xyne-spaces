/**
 * A call's recording sessions, fetched once per call.
 *
 * `call_recordings` lives in the non-synced schema, so unlike everything else the
 * timeline draws this cannot come from Zero.
 */

import { useEffect, useState } from 'react';
import axios from 'axios';
import {
  recordingService,
  type CallRecordingSession,
} from '../../services/Recording/recordingService';
import { logRecordingError } from '../../utils/recordingUtils';

/**
 * @param externalId The call to list recordings for.
 * @param isEnabled Skips the request entirely — a live call has nothing settled to show.
 */
export function useCallRecordingSessions(
  externalId: string | null | undefined,
  isEnabled: boolean,
): CallRecordingSession[] {
  const [sessions, setSessions] = useState<CallRecordingSession[]>([]);

  useEffect(() => {
    if (!externalId || !isEnabled) {
      setSessions([]);
      return;
    }

    const controller = new AbortController();
    void (async (): Promise<void> => {
      try {
        setSessions(await recordingService.listCallRecordings(externalId, controller.signal));
      } catch (err) {
        if (axios.isCancel(err)) return;
        // The bar is worth drawing without its band, so a failure stays quiet.
        logRecordingError('useCallRecordingSessions', err);
        setSessions([]);
      }
    })();

    return (): void => controller.abort();
  }, [externalId, isEnabled]);

  return sessions;
}
