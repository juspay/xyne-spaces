// ---------------------------------------------------------------------------
// Recording Store
// Module-level state store for the active recording session.
// Uses the same subscription pattern as @xstate/store but without the
// extra dependency — a plain subscriber set + useSyncExternalStore.
//
// Ported from dashboard/src/stores/recordingStore.ts, adapted for
// React Native / livekit-client (requires ensureLiveKitGlobals() call first).
// ---------------------------------------------------------------------------

import { Room, RoomEvent, type DataPacket_Kind } from 'livekit-client';
import { AudioSession } from '@livekit/react-native';
import { AppState, Platform } from 'react-native';
import { ensureLiveKitGlobals } from '@/src/services/LiveKitBootstrap';
import { recordingService } from '@/src/services/recordingService';
import { voipForegroundServiceModule } from '@/src/services/VoIPForegroundServiceModule';
import { callRuntimeNativeService } from '@/src/services/CallRuntimeNativeService';
import { recordingWidgetModule } from '@/src/services/RecordingWidgetModule';
import { liveActivityModule } from '@/src/services/LiveActivityModule';
import { logger, Event } from '@/src/utils/logger';
import { generateRecordingTitle } from '@/src/utils/recordingUtils';
import type { RecordingStatus, SttModel, TranscriptEntry } from '@/src/types/recordings';

/** Where a start/stop was triggered from — 'app' is the default in-app UI flow. */
export type RecordingSource = 'app' | 'widget' | 'live_activity' | 'notification';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface RecordingState {
  room: Room | null;
  externalId: string | null;
  channelId: string | null;
  status: RecordingStatus;
  isRecording: boolean;
  isMicMuted: boolean;
  startTime: number | null;
  transcripts: TranscriptEntry[];
  error: string | null;
  sttModel: SttModel;
  pendingAutoStart: boolean;
  pendingStop: boolean;
}

const initialState: RecordingState = {
  room: null,
  externalId: null,
  channelId: null,
  status: 'idle',
  isRecording: false,
  isMicMuted: false,
  startTime: null,
  error: null,
  sttModel: 'google',
  transcripts: [],
  pendingAutoStart: false,
  pendingStop: false,
};

// ---------------------------------------------------------------------------
// Internal store machinery
// ---------------------------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();
let state: RecordingState = { ...initialState };
let transcriptIdCounter = 0;
let transcriptUnsubscribe: (() => void) | null = null;
let widgetErrorClearTimeout: ReturnType<typeof setTimeout> | null = null;

const WIDGET_ERROR_DISPLAY_MS = 4000;

function clearWidgetErrorTimeout(): void {
  if (widgetErrorClearTimeout) {
    clearTimeout(widgetErrorClearTimeout);
    widgetErrorClearTimeout = null;
  }
}

// The audio session is shared with calls (CallRuntimeNativeService + CallKit).
// A recording activates it only when no call is using it, and deactivates only
// a session it activated itself — so it can never tear down a call's audio.
let recordingOwnsAudioSession = false;

function isCallUsingAudioSession(): boolean {
  const callState = callRuntimeNativeService.getConnectionState();
  return callState === 'connecting' || callState === 'connected';
}

async function startRecordingAudioSession(): Promise<void> {
  if (isCallUsingAudioSession()) return;
  await AudioSession.startAudioSession();
  recordingOwnsAudioSession = true;
}

function stopRecordingAudioSession(): void {
  if (!recordingOwnsAudioSession) return;
  recordingOwnsAudioSession = false;
  if (isCallUsingAudioSession()) return;
  void AudioSession.stopAudioSession().catch(() => {});
}

function setState(next: RecordingState): void {
  state = next;
  listeners.forEach(l => l());
}

export function getRecordingState(): RecordingState {
  return state;
}

export function subscribeRecordingStore(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type RecordingStoreAction =
  | { type: 'requestAutoStart' }
  | { type: 'requestStop' }
  | { type: 'startRecording'; sttModel?: SttModel; source?: RecordingSource }
  | {
      type: 'recordingStarted';
      room: Room;
      externalId: string;
      channelId: string;
      startTime: number;
    }
  | { type: 'pauseRecording' }
  | { type: 'resumeRecording' }
  | { type: 'stopRecording'; source?: RecordingSource }
  | { type: 'setStatus'; status: RecordingStatus }
  | { type: 'error'; error: string }
  | { type: 'reset' }
  | { type: 'addTranscript'; entry: TranscriptEntry }
  | { type: 'clearTranscripts' };

function attachTranscriptListener(room: Room): void {
  // Clean up any previous listener first
  if (transcriptUnsubscribe) {
    transcriptUnsubscribe();
    transcriptUnsubscribe = null;
  }

  const handleDataReceived = (
    payload: Uint8Array,
    _participant?: unknown,
    _kind?: DataPacket_Kind,
    topic?: string,
  ): void => {
    if (topic !== 'transcriptions') return;

    try {
      const decoder = new TextDecoder();
      const jsonStr = decoder.decode(payload);
      const data = JSON.parse(jsonStr) as {
        text?: string;
        user?: string;
        participantIdentity?: string;
        spokenAt?: number;
        timestamp?: number;
      };

      if (!data.text || typeof data.text !== 'string') return;

      transcriptIdCounter += 1;
      const entry: TranscriptEntry = {
        id: transcriptIdCounter,
        speaker: data.user ?? 'Unknown',
        text: data.text,
        timestamp: data.timestamp ?? Date.now(),
        participantIdentity: data.participantIdentity ?? '',
        spokenAt: data.spokenAt ?? Date.now(),
      };

      sendRecordingAction({ type: 'addTranscript', entry });
    } catch {
      // Silently ignore malformed packets
    }
  };

  room.on(RoomEvent.DataReceived, handleDataReceived);
  transcriptUnsubscribe = () => {
    room.off(RoomEvent.DataReceived, handleDataReceived);
  };
}

function cleanupRoom(): void {
  if (transcriptUnsubscribe) {
    transcriptUnsubscribe();
    transcriptUnsubscribe = null;
  }
  if (state.room) {
    void state.room.disconnect();
  }
  transcriptIdCounter = 0;
}

export function sendRecordingAction(action: RecordingStoreAction): void {
  const current = state;

  switch (action.type) {
    case 'requestAutoStart': {
      setState({ ...current, pendingAutoStart: true });
      break;
    }

    case 'requestStop': {
      // Only arm the flag while a recording is active/starting. A Stop from a
      // stale widget (e.g. after a force-quit left it showing "Recording")
      // arriving while idle must not persist — recordings.tsx only consumes
      // the flag when status is 'recording', so a stale flag would otherwise
      // instantly kill the NEXT recording the user starts.
      if (current.status !== 'recording' && current.status !== 'starting') break;
      setState({ ...current, pendingStop: true });
      break;
    }

    case 'startRecording': {
      const sttModel = action.sttModel ?? current.sttModel;
      const source: RecordingSource = action.source ?? 'app';
      setState({
        ...current,
        status: 'starting',
        sttModel,
        error: null,
        pendingAutoStart: false,
        pendingStop: false,
      });

      ensureLiveKitGlobals();

      recordingService
        .startRecording({ sttModel })
        .then(async session => {
          try {
            await startRecordingAudioSession();
          } catch (audioSessionError) {
            // On iOS, another component (e.g. CallKit) may already own/activate the
            // audio session. Don't block recording start on activation conflicts.
            if (Platform.OS === 'ios') {
              logger.warn(Event.RECORDING_ERROR, {
                context: 'AudioSession.startAudioSession',
                error:
                  audioSessionError instanceof Error
                    ? audioSessionError.message
                    : String(audioSessionError),
              });
            } else {
              throw audioSessionError;
            }
          }

          const room = new Room();
          await room.connect(session.serverUrl, session.token, { autoSubscribe: true });
          await room.localParticipant.setMicrophoneEnabled(true);

          // Start the Android foreground service so the OS keeps the microphone
          // alive when the app is backgrounded or the screen is locked.
          await voipForegroundServiceModule.startRecording(session.startTime);

          sendRecordingAction({
            type: 'recordingStarted',
            room,
            externalId: session.externalId,
            channelId: session.channelId,
            startTime: session.startTime,
          });

          logger.info(Event.RECORDING_STARTED, { externalId: session.externalId, source });
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Failed to start recording';
          logger.error(Event.RECORDING_ERROR, {
            context: 'startRecording',
            error: message,
            source,
          });
          sendRecordingAction({ type: 'error', error: message });
        });
      break;
    }

    case 'recordingStarted': {
      attachTranscriptListener(action.room);
      setState({
        ...current,
        room: action.room,
        externalId: action.externalId,
        channelId: action.channelId,
        startTime: action.startTime,
        status: 'recording',
        isRecording: true,
        error: null,
      });
      clearWidgetErrorTimeout();
      void recordingWidgetModule.publishState({
        isRecording: true,
        startTimeMs: action.startTime,
        externalId: action.externalId,
      });
      void liveActivityModule.startActivity(action.startTime, action.externalId);
      break;
    }

    case 'pauseRecording': {
      if (current.room) {
        void current.room.localParticipant.setMicrophoneEnabled(false);
      }
      setState({ ...current, isMicMuted: true });
      break;
    }

    case 'resumeRecording': {
      if (current.room) {
        void current.room.localParticipant.setMicrophoneEnabled(true);
      }
      setState({ ...current, isMicMuted: false });
      break;
    }

    case 'stopRecording': {
      const source: RecordingSource = action.source ?? 'app';
      cleanupRoom();
      stopRecordingAudioSession();
      // Stop the Android foreground service — microphone no longer needed.
      void voipForegroundServiceModule.stop();
      clearWidgetErrorTimeout();
      void recordingWidgetModule.publishState({
        isRecording: false,
        startTimeMs: null,
        externalId: null,
      });
      void liveActivityModule.endActivity();
      const durationMs = current.startTime ? Date.now() - current.startTime : null;
      const durationSec = durationMs ? Math.floor(durationMs / 1000) : 0;
      logger.info(Event.RECORDING_STOPPED, {
        externalId: current.externalId,
        durationSec,
        source,
      });
      // The recording itself is already fully saved server-side by this point —
      // this is purely the cosmetic title. A no-foreground stop (widget/Live
      // Activity) has no screen to show SaveTitleModal on, so auto-title it
      // with exactly what the modal would have pre-filled; the user can still
      // rename it later from the recordings list. Foreground/app-initiated
      // stops are unaffected — recordings.tsx keeps showing the modal.
      if (source !== 'app' && current.externalId) {
        const title = generateRecordingTitle(current.startTime);
        recordingService.updateRecordingTitle(current.externalId, title).catch((error: unknown) => {
          logger.error(Event.RECORDING_ERROR, {
            context: 'autoTitleOnStop',
            error: error instanceof Error ? error.message : String(error),
            source,
          });
        });
      }
      setState({
        room: null,
        externalId: null,
        channelId: null,
        status: 'idle',
        isRecording: false,
        isMicMuted: false,
        startTime: null,
        error: null,
        sttModel: current.sttModel,
        transcripts: [],
        pendingAutoStart: false,
        pendingStop: false,
      });
      break;
    }

    case 'setStatus': {
      setState({ ...current, status: action.status });
      break;
    }

    case 'error': {
      cleanupRoom();
      stopRecordingAudioSession();
      void voipForegroundServiceModule.stop();
      clearWidgetErrorTimeout();
      void recordingWidgetModule.publishState({
        isRecording: false,
        startTimeMs: null,
        externalId: null,
        hasError: true,
      });
      // Best-effort brief "Recording failed" indicator — auto-clears rather than
      // sticking around indefinitely. If a new start/stop happens first, the
      // corresponding branch above/below cancels this timeout.
      widgetErrorClearTimeout = setTimeout(() => {
        widgetErrorClearTimeout = null;
        void recordingWidgetModule.publishState({
          isRecording: false,
          startTimeMs: null,
          externalId: null,
          hasError: false,
        });
      }, WIDGET_ERROR_DISPLAY_MS);
      void liveActivityModule.endActivity();
      logger.error(Event.RECORDING_ERROR, { error: action.error });
      setState({
        ...current,
        room: null,
        status: 'error',
        isRecording: false,
        isMicMuted: false,
        error: action.error,
        pendingAutoStart: false,
        pendingStop: false,
      });
      break;
    }

    case 'reset': {
      cleanupRoom();
      stopRecordingAudioSession();
      void voipForegroundServiceModule.stop();
      clearWidgetErrorTimeout();
      void recordingWidgetModule.publishState({
        isRecording: false,
        startTimeMs: null,
        externalId: null,
      });
      void liveActivityModule.endActivity();
      setState({
        ...initialState,
        sttModel: current.sttModel,
      });
      break;
    }

    case 'addTranscript': {
      setState({ ...current, transcripts: [...current.transcripts, action.entry] });
      break;
    }

    case 'clearTranscripts': {
      setState({ ...current, transcripts: [] });
      transcriptIdCounter = 0;
      break;
    }

    default:
      break;
  }
}

// A no-foreground Stop from the widget, Live Activity, or the Android
// foreground-service notification (iOS 17+ AppIntent, Android in-process
// broadcast) bypasses the pendingStop/recordings.tsx UI path entirely and
// stops the room directly — registered once for the lifetime of the app
// process.
recordingWidgetModule.addWidgetStopListener(source => {
  if (!state.isRecording) return;
  sendRecordingAction({
    type: 'stopRecording',
    source: source === 'notification' ? 'notification' : 'widget',
  });
});

// Reconcile the widget (and Live Activity) with the store's real state at
// startup and on every foreground transition. iOS widget updates ride on
// WidgetCenter reloads that the system budget-defers (or drops) while the app
// is backgrounded — a Live-Activity Stop is exactly that case — and a
// force-quit skips teardown entirely; with a `.never` timeline policy a
// missed reload would otherwise leave the widget ticking forever. Recording
// state never survives process death, so publishing the store's state is
// always correct. Idempotent and cheap on Android.
function reconcileWidgetSurfaces(): void {
  void recordingWidgetModule.publishState({
    isRecording: state.isRecording,
    startTimeMs: state.startTime,
    externalId: state.externalId,
  });
  if (!state.isRecording) {
    // Also sweeps Live Activities orphaned by a force-quit (endActivity ends
    // dangling OS-side activities, not just the in-memory handle).
    void liveActivityModule.endActivity();
  }
}

reconcileWidgetSurfaces();
AppState.addEventListener('change', nextState => {
  if (nextState === 'active') reconcileWidgetSurfaces();
});

// ---------------------------------------------------------------------------
// Convenience helpers used in screens
// ---------------------------------------------------------------------------

export function getLastExternalId(): string | null {
  return state.externalId;
}

export { generateRecordingTitle };
