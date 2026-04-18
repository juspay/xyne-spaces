import { useSyncExternalStore } from 'react';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import type { RecordingState, TranscriptEntry } from '../stores/recordingStore';
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
import { recordingStore as _rawStore } from '../stores/recordingStore';

interface RecordingStoreSnapshot {
  status: 'active' | 'done' | 'error' | 'stopped';
  context: RecordingState;
  output: undefined;
  error: undefined;
}

export type RecordingStoreEvent =
  | { type: 'requestAutoStart' }
  | { type: 'requestStop' }
  | { type: 'startRecording'; sttModel?: 'google' | 'azure' | 'deepgram' }
  | {
      type: 'recordingStarted';
      room: unknown;
      externalId: string;
      channelId: string;
      startTime: number;
    }
  | { type: 'pauseRecording' }
  | { type: 'resumeRecording' }
  | { type: 'stopRecording' }
  | { type: 'setStatus'; status: RecordingState['status'] }
  | { type: 'error'; error: string }
  | { type: 'reset' }
  | { type: 'addTranscript'; entry: RecordingState['transcripts'][number] }
  | { type: 'clearTranscripts' };

interface TypedRecordingStore {
  subscribe: (cb: () => void) => { unsubscribe: () => void };
  getSnapshot: () => RecordingStoreSnapshot;
  send: (event: RecordingStoreEvent) => void;
}

const store = _rawStore as unknown as TypedRecordingStore;

export function useRecordingStore<T>(selector: (ctx: RecordingState) => T): T {
  return useSyncExternalStore(
    (cb): (() => void) => {
      const sub = store.subscribe(cb);
      return (): void => {
        sub.unsubscribe();
      };
    },
    (): T => selector(store.getSnapshot().context),
  );
}

export function sendRecordingEvent(event: RecordingStoreEvent): void {
  store.send(event);
}

export interface UseTranscriptStreamReturn {
  transcripts: TranscriptEntry[];
}

export function useTranscriptStream(): UseTranscriptStreamReturn {
  const transcripts = useRecordingStore(ctx => ctx.transcripts);
  return { transcripts };
}
