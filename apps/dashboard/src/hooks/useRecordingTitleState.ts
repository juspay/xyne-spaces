import { useEffect, useState } from 'react';
import {
  getRecordingTitleState,
  isRecordingTitleStateTimed,
  type RecordingTitleInput,
  type RecordingTitleState,
} from '../utils/recordingUtils';

/**
 * Resolves how a recording's title should read, keeping it current as deadlines pass.
 *
 * The state moves on its own — the shimmer times out, and an empty transcript
 * eventually becomes a statement rather than a guess — while a recording whose
 * pipeline stalls produces no row change to ride on. Hence the tick, which only runs
 * for recordings that ended in the last few minutes.
 */
export const useRecordingTitleState = (recording: RecordingTitleInput): RecordingTitleState => {
  const [now, setNow] = useState(() => Date.now());
  const isTimed = isRecordingTitleStateTimed(recording, now);

  useEffect(() => {
    if (!isTimed) return;

    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return (): void => window.clearInterval(interval);
  }, [isTimed]);

  return getRecordingTitleState(recording, now);
};
