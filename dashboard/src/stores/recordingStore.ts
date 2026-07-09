/**
 * Recording Store - Simple reactive store for audio recording state
 * Uses XState store v3 API for minimal overhead
 */

import { createStore } from '@xstate/store';
import { Room, RoomConnectOptions, RoomEvent, DataPacket_Kind } from 'livekit-client';
import { recordingService } from '../services/Recording/recordingService';
import { toast } from 'sonner';
import { logger, Event } from '../utils/logger';
import { formatDuration } from '../utils/dateUtils';

let transcriptUnsubscribe: (() => void) | null = null;
let transcriptIdCounter = 0;

/**
 * Normalize backend Unix timestamps to JS millisecond timestamps.
 * The Python agent sends seconds since epoch, while the rest of the
 * dashboard (and Date.now()) uses milliseconds.
 */
const normalizeTimestamp = (value: unknown): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) return Date.now();
  // Seconds-since-epoch values are roughly 1e9; JS ms values are 1e12+.
  if (value < 1e12) return value * 1000;
  return value;
};

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

    startRecording: (context, event: { sttModel?: SttModel }): RecordingState => {
      const sttModel = event.sttModel || context.sttModel;

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
      };
    },

    recordingStarted: (
      context,
      event: {
        room: Room;
        externalId: string;
        channelId: string;
        startTime: number;
      },
    ): RecordingState => {
      const { room } = event;

      // Clean up any existing subscription
      if (transcriptUnsubscribe) {
        transcriptUnsubscribe();
        transcriptUnsubscribe = null;
      }

      // Set up transcript subscription directly in the store
      // This ensures only ONE listener regardless of how many components use the hook
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

      transcriptUnsubscribe = (): void => {
        room.off(RoomEvent.DataReceived, handleDataReceived);
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
    }),

    addTranscript: (context, event: { entry: TranscriptEntry }): RecordingState => ({
      ...context,
      transcripts: [...context.transcripts, event.entry],
    }),

    clearTranscripts: (context): RecordingState => ({
      ...context,
      transcripts: [],
    }),

    setNotesCanvas: (context, event: { canvasId: string }): RecordingState => ({
      ...context,
      notesCanvasId: event.canvasId,
    }),
  },
});
