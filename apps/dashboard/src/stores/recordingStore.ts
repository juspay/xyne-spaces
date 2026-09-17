/**
 * Recording Store - Simple reactive store for audio recording state
 * Uses XState store v3 API for minimal overhead
 */

import { createStore } from '@xstate/store';
import { Room, RoomConnectOptions, RoomEvent, DataPacket_Kind } from 'livekit-client';
import { recordingService } from '../services/Recording/recordingService';
import { getLocalVideoState, setLocalVideoMuted } from '../utils/recordingMedia';
import { toast } from 'sonner';
import { logger, Event } from '../utils/logger';
import { formatDuration, normalizeTimestamp } from '../utils/dateUtils';
import { calculateRecordingElapsedMs } from '../utils/recordingUtils';
import { playAudio, AUDIO_PATHS } from '../utils/audioPlayer';
import type { RecordingRepairReason } from '../services/Recording/recordingService';

let transcriptUnsubscribe: (() => void) | null = null;
let transcriptIdCounter = 0;
// `Room.disconnect()` emits Disconnected asynchronously. Mark a normal user
// stop first so its callback cannot be mistaken for a server-side failure.
const intentionallyDisconnectedRooms = new WeakSet<Room>();

const PAGE_UNLOAD_GRACE_MS = 5000;
let pageUnloading = false;
let pageUnloadingReset: ReturnType<typeof setTimeout> | null = null;

if (typeof window !== 'undefined') {
  const markPageUnloading = (): void => {
    pageUnloading = true;
    if (pageUnloadingReset) clearTimeout(pageUnloadingReset);
    pageUnloadingReset = setTimeout(() => {
      pageUnloading = false;
      pageUnloadingReset = null;
    }, PAGE_UNLOAD_GRACE_MS);
  };
  for (const event of ['beforeunload', 'pagehide', 'freeze']) {
    window.addEventListener(event, markPageUnloading);
  }
}

export interface TranscriptEntry {
  id: number;
  speaker: string;
  text: string;
  timestamp: number;
  participantIdentity: string;
  spokenAt: number;
}

/**
 * A moment the user flagged during the recording. Held locally so the transcript
 * divider appears the instant the flag is clicked; persistence to Call.markedItems
 * happens separately through the calls.markMoment mutator.
 */
export interface MarkedMoment {
  transcriptId: number | null;
  timestampSeconds: number;
  elapsedMs: number;
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
  title: string | null;
  status: RecordingStatus;
  isRecording: boolean;
  startTime: number | null;
  pauseStartedAt: number | null;
  accumulatedPausedMs: number;
  transcripts: TranscriptEntry[];
  markedMoments: MarkedMoment[];
  error: string | null;
  sttModel: SttModel;
  pendingAutoStart: boolean;
  autoStartRequestedAt: number | null;
  /** conversationId/channelId of the thread that triggered `requestAutoStart`,
   * consumed by RecordingsScreen's auto-start effect and forwarded to
   * recordingService.startRecording so the backend can post/update the
   * thread's anchor message. Cleared as soon as the recording actually starts. */
  pendingConversationId: string | null;
  pendingChannelId: string | null;
  pendingStop: boolean;
  /** Canvas created as part of starting a headless recording. */
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
  isCameraEnabled: boolean;
  isScreenShareEnabled: boolean;
  fallbackProtection: 'initializing' | 'ready' | 'unavailable';
  fallbackReasons: RecordingRepairReason[];
  repairPending: boolean;
}

const initialContext: RecordingState = {
  room: null,
  externalId: null,
  channelId: null,
  title: null,
  status: 'idle',
  isRecording: false,
  startTime: null,
  pauseStartedAt: null,
  accumulatedPausedMs: 0,
  error: null,
  sttModel: 'google',
  transcripts: [],
  markedMoments: [],
  pendingAutoStart: false,
  autoStartRequestedAt: null,
  pendingConversationId: null,
  pendingChannelId: null,
  pendingStop: false,
  notesCanvasId: null,
  notesCanvasViewAccessId: null,
  notesCanvasTitle: DEFAULT_NOTES_TITLE,
  isCanvasPaneOpen: false,
  activeLayout: 'transcript',
  isTranscriptMinimized: false,
  agentLeft: false,
  isCameraEnabled: false,
  isScreenShareEnabled: false,
  fallbackProtection: 'initializing',
  fallbackReasons: [],
  repairPending: false,
};

const ACTIVE_STATUSES: ReadonlySet<RecordingStatus> = new Set(['recording', 'paused', 'stopping']);

/**
 * Whether a recording session exists at all — including one still spinning up or
 * winding down, where the mic is live or about to be.
 *
 * Broader than `ACTIVE_STATUSES`, which is about a session that has *started*.
 * This is the test the start sites already use inline to refuse a second
 * recording (ThreadPannel, ChatBubble, RecordingsV2Screen, useSlashCommands);
 * named here so callers that need it stop re-spelling it.
 */
export function isRecordingSessionActive(status: RecordingStatus): boolean {
  return status !== 'idle' && status !== 'error';
}

export const recordingStore = createStore({
  context: initialContext,
  on: {
    // Actions
    requestAutoStart: (
      context,
      event: { conversationId?: string; channelId?: string } = {},
    ): RecordingState => {
      if (context.status === 'starting') return context;
      return {
        ...context,
        pendingAutoStart: true,
        autoStartRequestedAt: Date.now(),
        pendingConversationId: event.conversationId ?? null,
        pendingChannelId: event.channelId ?? null,
      };
    },

    clearAutoStart: (context): RecordingState => ({
      ...context,
      pendingAutoStart: false,
      autoStartRequestedAt: null,
      pendingConversationId: null,
      pendingChannelId: null,
    }),

    requestStop: (context): RecordingState => {
      const isInFlight =
        context.status === 'recording' ||
        context.status === 'paused' ||
        context.status === 'starting';
      if (!isInFlight) return context;
      return {
        ...context,
        pendingStop: true,
      };
    },

    startRecording: (
      context,
      event: {
        sttModel?: SttModel;
        defaultLayout?: RecordingLayout;
        conversationId?: string;
        channelId?: string;
      },
    ): RecordingState => {
      const sttModel = event.sttModel || context.sttModel;
      const defaultLayout = event.defaultLayout ?? 'transcript';
      const conversationId = event.conversationId ?? context.pendingConversationId ?? undefined;
      const threadChannelId = event.channelId ?? context.pendingChannelId ?? undefined;

      // Set starting status
      recordingStore.send({ type: 'setStatus', status: 'starting' });

      // Call API to start recording
      recordingService
        .startRecording({
          sttModel,
          ...(conversationId ? { conversationId } : {}),
          ...(threadChannelId ? { channelId: threadChannelId } : {}),
        })
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
            notesCanvasId: session.notesCanvasId,
            startTime: session.startTime,
            defaultLayout,
          });

          if (recordingStore.getSnapshot().context.pendingStop) {
            recordingStore.send({ type: 'stopRecording' });
          }
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
        pendingConversationId: null,
        pendingChannelId: null,
        pendingStop: false,
        activeLayout: defaultLayout,
      };
    },

    recordingStarted: (
      context,
      event: {
        room: Room;
        externalId: string;
        channelId: string | null;
        notesCanvasId: string;
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
      const handleRoomDisconnected = (): void => {
        if (intentionallyDisconnectedRooms.delete(room)) return;
        if (pageUnloading) return;

        const current = recordingStore.getSnapshot().context;
        if (current.room !== room || !ACTIVE_STATUSES.has(current.status)) return;
        // The offline recorder keeps capturing the whole call to disk and the
        // fallback coordinator uploads it for a whole-file redo on stop, so a lost
        // session is not a lost recording — let the user keep going.
        if (current.fallbackProtection === 'ready') {
          logger.warn(Event.RECORDING_ERROR, {
            error: 'Recording session disconnected; continuing with local protection',
          });
          return;
        }

        const message =
          'Recording stopped because its session was disconnected and could not be saved.';
        logger.error(Event.RECORDING_ERROR, { error: message });
        toast.error('Recording stopped', {
          description: 'We could not save this recording. Please try again.',
          duration: 6000,
        });
        recordingStore.send({ type: 'error', error: message });
      };

      const handleRoomMetadataChanged = (metadata: string): void => {
        try {
          const data = JSON.parse(metadata) as { recordingStartFailure?: unknown };
          if (data.recordingStartFailure !== true) return;
          if (pageUnloading) return;

          const current = recordingStore.getSnapshot().context;
          if (current.room !== room || !ACTIVE_STATUSES.has(current.status)) return;

          const message = 'Recording could not be saved because its session could not be created.';
          logger.error(Event.RECORDING_ERROR, { error: message });
          toast.error('Recording stopped', {
            description: 'We could not save this recording. Please try again.',
            duration: 6000,
          });
          recordingStore.send({ type: 'error', error: message });
        } catch {
          // Ignore malformed room metadata.
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

      const handleLocalTracksChanged = (): void => {
        recordingStore.send({ type: 'syncLocalMedia', room });
      };

      room.on(RoomEvent.DataReceived, handleDataReceived);
      room.on(RoomEvent.Disconnected, handleRoomDisconnected);
      room.on(RoomEvent.RoomMetadataChanged, handleRoomMetadataChanged);
      room.on(RoomEvent.LocalTrackPublished, handleLocalTracksChanged);
      room.on(RoomEvent.LocalTrackUnpublished, handleLocalTracksChanged);

      transcriptUnsubscribe = (): void => {
        room.off(RoomEvent.DataReceived, handleDataReceived);
        room.off(RoomEvent.Disconnected, handleRoomDisconnected);
        room.off(RoomEvent.RoomMetadataChanged, handleRoomMetadataChanged);
        room.off(RoomEvent.LocalTrackPublished, handleLocalTracksChanged);
        room.off(RoomEvent.LocalTrackUnpublished, handleLocalTracksChanged);
      };

      playAudio(AUDIO_PATHS.RECORDING_START);

      return {
        ...context,
        room: event.room,
        externalId: event.externalId,
        channelId: event.channelId,
        notesCanvasId: event.notesCanvasId,
        startTime: event.startTime,
        pauseStartedAt: null,
        accumulatedPausedMs: 0,
        status: 'recording',
        isRecording: true,
        error: null,
        activeLayout: defaultLayout,
        agentLeft: false,
        fallbackProtection: context.fallbackProtection,
        fallbackReasons: [],
        repairPending: context.repairPending,
      };
    },

    pauseRecording: (context): RecordingState => {
      if (context.status !== 'recording') return context;

      const pauseStartedAt = Date.now();
      if (context.room) {
        void context.room.localParticipant.setMicrophoneEnabled(false);
        setLocalVideoMuted(context.room, true);
      }
      toast.info('Recording paused', {
        description: 'Microphone and video are muted',
        duration: 2000,
      });
      return {
        ...context,
        status: 'paused',
        pauseStartedAt,
      };
    },

    resumeRecording: (context): RecordingState => {
      if (context.status !== 'paused') return context;

      const resumedAt = Date.now();
      if (context.room) {
        void context.room.localParticipant.setMicrophoneEnabled(true);
        setLocalVideoMuted(context.room, false);
      }
      toast.success('Recording resumed', {
        duration: 2000,
      });
      return {
        ...context,
        status: 'recording',
        pauseStartedAt: null,
        accumulatedPausedMs:
          context.accumulatedPausedMs +
          (context.pauseStartedAt !== null ? resumedAt - context.pauseStartedAt : 0),
      };
    },

    syncLocalMedia: (context, event: { room: Room }): RecordingState =>
      context.room === event.room ? { ...context, ...getLocalVideoState(event.room) } : context,

    stopRecording: (context, event?: { silent?: boolean }): RecordingState => {
      const durationMs = context.startTime
        ? calculateRecordingElapsedMs(
            context.startTime,
            context.pauseStartedAt,
            context.accumulatedPausedMs,
          )
        : null;

      // Cleanup room
      if (context.room) {
        intentionallyDisconnectedRooms.add(context.room);
        void context.room.disconnect();
      }

      // Cleanup transcript subscription
      if (transcriptUnsubscribe) {
        transcriptUnsubscribe();
        transcriptUnsubscribe = null;
      }
      transcriptIdCounter = 0;

      if (ACTIVE_STATUSES.has(context.status)) {
        playAudio(AUDIO_PATHS.RECORDING_END);
      }

      // A caller about to navigate away (workspace switch, reload) shows this
      // toast itself once the destination page mounts — this one would just be
      // torn down mid-display by the hard navigation before it's legible.
      if (!event?.silent) {
        const duration = durationMs ? formatDuration(durationMs) : 'Unknown duration';
        toast.success('Recording stopped', {
          description: `Recording saved (${duration})`,
          duration: 3000,
        });
      }

      // Reset state
      return {
        room: null,
        externalId: null,
        channelId: null,
        title: null,
        status: 'idle',
        isRecording: false,
        startTime: null,
        pauseStartedAt: null,
        accumulatedPausedMs: 0,
        error: null,
        sttModel: context.sttModel, // Preserve STT model preference
        transcripts: [], // Clear transcripts when recording stops
        markedMoments: [],
        pendingAutoStart: false,
        autoStartRequestedAt: null,
        pendingConversationId: null,
        pendingChannelId: null,
        pendingStop: false,
        notesCanvasId: null,
        notesCanvasViewAccessId: null,
        notesCanvasTitle: DEFAULT_NOTES_TITLE,
        isCanvasPaneOpen: false,
        activeLayout: 'transcript',
        isTranscriptMinimized: false,
        agentLeft: false,
        isCameraEnabled: false,
        isScreenShareEnabled: false,
        fallbackProtection: context.fallbackProtection,
        fallbackReasons: [],
        repairPending: context.repairPending,
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

      if (ACTIVE_STATUSES.has(context.status)) {
        playAudio(AUDIO_PATHS.RECORDING_END);
      }

      return {
        ...context,
        status: 'error',
        isRecording: false,
        pauseStartedAt: null,
        accumulatedPausedMs: 0,
        error: event.error,
        agentLeft: false,
        isCameraEnabled: false,
        isScreenShareEnabled: false,
        fallbackProtection: context.fallbackProtection,
        fallbackReasons: [],
        repairPending: context.repairPending,
      };
    },

    reset: (context): RecordingState => {
      if (ACTIVE_STATUSES.has(context.status)) {
        playAudio(AUDIO_PATHS.RECORDING_END);
      }

      return {
        room: null,
        externalId: null,
        channelId: null,
        title: null,
        status: 'idle',
        isRecording: false,
        startTime: null,
        pauseStartedAt: null,
        accumulatedPausedMs: 0,
        error: null,
        sttModel: context.sttModel, // Preserve STT model preference
        transcripts: [], // Clear transcripts
        markedMoments: [],
        pendingAutoStart: false,
        autoStartRequestedAt: null,
        pendingConversationId: null,
        pendingChannelId: null,
        pendingStop: false,
        notesCanvasId: null,
        notesCanvasViewAccessId: null,
        notesCanvasTitle: DEFAULT_NOTES_TITLE,
        isCanvasPaneOpen: false,
        activeLayout: 'transcript',
        isTranscriptMinimized: false,
        agentLeft: false,
        isCameraEnabled: false,
        isScreenShareEnabled: false,
        fallbackProtection: context.fallbackProtection,
        fallbackReasons: [],
        repairPending: context.repairPending,
      };
    },

    addTranscript: (context, event: { entry: TranscriptEntry }): RecordingState => ({
      ...context,
      transcripts: [...context.transcripts, event.entry],
    }),

    clearTranscripts: (context): RecordingState => ({
      ...context,
      transcripts: [],
      markedMoments: [],
    }),

    /**
     * Record a flagged moment locally. The caller (NoteTakerOverlayHost) derives the
     * anchor and timestamp and owns persisting it, so this is a plain append.
     */
    markMoment: (context, event: { moment: MarkedMoment }): RecordingState => ({
      ...context,
      markedMoments: [...context.markedMoments, event.moment],
    }),

    setFallbackReason: (
      context,
      event: { reason: RecordingRepairReason; active: boolean },
    ): RecordingState => ({
      ...context,
      fallbackReasons: event.active
        ? [...new Set([...context.fallbackReasons, event.reason])].sort()
        : context.fallbackReasons.filter(reason => reason !== event.reason),
    }),

    setFallbackProtection: (
      context,
      event: { availability: RecordingState['fallbackProtection'] },
    ): RecordingState => ({ ...context, fallbackProtection: event.availability }),

    setRepairPending: (context, event: { pending: boolean }): RecordingState => ({
      ...context,
      repairPending: event.pending,
    }),

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

    setTitle: (context, event: { title: string }): RecordingState => ({
      ...context,
      title: event.title,
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
