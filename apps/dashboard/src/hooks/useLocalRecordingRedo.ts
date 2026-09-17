import { useCallback, useEffect, useState } from 'react';
import { selectRecordingArchiveStore } from '../services/Recording/archive';
import {
  ManualRedoError,
  offlineRecordingService,
} from '../services/Recording/offlineRecordingService';

// Post-call escape hatch for the outages no automatic signal caught: the owner can
// re-transcribe a call from the recording.webm saved on this device. Once per call.

/**
 * `unknown`: the picked-folder backend cannot be read until the user re-grants
 * permission (only possible inside a click), so the file may or may not be there.
 */
export type LocalRedoAvailability = 'none' | 'unknown' | 'available';
export type LocalRedoState = 'idle' | 'uploading' | 'processing';

interface UseLocalRecordingRedoOptions {
  isOwner: boolean;
  isLive: boolean;
  alreadyRedone: boolean;
}

interface UseLocalRecordingRedoResult {
  availability: LocalRedoAvailability;
  state: LocalRedoState;
  /** Resolves once the redo landed; rejects with a user-presentable message. */
  trigger: () => Promise<void>;
}

export function useLocalRecordingRedo(
  callId: string | null | undefined,
  { isOwner, isLive, alreadyRedone }: UseLocalRecordingRedoOptions,
): UseLocalRecordingRedoResult {
  const [availability, setAvailability] = useState<LocalRedoAvailability>('none');
  const [state, setState] = useState<LocalRedoState>('idle');
  const eligible = Boolean(callId) && isOwner && !isLive && !alreadyRedone;

  useEffect(() => {
    setAvailability('none');
    if (!callId || !eligible) return;
    const store = selectRecordingArchiveStore();
    // OPFS is browser-private scratch space that is cleaned up after the call.
    if (!store || store.kind === 'opfs') return;
    let cancelled = false;
    void offlineRecordingService
      .findLocalCapture(callId)
      .then(capture => {
        if (cancelled) return;
        if (capture) setAvailability('available');
        else if (store.kind === 'fsa') setAvailability('unknown');
      })
      .catch(() => undefined);
    return (): void => {
      cancelled = true;
    };
  }, [callId, eligible]);

  const trigger = useCallback(async (): Promise<void> => {
    if (!callId) return;
    setState('uploading');
    try {
      await offlineRecordingService.requestManualRedo(callId, () => setState('processing'));
    } catch (error) {
      if (error instanceof ManualRedoError && error.code === 'no_local_recording') {
        setAvailability('none');
      }
      throw error;
    } finally {
      setState('idle');
    }
  }, [callId]);

  return { availability, state, trigger };
}
