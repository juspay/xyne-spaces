import { useSyncExternalStore } from 'react';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import type { RecordingLayout, RecordingState, TranscriptEntry } from '../stores/recordingStore';
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
import { recordingStore as _rawStore } from '../stores/recordingStore';
import { calculateRecordingElapsedMs } from '../utils/recordingUtils';
import { formatDuration } from '../utils/dateUtils';
import { setWorkspaceSwitchToast } from '../utils/workspaceSwitchToast';

interface RecordingStoreSnapshot {
  status: 'active' | 'done' | 'error' | 'stopped';
  context: RecordingState;
  output: undefined;
  error: undefined;
}

export type RecordingStoreEvent =
  | { type: 'requestAutoStart'; conversationId?: string; channelId?: string }
  | { type: 'clearAutoStart' }
  | { type: 'requestStop' }
  | {
      type: 'startRecording';
      sttModel?: 'google' | 'azure' | 'deepgram';
      defaultLayout?: RecordingLayout;
      conversationId?: string;
      channelId?: string;
    }
  | {
      type: 'recordingStarted';
      room: unknown;
      externalId: string;
      channelId: string | null;
      notesCanvasId: string;
      startTime: number;
      defaultLayout?: RecordingLayout;
    }
  | { type: 'pauseRecording' }
  | { type: 'resumeRecording' }
  | { type: 'stopRecording'; silent?: boolean }
  | { type: 'setStatus'; status: RecordingState['status'] }
  | { type: 'error'; error: string }
  | { type: 'reset' }
  | { type: 'addTranscript'; entry: RecordingState['transcripts'][number] }
  | { type: 'clearTranscripts' }
  | { type: 'markMoment'; moment: RecordingState['markedMoments'][number] }
  | { type: 'setNotesCanvas'; canvasId: string; title?: string }
  | { type: 'setNotesCanvasTitle'; title: string }
  | { type: 'setTitle'; title: string }
  | { type: 'setActiveLayout'; layout: RecordingLayout }
  | { type: 'setTranscriptMinimized'; isMinimized: boolean }
  | { type: 'agentLeftUnexpectedly' };

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

/** Read the current recording status imperatively (e.g. inside an event handler) without subscribing. */
export function getRecordingStatus(): RecordingState['status'] {
  return store.getSnapshot().context.status;
}

/**
 * Stop whatever is in flight because the page or the machine is going away.
 * `silent` skips the "Recording stopped" toast for a caller that is about to
 * navigate away and will show its own toast once the destination page mounts —
 * the default toast would just be torn down mid-display by that navigation.
 */
export function stopRecordingForTeardown(options?: { silent?: boolean }): void {
  const status = getRecordingStatus();
  if (status === 'starting') {
    sendRecordingEvent({ type: 'requestStop' });
  } else if (status === 'recording' || status === 'paused') {
    sendRecordingEvent({ type: 'stopRecording', ...(options?.silent ? { silent: true } : {}) });
  }
}

/**
 * Stop for a caller that is about to perform a same-origin hard navigation
 * (workspace switch, reload). The normal "Recording stopped" toast would be
 * torn down mid-display by that navigation, so it's stashed instead and shown
 * once the destination page mounts (see `WorkspaceSwitchToastListener`).
 */
export function stopRecordingForNavigation(): void {
  const { status, startTime, pauseStartedAt, accumulatedPausedMs } = store.getSnapshot().context;

  // Still connecting — no room/duration to report yet. Fall back to the
  // existing requestStop path; its own (non-silent) toast fires once the
  // pending start resolves, same as before this helper existed.
  if (status === 'starting') {
    stopRecordingForTeardown();
    return;
  }
  if (status !== 'recording' && status !== 'paused') return;

  const durationMs = startTime
    ? calculateRecordingElapsedMs(startTime, pauseStartedAt, accumulatedPausedMs)
    : null;
  setWorkspaceSwitchToast({
    title: 'Recording stopped',
    description: `Recording saved (${durationMs ? formatDuration(durationMs) : 'Unknown duration'})`,
  });
  stopRecordingForTeardown({ silent: true });
}

export interface UseTranscriptStreamReturn {
  transcripts: TranscriptEntry[];
}

export function useTranscriptStream(): UseTranscriptStreamReturn {
  const transcripts = useRecordingStore(ctx => ctx.transcripts);
  return { transcripts };
}
