// ---------------------------------------------------------------------------
// useRecordingStore
// React hook interface for the recording store.
// ---------------------------------------------------------------------------

import { useSyncExternalStore } from 'react';
import {
  getRecordingState,
  subscribeRecordingStore,
  sendRecordingAction,
  type RecordingState,
  type RecordingStoreAction,
} from '@/src/stores/recordingStore';
import type { TranscriptEntry } from '@/src/types/recordings';

/**
 * Subscribe to a slice of recording state.
 *
 * @example
 * const status = useRecordingStore(s => s.status);
 */
export function useRecordingStore<T>(selector: (state: RecordingState) => T): T {
  return useSyncExternalStore(subscribeRecordingStore, () => selector(getRecordingState()));
}

/**
 * Dispatch an action to the recording store.
 * Re-exported here so consumers only need one import.
 */
export { sendRecordingAction };
export type { RecordingStoreAction };

// ---------------------------------------------------------------------------
// Convenience hooks
// ---------------------------------------------------------------------------

export interface UseTranscriptStreamReturn {
  transcripts: TranscriptEntry[];
}

/**
 * Subscribe to the live transcript stream.
 * Only re-renders when transcripts change.
 */
export function useTranscriptStream(): UseTranscriptStreamReturn {
  const transcripts = useRecordingStore(s => s.transcripts);
  return { transcripts };
}
