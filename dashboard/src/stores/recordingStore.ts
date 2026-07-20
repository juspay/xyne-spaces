/**
 * Recording Store - Simple reactive store for audio recording state
 * Uses XState store v3 API for minimal overhead
 */

import { createStore } from '@xstate/store';
import {
  Room,
  RoomConnectOptions,
  RoomEvent,
  DataPacket_Kind,
  type RemoteParticipant,
} from 'livekit-client';
import { recordingService } from '../services/Recording/recordingService';
import { toast } from 'sonner';
import { logger, Event } from '../utils/logger';
import { formatDuration, normalizeTimestamp } from '../utils/dateUtils';
import {
  AGENT_LEFT_CONFIRM_DELAY_MS,
  isTranscriptionAgentIdentity,
  shouldConfirmTranscriptionAgentLeft,
} from '../utils/livekitAgent';

let transcriptUnsubscribe: (() => void) | null = null;
let transcriptIdCounter = 0;

export interface TranscriptEntry {
  id: number;
  speaker: string;
  text: string;
  timestamp: number;
  participantIdentity: string;
  spokenAt: number;
}

export type RecordingStatus = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'error';
export type SttModel = 'google' | 'azure' | 'deepgram';

/** Layout state for the active recording workspace */
export type RecordingLayout = 'transcript' | 'split' | 'notes';
export const DEFAULT_NOTES_TITLE = 'Untitled Notes';

export interface RecordingState {
  room: Room | null;
  externalId: string | null;
  channelId: string | null;
  status: RecordingStatus;
  isRecording: boolean;
  startTime: number | null;
  transcripts: TranscriptEntry[];
  error: string | null;
  sttModel: SttModel;
  pendingAutoStart: boolean;
  pendingStop: boolean;
  /** Canvas (cuid/uuid) for notes taken during this recording — null until the user creates one */
  notesCanvasId: string | null;
  /** Public view-access id used to build the canvas share link */
  notesCanvasViewAccessId: string | null;
  /** Title of the notes canvas */
  notesCanvasTitle: string;
  isCanvasPaneOpen: boolean;
  /** Current layout of the recording workspace: transcript-only, split, or notes-only */
  activeLayout: RecordingLayout;
  isTranscriptMinimized: boolean;
  agentLeft: boolean;
}

const initialContext: RecordingState = {
  room: null,
  externalId: null,
  channelId: null,
  status: 'idle',
  isRecording: false,
  startTime: null,
  error: null,
  sttModel: 'azure',
  transcripts: [],
  pendingAutoStart: false,
  pendingStop: false,
  notesCanvasId: null,
  notesCanvasViewAccessId: null,
  notesCanvasTitle: DEFAULT_NOTES_TITLE,
  isCanvasPaneOpen: false,
  activeLayout: 'transcript',
  isTranscriptMinimized: false,
  agentLeft: false,
};

export const recordingStore = createStore({
  context: initialContext,
  on: {
    // Actions
    requestAutoStart: (context): RecordingState => ({
      ...context,
      pendingAutoStart: true,
    }),

    requestStop: (context): RecordingState => ({
      ...context,
      pendingStop: true,
    }),

    startRecording: (
      context,
      event: { sttModel?: SttModel; defaultLayout?: RecordingLayout },
    ): RecordingState => {
      const sttModel = event.sttModel || context.sttModel;
      const defaultLayout = event.defaultLayout ?? 'transcript';

      // Set starting status
      recordingStore.send({ type: 'setStatus', status: 'starting' });

      // Call API to start recording
      recordingService
        .startRecording({ sttModel })
        .then(async session => {
          // Create LiveKit room
          const room = new Room();

          // Connect to LiveKit
          const options: RoomConnectOptions = {
            autoSubscribe: true,
          };

          await room.connect(session.serverUrl, session.token, options);

          // Enable microphone
          await room.localParticipant.setMicrophoneEnabled(true);

          // Update store with connected state
          recordingStore.send({
            type: 'recordingStarted',
            room,
            externalId: session.externalId,
            channelId: session.channelId,
            startTime: session.startTime,
            defaultLayout,
          });

          toast.success('Recording started', {
            description: 'Your voice is being recorded and transcribed',
            duration: 3000,
          });
        })
        .catch(error => {
          logger.error(Event.RECORDING_ERROR, {
            error: error instanceof Error ? error.message : 'Failed to start recording',
          });
          recordingStore.send({
            type: 'error',
            error: error instanceof Error ? error.message : 'Failed to start recording',
          });
          toast.error('Failed to start recording', {
            description: 'Please check your microphone permission and try again',
            duration: 5000,
          });
        });

      return {
        ...context,
        status: 'starting',
        sttModel,
        error: null,
        pendingAutoStart: false,
        activeLayout: defaultLayout,
      };
    },

    recordingStarted: (
      context,
      event: {
        room: Room;
        externalId: string;
        channelId: string;
        startTime: number;
        defaultLayout?: RecordingLayout;
      },
    ): RecordingState => {
      const { room, defaultLayout = 'transcript' } = event;

      // Clean up any existing subscription
      if (transcriptUnsubscribe) {
        transcriptUnsubscribe();
        transcriptUnsubscribe = null;
      }

      // Set up transcript subscription directly in the store
      // This ensures only ONE listener regardless of how many components use the hook
      let agentLeftTimer: ReturnType<typeof setTimeout> | null = null;

      const clearAgentLeftTimer = (): void => {
        if (agentLeftTimer) {
          clearTimeout(agentLeftTimer);
          agentLeftTimer = null;
        }
      };

      const handleParticipantDisconnected = (participant: RemoteParticipant): void => {
        if (!isTranscriptionAgentIdentity(participant.identity)) return;

        clearAgentLeftTimer();
        agentLeftTimer = setTimeout(() => {
          agentLeftTimer = null;
          const current = recordingStore.getSnapshot().context;
          const isActive = current.status === 'recording' || current.status === 'paused';

          if (current.room === room && isActive && shouldConfirmTranscriptionAgentLeft(room)) {
            recordingStore.send({ type: 'agentLeftUnexpectedly' });
          }
        }, AGENT_LEFT_CONFIRM_DELAY_MS);
      };

      const handleParticipantConnected = (participant: RemoteParticipant): void => {
        if (isTranscriptionAgentIdentity(participant.identity)) {
          clearAgentLeftTimer();
        }
      };

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
            speaker: data.user || 'Unknown',
            text: data.text,
            timestamp: normalizeTimestamp(data.timestamp),
            participantIdentity: data.participantIdentity || '',
            spokenAt: normalizeTimestamp(data.spokenAt),
          };

          recordingStore.send({ type: 'addTranscript', entry });
        } catch {
          // Silently ignore malformed data
        }
      };

      room.on(RoomEvent.DataReceived, handleDataReceived);
      room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
      room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);

      transcriptUnsubscribe = (): void => {
        clearAgentLeftTimer();
        room.off(RoomEvent.DataReceived, handleDataReceived);
        room.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
        room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
      };

      return {
        ...context,
        room: event.room,
        externalId: event.externalId,
        channelId: event.channelId,
        startTime: event.startTime,
        status: 'recording',
        isRecording: true,
        error: null,
        activeLayout: defaultLayout,
        agentLeft: false,
      };
    },

    pauseRecording: (context): RecordingState => {
      if (context.room) {
        void context.room.localParticipant.setMicrophoneEnabled(false);
      }
      toast.info('Recording paused', {
        description: 'Microphone is muted',
        duration: 2000,
      });
      return {
        ...context,
        status: 'paused',
      };
    },

    resumeRecording: (context): RecordingState => {
      if (context.room) {
        void context.room.localParticipant.setMicrophoneEnabled(true);
      }
      toast.success('Recording resumed', {
        duration: 2000,
      });
      return {
        ...context,
        status: 'recording',
      };
    },

    stopRecording: (context): RecordingState => {
      const durationMs = context.startTime ? Date.now() - context.startTime : null;

      // Cleanup room
      if (context.room) {
        void context.room.disconnect();
      }

      // Cleanup transcript subscription
      if (transcriptUnsubscribe) {
        transcriptUnsubscribe();
        transcriptUnsubscribe = null;
      }
      transcriptIdCounter = 0;

      // Show toast
      const duration = durationMs ? formatDuration(durationMs) : 'Unknown duration';
      toast.success('Recording stopped', {
        description: `Recording saved (${duration})`,
        duration: 3000,
      });

      // Reset state
      return {
        room: null,
        externalId: null,
        channelId: null,
        status: 'idle',
        isRecording: false,
        startTime: null,
        error: null,
        sttModel: context.sttModel, // Preserve STT model preference
        transcripts: [], // Clear transcripts when recording stops
        pendingAutoStart: false,
        pendingStop: false,
        notesCanvasId: null,
        notesCanvasViewAccessId: null,
        notesCanvasTitle: DEFAULT_NOTES_TITLE,
        isCanvasPaneOpen: false,
        activeLayout: 'transcript',
        isTranscriptMinimized: false,
        agentLeft: false,
      };
    },

    setStatus: (context, event: { status: RecordingState['status'] }): RecordingState => ({
      ...context,
      status: event.status,
    }),

    error: (context, event: { error: string }): RecordingState => {
      // Cleanup room on error
      if (context.room) {
        void context.room.disconnect();
      }

      // Cleanup transcript subscription
      if (transcriptUnsubscribe) {
        transcriptUnsubscribe();
        transcriptUnsubscribe = null;
      }
      transcriptIdCounter = 0;

      return {
        ...context,
        status: 'error',
        isRecording: false,
        error: event.error,
        agentLeft: false,
      };
    },

    reset: (context): RecordingState => ({
      room: null,
      externalId: null,
      channelId: null,
      status: 'idle',
      isRecording: false,
      startTime: null,
      error: null,
      sttModel: context.sttModel, // Preserve STT model preference
      transcripts: [], // Clear transcripts
      pendingAutoStart: false,
      pendingStop: false,
      notesCanvasId: null,
      notesCanvasViewAccessId: null,
      notesCanvasTitle: DEFAULT_NOTES_TITLE,
      isCanvasPaneOpen: false,
      activeLayout: 'transcript',
      isTranscriptMinimized: false,
      agentLeft: false,
    }),

    addTranscript: (context, event: { entry: TranscriptEntry }): RecordingState => ({
      ...context,
      transcripts: [...context.transcripts, event.entry],
    }),

    clearTranscripts: (context): RecordingState => ({
      ...context,
      transcripts: [],
    }),

    /**
     * The transcription agent unexpectedly left mid-recording. Flag it only while
     * a recording is genuinely in progress — if we're already stopping / idle, the
     * agent is just following the room down on a user-initiated stop.
     *
     * `agentLeft` is a one-shot signal: the UI (RecordingsScreen / RecordingOverlay)
     * reacts by auto-ending the recording, and stopRecording clears the flag. There
     * is deliberately no "continue" path — a note-taker with no transcription is
     * pointless, so the recording is always ended.
     */
    agentLeftUnexpectedly: (context): RecordingState => {
      if (context.status !== 'recording' && context.status !== 'paused') {
        return context;
      }
      return {
        ...context,
        agentLeft: true,
      };
    },

    setNotesCanvas: (context, event: { canvasId: string; title?: string }): RecordingState => ({
      ...context,
      notesCanvasId: event.canvasId,
      notesCanvasTitle: event.title ?? context.notesCanvasTitle,
      isCanvasPaneOpen: true,
    }),

    setNotesCanvasTitle: (context, event: { title: string }): RecordingState => ({
      ...context,
      notesCanvasTitle: event.title,
    }),

    setActiveLayout: (context, event: { layout: RecordingLayout }): RecordingState => ({
      ...context,
      activeLayout: event.layout,
    }),

    setTranscriptMinimized: (context, event: { isMinimized: boolean }): RecordingState => ({
      ...context,
      isTranscriptMinimized: event.isMinimized,
    }),
  },
});
