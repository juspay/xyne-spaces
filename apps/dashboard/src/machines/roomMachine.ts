import { setup, assign, createActor, fromCallback, fromPromise } from 'xstate';
import type { SdlcCallLink } from '@xyne/shared';
import {
  Room,
  RoomEvent as LiveKitRoomEvent,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  LocalTrackPublication,
  ConnectionState,
  RoomConnectOptions,
  Participant,
  TrackPublication,
  setLogLevel,
  DisconnectReason,
  SubscriptionError,
  MediaDeviceFailure,
  Track,
  LocalVideoTrack,
} from 'livekit-client';
import { BackgroundBlur } from '@livekit/track-processors';
import type { Zero } from '@rocicorp/zero';
import { DEFAULT_HOST_CONTROLS, type Call, type HostControls } from '@xyne/shared';
import {
  parseAIDataMessage,
  decodeDataPayload,
  AI_DATA_TOPIC,
  type AIInviteUser,
  type AIEvent,
} from '@xyne/shared';
// import type { Mutators } from '../zero/mutators';
import { callService } from '../services/Call/callService';
import { openLink } from '../utils/openLink';
import { CallType } from '@xyne/shared';
import { playAudio, AUDIO_PATHS } from '../utils/audioPlayer';
import { isCallUrlApiAllowed, type CallUrlOverrides } from '../utils/callUrlOverrides';
import { toast } from 'sonner';
import { MACOS_PRIVACY_URLS } from '../constants/permissions';
import {
  CALL_MEDIA_QUALITY_CONFIG,
  getCallMediaQualitySettings,
} from '../hooks/useCallMediaQualitySettings';
import {
  reactNativeBridge,
  detectReactNativeWebView,
  isNativeCallSupported,
} from '../utils/reactNativeBridge';
import { isParticipantScreenShareEnabled } from '../utils/livekitScreenShare';
import {
  AGENT_LEFT_CONFIRM_DELAY_MS,
  isTranscriptionAgentIdentity,
  shouldConfirmTranscriptionAgentLeft,
} from '../utils/livekitAgent';
import { logger, Event } from '../utils/logger';
import { getCallJoinSettings } from '../hooks/useCallJoinSettings';
import {
  isHostControlTurnedOffForLocal,
  isHostControlTurnedOffForLocalWithControls,
  parseHostControlsFromMetadata,
} from '../utils/hostControls';

// Set LiveKit log level
setLogLevel('warn');

// Auto-mute threshold: mute the joining user when more than this many remote participants are already in the call
const DEFAULT_MUTE_THRESHOLD = 5;

const logRoomMachineEvent = (
  callId: string | null | undefined,
  eventName: string,
  details: Record<string, unknown> = {},
): void => {
  logger.info(Event.LIVEKIT_ROOM_EVENT, {
    ...details,
    callId: callId ?? null,
    eventName,
  });
};

/**
 * HTTP status behind a rejected API call, when it carried one.
 *
 * Read as a field rather than off a typed error class on purpose: the shared
 * axios instance rewrites every failure into a plain `Error` with `status`
 * attached (see the response interceptor in services/clients/apiClient), so the
 * `ApiError` callService would otherwise construct never reaches a caller.
 * Both shapes expose `status`, so the field is the thing they agree on.
 */
const apiErrorStatus = (error: unknown): number | undefined => {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
};

export interface ParticipantInfo {
  identity: string;
  name?: string;
  isCameraEnabled: boolean;
  isMicrophoneEnabled: boolean;
  isScreenShareEnabled: boolean;
  isLocal: boolean;
  participant?: Participant; // Optional - null in native mode because handled by native app
}

export interface ChatMessage {
  id: string;
  message: string;
  from: {
    identity: string;
    name?: string;
  };
  timestamp: number;
  isLocal: boolean;
}

// Permission error type
export type PermissionErrorType = 'microphone' | 'camera' | 'screen' | null;

// Context for Room state management
// Background blur strength (px). Fixed — no user config (YAGNI).
const BACKGROUND_BLUR_RADIUS = 10;

// Reconcile the camera processor to the latest desired state, one op at a time.
// `setProcessor` is async (awaits WASM/model init) and not registered until it
// resolves; serializing through this chain — and re-reading `desiredBlur` when
// each op actually runs — prevents a rapid toggle from desyncing the flag from
// the real processor state.
let blurReconcileChain: Promise<void> = Promise.resolve();
let desiredBlur = false;

/**
 * Drive the background-blur processor on the local camera track toward `enabled`.
 * Idempotent and serialized, so it can be called on every LOCAL_TRACK_PUBLISHED
 * (join, camera re-enable, device switch) and on rapid toggles without races.
 * Web only: native mode bridges the camera and has no web track to process.
 * `onEnableError` fires if turning blur ON fails, so the caller can revert state.
 */
function syncBackgroundBlur(
  room: Room | null,
  enabled: boolean,
  onEnableError?: () => void,
): Promise<void> {
  desiredBlur = enabled;
  blurReconcileChain = blurReconcileChain.then(async () => {
    const track = room?.localParticipant.getTrackPublication(Track.Source.Camera)?.track as
      | LocalVideoTrack
      | undefined;
    if (!track) return;
    const hasProcessor = !!track.getProcessor();
    try {
      if (desiredBlur && !hasProcessor) {
        await track.setProcessor(BackgroundBlur(BACKGROUND_BLUR_RADIUS));
      } else if (!desiredBlur && hasProcessor) {
        await track.stopProcessor();
      }
    } catch {
      // Only an enable failure leaves a lying "on" state to correct.
      if (desiredBlur) onEnableError?.();
    }
  });
  return blurReconcileChain;
}

export interface RoomContext {
  room: Room | null;
  token: string | null;
  serverUrl: string | null;
  callType: CallType;
  participants: ParticipantInfo[];
  connectionState: ConnectionState;
  error: string | null;
  externalId: string | null;
  zero: Zero | null;
  viewMode: 'mini' | 'full';
  callId: string | null;
  channelId: string | null;
  // The invite URL the current join attempt came from, or null when the join
  // started inside the app. See the JOIN_CALL event and `routeToExternalCallLobby`.
  externalLobbyUrl: string | null;
  scopeType: string | null; // Channel scope type (DM, GROUP_DM, DEFAULT, etc.)
  invitedUserId: string | null;
  conversationId: string | null;
  artifactMessageId: string | null;
  sdlcLink: SdlcCallLink | null;
  targetUserIds: string[];
  roomLink: string | null;
  isChatOpen: boolean;
  chatMessages: ChatMessage[];
  unreadChatCount: number;
  activeCalls: Call[]; // Store all active calls for the user
  isInitiator: boolean; // Track if user initiated vs joined the call
  callStartTime: number | null; // Track when the call started for duration calculation
  isAIAssistantEnabled: boolean; // Track Xyne Automatic state
  transcriptionAgentLeft: boolean; // Track if the transcription agent left mid-call
  isTranscriptionEnabled: boolean; // Host kill-switch: false = agent silenced (audio unsubscribed)
  transcriptionToggleNotice: { enabled: boolean; byName: string } | null; // Drives the toggle toast
  privacyPopoverOpen: boolean; // Shared open-state for the CallPrivacyIndicator popover
  transcriptionPending: boolean; // A host toggle is in-flight, awaiting the agent's confirmation
  aiController: { id: string; name: string } | null;
  pendingControlRequest: { requesterId: string; requesterName: string } | null;
  isAiControlRequested: boolean; // Track if local user has a pending control request
  // Invite dialog state (triggered by AI assistant)
  inviteDialogOpen: boolean;
  inviteUsers: Array<{ id: string; name: string; email: string }>;
  inviteSuggestedMessage: string;
  // Ticket creation dialog state (triggered by AI assistant)
  ticketDialogOpen: boolean;
  ticketTitle: string;
  ticketDescription: string;
  ticketAssignedToName: string | null;
  ticketBoardId: string | null;
  isNativeMode: boolean;
  // Display name for CallKit (DM: participant name, Channel: channel name)
  callDisplayName: string | null;
  permissionError: {
    type: PermissionErrorType;
    dismissed: boolean;
  };
  pushToTalkState: 'idle' | 'active';
  isCallChatOpen: boolean;
  unreadCallChatCount: number;
  hostControls: HostControls;
  // Background blur on the local camera feed (web only). Off by default.
  isBackgroundBlurEnabled: boolean;
  // What a call URL asked for, when the join was driven by one rather than by a
  // person clicking Join (see utils/callUrlOverrides). `null` is the normal case
  // and means "no request": enableLocalTracks falls back to the user's saved join
  // preferences, and failures surface as a toast.
  //
  // Non-null also marks the join as URL-driven, which is what makes it retry on
  // its own and stay silent while doing so — on an unattended display there is
  // nobody to read or dismiss a toast mid-recovery.
  //
  // Carried here rather than read from the URL at the point of use so it stays
  // scoped to one call and clears with the rest of the context on disconnect.
  // Every consumer re-checks the CAC flag before acting on it.
  callUrlOverrides: CallUrlOverrides | null;
}

// Events for Room operations
export type RoomMachineEvent =
  | {
      type: 'CONNECT';
      token: string;
      serverUrl: string;
      callType: CallType;
      externalId: string;
      zero: Zero | null;
    }
  | {
      type: 'INITIATE_CALL';
      channelId?: string;
      scopeType?: string; // Channel scope type for CallKit filtering (DM, GROUP_DM, DEFAULT, etc.)
      callType: CallType;
      targetUserIds?: string[];
      zero: Zero | null;
      callDisplayName?: string; // Display name for CallKit (DM: participant name, Channel: channel name)
      viewMode?: 'mini' | 'full';
      conversationId?: string; // Optional: for thread-initiated calls
      artifactMessageId?: string; // Exact slash-command artifact that owns the call
      sdlcLink?: SdlcCallLink; // Optional: SDLC entity to link the call to
      // Omit for a join a person drove themselves (see RoomContext).
      callUrlOverrides?: CallUrlOverrides;
    }
  | {
      type: 'JOIN_CALL';
      callId: string;
      zero: Zero | null;
      viewMode?: 'mini' | 'full';
      // Omit for a join a person drove themselves (see RoomContext).
      callUrlOverrides?: CallUrlOverrides;
      // Set by the invite-link entry points, and only by them: where to send
      // the user if this call turns out not to be theirs to join.
      externalLobbyUrl?: string;
    }
  | { type: 'TOGGLE_MIC' }
  | { type: 'PUSH_TO_TALK_START' }
  | { type: 'PUSH_TO_TALK_END' }
  | { type: 'TOGGLE_CAMERA' }
  | { type: 'TOGGLE_BACKGROUND_BLUR' }
  | { type: 'SET_BACKGROUND_BLUR'; enabled: boolean }
  | { type: 'TOGGLE_SCREEN_SHARE' }
  | { type: 'SCREEN_SHARE_FAILED' }
  | { type: 'TOGGLE_VIEW' }
  | { type: 'TOGGLE_CHAT' }
  | { type: 'TOGGLE_CALL_CHAT' }
  | { type: 'INCREMENT_UNREAD_CALL_CHAT' }
  | { type: 'TOGGLE_AI_ASSISTANT' }
  | { type: 'ADD_CHAT_MESSAGE'; message: ChatMessage }
  | { type: 'DISCONNECT'; endForAll?: boolean }
  | {
      type: 'CONNECTION_STATE_CHANGED';
      state: ConnectionState;
      disconnectReason?: DisconnectReason;
    }
  | { type: 'PARTICIPANTS_CHANGED' }
  | { type: 'TRACK_SUBSCRIBED'; participant: RemoteParticipant; track: RemoteTrack }
  | { type: 'TRACK_UNSUBSCRIBED'; participant: RemoteParticipant; track: RemoteTrack }
  | { type: 'LOCAL_TRACK_PUBLISHED' }
  | { type: 'LOCAL_TRACK_UNPUBLISHED' }
  | { type: 'ERROR'; error: string }
  | { type: 'UPDATE_ACTIVE_CALLS'; calls: Call[] }
  | { type: 'HOST_CONTROLS_CHANGED'; hostControls: HostControls }
  | {
      type: 'AI_INVITE_ACTION';
      users: AIInviteUser[];
      suggestedMessage: string;
    }
  | { type: 'CLOSE_INVITE_DIALOG' }
  | { type: 'SEND_INVITE'; userIds: string[]; message: string }
  | {
      type: 'AI_CREATE_TICKET_ACTION';
      title: string;
      description: string;
      assignedToName?: string;
      boardId?: string;
    }
  | { type: 'CLOSE_TICKET_DIALOG' }
  | { type: 'TICKET_CREATED' }
  | { type: 'AI_CONTROLLER_CHANGED'; controller: string | null; controllerName: string | null }
  | { type: 'TRANSCRIPTION_AGENT_LEFT' } // LiveKit signalled the agent dropped mid-call
  | { type: 'DISMISS_AGENT_LEFT_WARNING' } // User acknowledged the agent-left toast
  | { type: 'TOGGLE_TRANSCRIPTION' } // Host requested a transcription on/off change (command only)
  | { type: 'TRANSCRIPTION_CONFIRMED'; enabled: boolean } // Agent's authoritative state broadcast
  | { type: 'TRANSCRIPTION_TIMEOUT' } // No agent confirmation within the timeout window
  | { type: 'DISMISS_TRANSCRIPTION_NOTICE' } // User acknowledged the transcription-toggle toast
  | { type: 'SET_PRIVACY_POPOVER'; open: boolean } // Open/close the transcription privacy popover
  | { type: 'SYNC_TRANSCRIPTION_STATE'; enabled: boolean } // Late-joiner sync from room metadata
  | { type: 'AI_CONTROL_REQUEST'; requesterId: string; requesterName: string }
  | { type: 'AI_CONTROL_REQUEST_PENDING'; requesterId: string; requesterName: string }
  | { type: 'AI_CONTROL_REQUEST_SENT' } // Local user sent a control request
  | { type: 'AI_CONTROL_REQUEST_DENIED' } // Local user's request was denied
  | { type: 'APPROVE_CONTROL_REQUEST' }
  | { type: 'DENY_CONTROL_REQUEST' }
  | { type: 'SET_CONVERSATION_ID'; conversationId: string }
  // Permission error events
  | { type: 'PERMISSION_ERROR'; errorType: PermissionErrorType }
  | { type: 'DISMISS_PERMISSION_ERROR' }
  // Native mode events (from React Native bridge)
  | {
      type: 'NATIVE_CONNECTION_STATE';
      state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
    }
  | {
      type: 'NATIVE_PARTICIPANTS_CHANGED';
      participants: Array<{
        identity: string;
        name?: string;
        isCameraEnabled: boolean;
        isMicrophoneEnabled: boolean;
        isScreenShareEnabled: boolean;
        isLocal: boolean;
      }>;
    }
  | { type: 'NATIVE_ERROR'; error: string }
  | {
      type: 'NATIVE_CALL_ENDED';
      callId: string;
      callType: CallType;
      durationMs: number;
      initiatedBy: 'user' | 'callkit' | 'error';
    }
  | { type: 'NATIVE_DISCONNECTED' };

export const roomMachine = setup({
  types: {
    context: {} as RoomContext,
    events: {} as RoomMachineEvent,
  },
  actors: {
    // Actor to create a new call - Uses backend API for LiveKit room
    createCallEntry: fromPromise(
      async ({
        input,
      }: {
        input: {
          channelId?: string;
          callType: CallType;
          targetUserIds?: string[];
          conversationId?: string;
          artifactMessageId?: string;
          sdlcLink?: SdlcCallLink;
        };
      }) => {
        const { channelId, callType, targetUserIds, conversationId, artifactMessageId, sdlcLink } =
          input;

        // Backend now only generates LiveKit credentials, no DB writes
        // If targetUserIds is provided without channelId, backend will find/create DM or group DM channel
        const result = await callService.initiateCall({
          ...(channelId && { channelId }),
          ...(targetUserIds && targetUserIds.length > 0 && { invitedUserIds: targetUserIds }),
          ...(conversationId && { conversationId }),
          ...(artifactMessageId && { artifactMessageId }),
          ...(sdlcLink && { sdlcLink }),
          callType,
        });

        if (result.pending || !result.token) {
          return { pending: true as const };
        }

        return {
          pending: false as const,
          externalId: result.externalId ?? null,
          token: result.token,
          livekitUrl: result.livekitUrl ?? null,
          callType,
          roomLink: result.roomLink ?? null,
          channelId: result.channelId ?? null,
          targetUserIds,
          scopeType: result.scopeType ?? null,
        };
      },
    ),

    // Actor to join call - Uses backend API for LiveKit token generation
    // Handles both regular calls and scheduled calls (backend logic determines behavior)
    joinCall: fromPromise(async ({ input }: { input: { callId: string } }) => {
      const { callId } = input;

      // Backend now only generates LiveKit credentials, no DB writes
      // For scheduled calls, backend creates room if it doesn't exist yet
      const result = await callService.joinCall({ callId });

      // No token means the host must admit this user.
      if (result.pending || !result.token) {
        return { pending: true as const };
      }

      return {
        pending: false as const,
        externalId: result.externalId ?? callId,
        token: result.token,
        livekitUrl: result.livekitUrl ?? '',
        callId: callId, // Pass through the externalId for DB writes
        roomLink: result.roomLink ?? null,
        channelId: result.channelId ?? null,
        scopeType: result.scopeType ?? null,
      };
    }),

    // Room event listener - continuously listens to Room events and sends them to the machine
    roomEventListener: fromCallback(
      ({
        sendBack,
        input,
      }: {
        sendBack: (event: RoomMachineEvent) => void;
        input: { room: Room; callId: string };
      }) => {
        const { room, callId } = input;
        let agentLeftTimer: ReturnType<typeof setTimeout> | null = null;

        const clearAgentLeftTimer = (): void => {
          if (agentLeftTimer) {
            clearTimeout(agentLeftTimer);
            agentLeftTimer = null;
          }
        };

        const confirmAgentLeft = (): void => {
          clearAgentLeftTimer();
          agentLeftTimer = setTimeout(() => {
            agentLeftTimer = null;
            if (shouldConfirmTranscriptionAgentLeft(room)) {
              sendBack({ type: 'TRANSCRIPTION_AGENT_LEFT' });
            }
          }, AGENT_LEFT_CONFIRM_DELAY_MS);
        };

        // Helper to update participants
        const updateParticipants = (): void => {
          sendBack({ type: 'PARTICIPANTS_CHANGED' });
        };

        const syncHostControls = (metadata?: string) => {
          if (!metadata) return;
          const hostControls = parseHostControlsFromMetadata(metadata, callId);
          if (hostControls) {
            sendBack({
              type: 'HOST_CONTROLS_CHANGED',
              hostControls,
            });
          }
        };

        // Late-joiner sync: the host's transcription on/off state is mirrored into room
        // metadata by the backend (data messages don't reach participants who join later).
        const syncTranscriptionState = (metadata?: string) => {
          if (!metadata) return;
          try {
            const parsed = JSON.parse(metadata) as { transcriptionEnabled?: unknown };
            if (typeof parsed.transcriptionEnabled === 'boolean') {
              sendBack({ type: 'SYNC_TRANSCRIPTION_STATE', enabled: parsed.transcriptionEnabled });
            }
          } catch {
            // ignore malformed metadata
          }
        };

        // Connection events
        room.on(LiveKitRoomEvent.Connected, () => {
          sendBack({ type: 'CONNECTION_STATE_CHANGED', state: ConnectionState.Connected });
          updateParticipants();
          syncHostControls(room.metadata);
          syncTranscriptionState(room.metadata);
        });

        room.on(LiveKitRoomEvent.RoomMetadataChanged, (metadata: string) => {
          syncHostControls(metadata);
          syncTranscriptionState(metadata);
          updateParticipants();
        });

        // Listener mounts after connect; sync current metadata once.
        syncHostControls(room.metadata);
        syncTranscriptionState(room.metadata);
        updateParticipants();

        // Same for connection state: the Connected event fired before this listener
        // existed, so seed from room.state instead of waiting for the next event.
        sendBack({ type: 'CONNECTION_STATE_CHANGED', state: room.state });

        room.on(LiveKitRoomEvent.Reconnecting, () => {
          sendBack({ type: 'CONNECTION_STATE_CHANGED', state: ConnectionState.Reconnecting });
        });

        room.on(LiveKitRoomEvent.Reconnected, () => {
          sendBack({ type: 'CONNECTION_STATE_CHANGED', state: ConnectionState.Connected });
        });

        room.on(LiveKitRoomEvent.Disconnected, (reason?: DisconnectReason) => {
          clearAgentLeftTimer();
          logger.info(Event.LIVEKIT_ROOM_DISCONNECTED, {
            callId,
          });
          sendBack({
            type: 'CONNECTION_STATE_CHANGED',
            state: ConnectionState.Disconnected,
            ...(reason !== undefined && { disconnectReason: reason }),
          });
        });

        // Participant events
        room.on(LiveKitRoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
          logger.info(Event.LIVEKIT_PARTICIPANT_DISCONNECTED, {
            callId,
            participantIdentity: participant.identity,
          });
          updateParticipants();
          if (isTranscriptionAgentIdentity(participant.identity)) {
            confirmAgentLeft();
          }
          playAudio(AUDIO_PATHS.CALL_EXIT);
        });

        // Track events
        room.on(
          LiveKitRoomEvent.TrackSubscribed,
          (
            track: RemoteTrack,
            publication: RemoteTrackPublication,
            participant: RemoteParticipant,
          ) => {
            logger.info(Event.LIVEKIT_TRACK_SUBSCRIBED, {
              callId,
              participantIdentity: participant.identity,
              trackSource: publication.source?.toString() ?? 'unknown',
              trackKind: track.kind,
              trackSid: publication.trackSid,
              isMuted: publication.isMuted,
              isSubscribed: publication.isSubscribed,
            });
            updateParticipants();
            sendBack({ type: 'TRACK_SUBSCRIBED', participant, track });
          },
        );

        room.on(
          LiveKitRoomEvent.TrackUnsubscribed,
          (
            track: RemoteTrack,
            publication: RemoteTrackPublication,
            participant: RemoteParticipant,
          ) => {
            logger.info(Event.LIVEKIT_TRACK_UNSUBSCRIBED, {
              callId,
              participantIdentity: participant.identity,
              trackSource: publication.source?.toString() ?? 'unknown',
              trackKind: track.kind,
              trackSid: publication.trackSid,
            });
            updateParticipants();
            sendBack({ type: 'TRACK_UNSUBSCRIBED', participant, track });
          },
        );

        // Remote track published (before subscription)
        room.on(
          LiveKitRoomEvent.TrackPublished,
          (publication: RemoteTrackPublication, participant: RemoteParticipant) => {
            logger.info(Event.LIVEKIT_TRACK_PUBLISHED, {
              callId,
              participantIdentity: participant.identity,
              trackSource: publication.source?.toString() ?? 'unknown',
              trackKind: publication.kind,
              trackSid: publication.trackSid,
              isSubscribed: publication.isSubscribed,
              isMuted: publication.isMuted,
            });
          },
        );

        room.on(
          LiveKitRoomEvent.TrackUnpublished,
          (publication: RemoteTrackPublication, participant: RemoteParticipant) => {
            logger.info(Event.LIVEKIT_TRACK_UNSUBSCRIBED, {
              callId,
              participantIdentity: participant.identity,
              trackSource: publication.source?.toString() ?? 'unknown',
              trackKind: publication.kind,
              trackSid: publication.trackSid,
            });
            updateParticipants();
          },
        );

        // Track subscription failed
        room.on(
          LiveKitRoomEvent.TrackSubscriptionFailed,
          (trackSid: string, participant: RemoteParticipant, reason?: SubscriptionError) => {
            logger.error(Event.LIVEKIT_TRACK_SUBSCRIPTION_FAILED, {
              callId,
              participantIdentity: participant.identity,
              trackSid,
              reason: reason?.toString() ?? 'unknown',
            });
          },
        );

        room.on(LiveKitRoomEvent.LocalTrackPublished, (publication: LocalTrackPublication) => {
          logger.info(Event.LIVEKIT_TRACK_PUBLISHED, {
            callId,
            participantIdentity: room.localParticipant.identity,
            trackSource: publication.source?.toString() ?? 'unknown',
            trackKind: publication.kind,
            trackSid: publication.trackSid,
            isLocal: true,
          });
          updateParticipants();
          sendBack({ type: 'LOCAL_TRACK_PUBLISHED' });
        });

        room.on(LiveKitRoomEvent.LocalTrackUnpublished, (publication: LocalTrackPublication) => {
          logger.info(Event.LIVEKIT_TRACK_UNSUBSCRIBED, {
            callId,
            participantIdentity: room.localParticipant.identity,
            trackSource: publication.source?.toString() ?? 'unknown',
            trackKind: publication.kind,
            trackSid: publication.trackSid,
            isLocal: true,
          });
          updateParticipants();
          sendBack({ type: 'LOCAL_TRACK_UNPUBLISHED' });
        });

        // Track muted/unmuted events
        room.on(
          LiveKitRoomEvent.TrackMuted,
          (publication: TrackPublication, participant: Participant) => {
            logger.info(Event.LIVEKIT_TRACK_MUTE_CHANGED, {
              callId,
              participantIdentity: participant.identity,
              trackSource: publication.source?.toString() ?? 'unknown',
              trackSid: publication.trackSid,
              isMuted: true,
            });
            updateParticipants();
          },
        );
        room.on(
          LiveKitRoomEvent.TrackUnmuted,
          (publication: TrackPublication, participant: Participant) => {
            logger.info(Event.LIVEKIT_TRACK_MUTE_CHANGED, {
              callId,
              participantIdentity: participant.identity,
              trackSource: publication.source?.toString() ?? 'unknown',
              trackSid: publication.trackSid,
              isMuted: false,
            });
            updateParticipants();
          },
        );

        // Participant connected
        room.on(LiveKitRoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
          if (isTranscriptionAgentIdentity(participant.identity)) {
            clearAgentLeftTimer();
          }
          updateParticipants();
          playAudio(AUDIO_PATHS.PARTICIPANT_JOIN);
        });

        // Error handling - use MediaDeviceFailure.getFailure() for reliable error classification
        room.on(LiveKitRoomEvent.MediaDevicesError, (error: Error, kind?: MediaDeviceKind) => {
          const failure = MediaDeviceFailure.getFailure(error);
          let permissionType: PermissionErrorType = null;

          // Use kind parameter (added in livekit-client v2.13.1) to determine which device failed
          if (kind === 'audioinput') {
            permissionType = 'microphone';
          } else if (kind === 'videoinput') {
            permissionType = 'camera';
          } else if (!kind && failure === MediaDeviceFailure.PermissionDenied) {
            // Screen share errors often have undefined kind since getDisplayMedia doesn't use MediaDeviceKind
            permissionType = 'screen';
          }

          // Send permission error event if we detected a permission issue
          if (permissionType) {
            sendBack({ type: 'PERMISSION_ERROR', errorType: permissionType });
          }

          // Also send generic error for logging/debugging with failure type
          sendBack({ type: 'ERROR', error: `[${failure ?? 'Unknown'}] ${error.message}` });
        });

        // Unified handler for AI data channel messages
        room.on(
          LiveKitRoomEvent.DataReceived,
          (
            payload: Uint8Array,
            _participant?: RemoteParticipant,
            _kind?: unknown,
            _topic?: string,
          ) => {
            // Decode the payload
            const data = decodeDataPayload(payload);
            if (!data) return;

            // Parse into AI event using shared parser
            const event: AIEvent | null = parseAIDataMessage(data);
            if (!event) return;

            // Handle different AI event types
            switch (event.type) {
              case 'AI_INVITE':
                // Only process on 'ai-actions' topic
                if (_topic === AI_DATA_TOPIC && event.type === 'AI_INVITE') {
                  sendBack({
                    type: 'AI_INVITE_ACTION',
                    users: event.users,
                    suggestedMessage: event.suggestedMessage,
                  } as const);
                }
                break;

              case 'AI_CREATE_TICKET':
                // Only process on 'ai-actions' topic
                if (_topic === AI_DATA_TOPIC && event.type === 'AI_CREATE_TICKET') {
                  sendBack({
                    type: 'AI_CREATE_TICKET_ACTION',
                    title: event.title,
                    description: event.description,
                    ...(event.assignedToName && { assignedToName: event.assignedToName }),
                    ...(event.boardId && { boardId: event.boardId }),
                  } as const);
                }
                break;

              case 'AI_CONTROLLER_CHANGED':
                if (event.type === 'AI_CONTROLLER_CHANGED') {
                  sendBack({
                    type: 'AI_CONTROLLER_CHANGED',
                    controller: event.controller,
                    controllerName: event.controllerName,
                  } as const);
                }
                break;

              case 'AI_CONTROL_REQUEST':
                if (event.type === 'AI_CONTROL_REQUEST') {
                  sendBack({
                    type: 'AI_CONTROL_REQUEST',
                    requesterId: event.requesterId,
                    requesterName: event.requesterName,
                  } as const);
                }
                break;

              case 'AI_CONTROL_REQUEST_DENIED':
                if (event.type === 'AI_CONTROL_REQUEST_DENIED') {
                  sendBack({
                    type: 'AI_CONTROL_REQUEST_DENIED',
                  } as const);
                }
                break;

              case 'AI_TRANSCRIPTION_STATE':
                // The AGENT's authoritative state broadcast. Only the agent (a trusted,
                // LiveKit-authenticated identity) may drive the client's privacy state, so
                // the UI never shows "off" unless the agent actually stopped. The raw
                // `transcription_toggle` command is intentionally NOT reflected here — a
                // peer could otherwise spoof "off" while the agent keeps capturing.
                if (
                  _topic === AI_DATA_TOPIC &&
                  event.type === 'AI_TRANSCRIPTION_STATE' &&
                  !!_participant?.identity &&
                  isTranscriptionAgentIdentity(_participant.identity)
                ) {
                  sendBack({ type: 'TRANSCRIPTION_CONFIRMED', enabled: event.enabled } as const);
                }
                break;
            }
          },
        );

        // Debug: Log ALL LiveKit events
        // This ensures we catch any unhandled events for debugging purposes
        Object.values(LiveKitRoomEvent).forEach(eventName => {
          room.on(eventName, (...args: unknown[]) => {
            // Filter out DataReceived as it can be very noisy and we have specific handling
            if (eventName === LiveKitRoomEvent.DataReceived) return;

            // Filter out ActiveSpeakersChanged as it is very frequent
            if (eventName === LiveKitRoomEvent.ActiveSpeakersChanged) return;

            // Simplify arguments for logging (avoid circular references in Room/Participant objects if possible)
            // We just log the event name and validity of args for now, or simple primitives
            // Safe logging of args
            const safeArgs = args.map(arg => {
              if (typeof arg === 'object' && arg !== null && !Array.isArray(arg)) {
                // Return generic type/id if available, otherwise just "object"
                const record = arg as Record<string, unknown>;
                const constructor = record['constructor'] as { name?: string } | undefined;
                const constructorName = constructor?.name ?? 'Object';

                if ('sid' in record && typeof record['sid'] === 'string') {
                  return { sid: record['sid'], type: constructorName };
                }
                if ('identity' in record && typeof record['identity'] === 'string') {
                  return { identity: record['identity'], type: constructorName };
                }
                if ('id' in record && typeof record['id'] === 'string') {
                  return { id: record['id'], type: constructorName };
                }
                return { type: constructorName };
              }
              return arg;
            });

            logger.info(Event.LIVEKIT_ROOM_EVENT, {
              callId,
              eventName,
              args: safeArgs,
            });
          });
        });

        // Cleanup
        return (): void => {
          clearAgentLeftTimer();
          room.removeAllListeners();
        };
      },
    ),

    connectToRoom: fromPromise(
      async ({
        input,
      }: {
        input: {
          room: Room;
          token: string;
          serverUrl: string;
          callType: CallType;
          externalId: string;
          roomLink?: string;
          isNativeMode: boolean;
          channelId?: string | null;
          conversationId?: string | null;
          callDisplayName?: string | null;
          scopeType?: string | null; // Channel scope type for CallKit filtering
        };
      }) => {
        const {
          room,
          token,
          serverUrl,
          callType,
          externalId,
          roomLink,
          isNativeMode,
          channelId,
          conversationId,
          callDisplayName,
          scopeType,
        } = input;

        // If in native mode, send connect command to React Native bridge and wait for connection
        if (isNativeMode) {
          // Use pre-computed callDisplayName from context (computed by UI components using useChannelDisplayName hook)
          // For DM: participant name, for channels: channel name
          const callerName = callDisplayName || undefined;

          logRoomMachineEvent(externalId, 'callkit_display_name_resolved', {
            callerName,
            channelId,
            conversationId,
          });

          reactNativeBridge.livekitConnect({
            token,
            serverUrl,
            callType: callType,
            externalId,
            ...(roomLink && { roomLink }),
            ...(callerName && { callerName }),
            ...(channelId && { channelId }),
            ...(conversationId && { conversationId }),
            ...(scopeType && { scopeType }),
          });

          // Wait for native connection state to become 'connected'
          return new Promise<void>((resolve, reject) => {
            let hasStartedConnecting = false;

            const timeout = setTimeout(() => {
              unsubscribe();
              reject(new Error('Native LiveKit connection timed out'));
            }, 15000); // 15 second timeout (reduced from 30s for better UX)

            const unsubscribe = reactNativeBridge.on('LIVEKIT_CONNECTION_STATE', message => {
              const state = message.payload?.state;
              logRoomMachineEvent(externalId, 'native_connection_state_changed', {
                state,
              });

              if (state === 'connecting' || state === 'reconnecting') {
                hasStartedConnecting = true;
              } else if (state === 'connected') {
                clearTimeout(timeout);
                unsubscribe();
                resolve();
              } else if (state === 'disconnected' && hasStartedConnecting) {
                // Only reject on disconnected if we had started connecting
                // (ignore initial disconnected state before connection attempt)
                clearTimeout(timeout);
                unsubscribe();
                reject(new Error('Native LiveKit connection failed'));
              }
            });

            // Also listen for errors
            const unsubError = reactNativeBridge.on('LIVEKIT_ERROR', message => {
              clearTimeout(timeout);
              unsubscribe();
              unsubError();
              reject(new Error(message.payload?.error ?? 'Native LiveKit error'));
            });
          });
        }

        // Web mode - connect directly using livekit-client
        const options: RoomConnectOptions = {
          autoSubscribe: true,
          websocketTimeout: 8000,
          peerConnectionTimeout: 8000,
        };

        const MAX_RETRIES = 5;

        let lastError: Error | null = null;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            logRoomMachineEvent(externalId, 'connection_attempt_started', {
              attempt: attempt + 1,
              maxRetries: MAX_RETRIES,
            });

            await room.connect(serverUrl, token, options);

            logRoomMachineEvent(externalId, 'connection_succeeded', {
              attempt: attempt + 1,
            });
            return; // Success!
          } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            logger.error(Event.LIVEKIT_ROOM_EVENT, {
              callId: externalId,
              eventName: 'connection_attempt_failed',
              attempt: attempt + 1,
              maxRetries: MAX_RETRIES,
              error: lastError.message,
            });

            // Don't retry on the last attempt
            if (attempt < MAX_RETRIES - 1) {
              logRoomMachineEvent(externalId, 'connection_retry_scheduled', {
                nextAttempt: attempt + 2,
                maxRetries: MAX_RETRIES,
              });
            }
          }
        }

        // All retries failed
        logger.error(Event.LIVEKIT_ROOM_EVENT, {
          callId: externalId,
          eventName: 'all_connection_attempts_failed',
          maxRetries: MAX_RETRIES,
          error: lastError?.message ?? 'Unknown connection error',
        });
        throw lastError || new Error('Failed to connect to room after multiple attempts');
      },
    ),

    disconnectAndCleanup: fromPromise(
      async ({
        input,
      }: {
        input: {
          room: Room | null;
          externalId: string | null;
          zero: Zero | null;
          isNativeMode: boolean;
          endForAll: boolean;
        };
      }) => {
        const { room, externalId, isNativeMode, endForAll } = input;

        logRoomMachineEvent(externalId, 'disconnect_cleanup_started', {
          hasRoom: !!room,
          isNativeMode,
          endForAll,
        });

        try {
          // If ending call for all, call the API first
          if (endForAll && externalId) {
            try {
              await callService.endCallForAll(externalId);
            } catch (error) {
              logger.error(Event.API_CALL_FAILED, {
                callId: externalId,
                context: 'roomMachine.disconnectAndCleanup.endForAll',
                error: error instanceof Error ? error.message : String(error),
              });
              // Continue with disconnect even if API call fails
            }
          }

          // If in native mode, send disconnect to React Native bridge
          if (isNativeMode) {
            logRoomMachineEvent(externalId, 'native_disconnect_sent');
            reactNativeBridge.livekitDisconnect();
            logRoomMachineEvent(externalId, 'disconnect_cleanup_completed', {
              mode: 'native',
            });
            return;
          }

          // Web mode - disconnect directly
          if (room) {
            logger.info(Event.LIVEKIT_ROOM_DISCONNECTED, {
              callId: externalId,
            });
            await room.disconnect();
            room.removeAllListeners();
          }

          await new Promise(resolve => setTimeout(resolve, 200));

          logRoomMachineEvent(externalId, 'disconnect_cleanup_completed', {
            mode: 'web',
          });
        } catch (error) {
          logger.error(Event.LIVEKIT_ROOM_EVENT, {
            callId: externalId,
            eventName: 'disconnect_cleanup_failed',
            error: error instanceof Error ? error.message : String(error),
          });
          // Don't rethrow - we want to transition to idle even on error
        }
      },
    ),

    // Native bridge event listener - receives events from React Native
    nativeBridgeEventListener: fromCallback(
      ({
        sendBack,
        input,
      }: {
        sendBack: (event: RoomMachineEvent) => void;
        input: { callId: string | null };
      }) => {
        const { callId } = input;
        logRoomMachineEvent(callId, 'native_bridge_listener_started');

        const unsubConnectionState = reactNativeBridge.on('LIVEKIT_CONNECTION_STATE', message => {
          logRoomMachineEvent(callId, 'native_connection_state_received', {
            state: message.payload?.state,
          });
          sendBack({
            type: 'NATIVE_CONNECTION_STATE',
            state: message.payload?.state ?? 'disconnected',
          });
        });

        const unsubParticipants = reactNativeBridge.on('LIVEKIT_PARTICIPANTS_CHANGED', message => {
          sendBack({
            type: 'NATIVE_PARTICIPANTS_CHANGED',
            participants: message.payload?.participants ?? [],
          });
        });

        const unsubError = reactNativeBridge.on('LIVEKIT_ERROR', message => {
          logRoomMachineEvent(callId, 'native_error_received', {
            error: message.payload?.error,
          });
          sendBack({ type: 'NATIVE_ERROR', error: message.payload?.error ?? 'Unknown error' });
        });

        const unsubCallEnded = reactNativeBridge.on('LIVEKIT_CALL_ENDED', message => {
          logRoomMachineEvent(message.payload?.callId ?? callId, 'native_call_ended_received', {
            payload: message.payload,
          });
          if (message.payload) {
            sendBack({
              type: 'NATIVE_CALL_ENDED',
              callId: message.payload.callId,
              callType: message.payload.callType,
              durationMs: message.payload.durationMs,
              initiatedBy: message.payload.initiatedBy,
            });
          }
        });

        return (): void => {
          logRoomMachineEvent(callId, 'native_bridge_listener_stopped');
          unsubConnectionState();
          unsubParticipants();
          unsubError();
          unsubCallEnded();
        };
      },
    ),
  },
  actions: {
    createRoom: assign({
      room: () => {
        // Check dynamically - context.isNativeMode is stale from module init
        if (isNativeCallSupported()) {
          return null;
        }

        const mediaQualitySettings = getCallMediaQualitySettings();
        const videoQuality = CALL_MEDIA_QUALITY_CONFIG[mediaQualitySettings.videoQuality];
        const screenShareQuality =
          CALL_MEDIA_QUALITY_CONFIG[mediaQualitySettings.screenShareQuality];

        const room = new Room({
          adaptiveStream: false,
          dynacast: true,
          videoCaptureDefaults: {
            resolution: {
              width: videoQuality.width,
              height: videoQuality.height,
              frameRate: videoQuality.frameRate,
            },
          },
          audioCaptureDefaults: {
            autoGainControl: true,
            echoCancellation: true,
            noiseSuppression: true,
          },
          publishDefaults: {
            screenShareEncoding: {
              maxBitrate: screenShareQuality.maxBitrate,
              maxFramerate: screenShareQuality.frameRate,
              priority: 'high',
            },
            // Maintain resolution over framerate for screen sharing
            degradationPreference: 'maintain-resolution',
          },
        });
        return room;
      },
    }),

    updateParticipants: assign({
      participants: ({ context }) => {
        const room = context.room;
        if (!room) return [];

        const participantList: ParticipantInfo[] = [];

        // Add local participant
        const localParticipant = room.localParticipant;
        participantList.push({
          identity: localParticipant.identity,
          name: localParticipant.name || 'You',
          isCameraEnabled: localParticipant.isCameraEnabled,
          isMicrophoneEnabled: localParticipant.isMicrophoneEnabled,
          isScreenShareEnabled: isParticipantScreenShareEnabled(localParticipant),
          isLocal: true,
          participant: localParticipant,
        });

        // Add remote participants
        room.remoteParticipants.forEach((participant: RemoteParticipant) => {
          participantList.push({
            identity: participant.identity,
            name: participant.name || participant.identity,
            isCameraEnabled: participant.isCameraEnabled ?? false,
            isMicrophoneEnabled: participant.isMicrophoneEnabled ?? false,
            isScreenShareEnabled: isParticipantScreenShareEnabled(participant),
            isLocal: false,
            participant: participant,
          });
        });

        return participantList;
      },
    }),

    updateConnectionState: assign({
      connectionState: ({ event }) =>
        event.type === 'CONNECTION_STATE_CHANGED' ? event.state : ConnectionState.Disconnected,
    }),

    showDisconnectedToast: ({ event }) => {
      if (event.type !== 'CONNECTION_STATE_CHANGED') return;
      const reason = event.disconnectReason;

      // We disconnected ourselves - the user already knows.
      if (reason === DisconnectReason.CLIENT_INITIATED) return;

      if (reason === DisconnectReason.ROOM_DELETED || reason === DisconnectReason.ROOM_CLOSED) {
        toast.info('Call ended', {
          description: 'This call has ended',
          duration: 5000,
        });
        return;
      }

      toast.error('Disconnected from call', {
        description: 'Your connection to the call was lost. Rejoin to continue.',
        duration: 6000,
      });
    },

    setError: assign({
      error: ({ event }) => (event.type === 'ERROR' ? event.error : null),
    }),

    clearError: assign({
      error: () => null,
    }),

    setPermissionError: assign({
      permissionError: ({ event }) => ({
        type: event.type === 'PERMISSION_ERROR' ? event.errorType : null,
        dismissed: false,
      }),
    }),

    showPermissionErrorToast: ({ event }) => {
      if (event.type === 'PERMISSION_ERROR' && event.errorType) {
        const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

        // In web, cancelling the native screen picker fires the same NotAllowedError
        // as a real denial — don't show a toast for screen in non-Electron environments.
        if (event.errorType === 'screen' && !isElectron) return;

        const deviceName =
          event.errorType === 'microphone'
            ? 'Microphone'
            : event.errorType === 'camera'
              ? 'Camera'
              : 'Screen recording';
        const settingsUrl = MACOS_PRIVACY_URLS[event.errorType];

        toast.error(`${deviceName} access is blocked`, {
          description: 'Please allow access in your system settings and reload.',
          duration: 6000,
          action:
            isElectron && settingsUrl
              ? {
                  label: 'Open Settings',
                  onClick: () => {
                    void window.electronAPI?.openExternal?.(settingsUrl);
                  },
                }
              : undefined,
        });
      }
    },

    dismissPermissionError: assign({
      permissionError: ({ context }) => ({
        ...context.permissionError,
        dismissed: true,
      }),
    }),

    storeConnectionParams: assign({
      token: ({ event }) => (event.type === 'CONNECT' ? event.token : null),
      serverUrl: ({ event }) => (event.type === 'CONNECT' ? event.serverUrl : null),
      callType: ({ event }) => (event.type === 'CONNECT' ? event.callType : CallType.VIDEO),
      externalId: ({ event }) => (event.type === 'CONNECT' ? event.externalId : null),
      zero: ({ event }) => (event.type === 'CONNECT' ? event.zero : null),
    }),

    cleanupRoom: ({ context }) => {
      if (context.room) {
        void context.room.disconnect();
        context.room.removeAllListeners();
      }
    },

    clearContext: assign({
      room: () => null,
      token: () => null,
      serverUrl: () => null,
      participants: () => [],
      connectionState: () => ConnectionState.Disconnected,
      error: () => null,
      callId: () => null,
      channelId: () => null,
      externalId: () => null,
      externalLobbyUrl: () => null,
      invitedUserId: () => null,
      conversationId: () => null,
      artifactMessageId: () => null,
      targetUserIds: () => [],
      roomLink: () => null,
      isChatOpen: () => false,
      chatMessages: () => [],
      unreadChatCount: () => 0,
      viewMode: () => 'mini' as const, // Reset to default mini view
      isInitiator: () => false,
      callStartTime: () => null,
      isAIAssistantEnabled: () => false,
      transcriptionAgentLeft: () => false,
      isTranscriptionEnabled: () => true,
      transcriptionToggleNotice: () => null,
      privacyPopoverOpen: () => false,
      transcriptionPending: () => false,
      aiController: () => null,
      pendingControlRequest: () => null,
      isAiControlRequested: () => false,
      inviteDialogOpen: () => false,
      inviteUsers: () => [],
      inviteSuggestedMessage: () => '',
      ticketDialogOpen: () => false,
      ticketTitle: () => '',
      ticketDescription: () => '',
      ticketAssignedToName: () => null,
      ticketBoardId: () => null,
      permissionError: () => ({ type: null as PermissionErrorType, dismissed: false }),
      isCallChatOpen: () => false,
      unreadCallChatCount: () => 0,
      isBackgroundBlurEnabled: () => false,
      hostControls: () => DEFAULT_HOST_CONTROLS,
      callUrlOverrides: () => null,
    }),

    enableLocalTracks: ({ context }) => {
      if (context.room) {
        const enableTracksAndSelectDevices = async (): Promise<void> => {
          try {
            const { joinMuted, joinWithoutVideo } = getCallJoinSettings();
            const metadataHostControls = context.room!.metadata
              ? parseHostControlsFromMetadata(
                  context.room!.metadata,
                  context.externalId ?? context.callId,
                )
              : null;
            const effectiveHostControls = metadataHostControls ?? context.hostControls;

            const alreadyJoinedCount = context.room!.remoteParticipants.size;
            const shouldMuteByDefault = alreadyJoinedCount > DEFAULT_MUTE_THRESHOLD;
            const audioTurnedOffByHost = isHostControlTurnedOffForLocalWithControls(
              context,
              effectiveHostControls,
              'turnOffAudio',
            );
            const cameraTurnedOffByHost = isHostControlTurnedOffForLocalWithControls(
              context,
              effectiveHostControls,
              'turnOffCamera',
            );

            // The CAC flag is re-checked here, at the point the override is acted
            // on, rather than being trusted from whoever sent the event: the hook
            // that reads the URL gates entry, and this gates effect. A caller that
            // sets callUrlOverrides without the flag gets the saved preferences,
            // exactly as if it had asked for nothing.
            const urlOverrides = isCallUrlApiAllowed() ? context.callUrlOverrides : null;

            // Precedence, strongest first:
            //   1. host controls — never overridable by anyone but the host
            //   2. an explicit request from the call URL (e.g. ?mic=on), once the
            //      flag above allows it
            //   3. the user's saved join preferences + the crowded-room mute threshold
            // Applying (2) here rather than toggling after 'connected' is deliberate:
            // this action is the single writer of the initial track state, so there is
            // no window where a post-connect compare-and-toggle could read a value
            // these very awaits are about to overwrite and end up inverted.
            const enableMic =
              !audioTurnedOffByHost && (urlOverrides?.mic ?? (!joinMuted && !shouldMuteByDefault));

            const enableCamera =
              !cameraTurnedOffByHost && (urlOverrides?.camera ?? !joinWithoutVideo);

            await context.room!.localParticipant.setMicrophoneEnabled(enableMic);

            await context.room!.localParticipant.setCameraEnabled(enableCamera);

            // Always select default audio devices regardless of mute state
            await context.room!.switchActiveDevice('audioinput', 'default');
            await context.room!.switchActiveDevice('audiooutput', 'default');
          } catch {
            // Fail silently - error will be handled by MediaDevicesError event listener
          }
        };

        // Fire and forget, but properly sequenced
        void enableTracksAndSelectDevices();
      }
    },

    /**
     * Hand a call this session cannot see over to the guest lobby.
     *
     * Calls are read through the tenant ACL, so one belonging to another
     * workspace is not "forbidden" to /calls/join — it is absent, and comes
     * back 404 (403 when the workspace check catches it after a recurring-series
     * hop). The person holding the link is not necessarily a stranger to it,
     * though: they may be a member of that other workspace. The lobby is what
     * settles that, so the invite URL they arrived on is where they go.
     *
     * In a new tab, and only ever a new tab: the workspace they are working in
     * is not the one the call lives in, and joining someone else's call is no
     * reason to tear them out of it. `openLink` is the app's one external-link
     * path, so this picks up the Electron and React Native handling for free.
     */
    routeToExternalCallLobby: ({ context }) => {
      if (!context.externalLobbyUrl) return;
      openLink(context.externalLobbyUrl, null, { force: 'external' });
    },

    showJoinCallErrorToast: ({ context }) => {
      if (context.callUrlOverrides) return;
      toast.error('Failed to join call', {
        description: 'Unable to connect to the room. Please try again.',
        duration: 4000,
      });
    },
    // Sync the background-blur processor with context flag (web only).
    // If enabling fails (e.g. WASM/model load), revert the flag so the toggle
    // doesn't lie, and tell the user.
    applyBackgroundBlur: ({ context, self }) => {
      if (context.isNativeMode) return;
      void syncBackgroundBlur(context.room, context.isBackgroundBlurEnabled, () => {
        self.send({ type: 'SET_BACKGROUND_BLUR', enabled: false });
        toast.error('Could not enable background blur');
      });
    },
    enforceHostControls: ({ context }) => {
      const audioTurnedOffByHost = isHostControlTurnedOffForLocal(context, 'turnOffAudio');
      const cameraTurnedOffByHost = isHostControlTurnedOffForLocal(context, 'turnOffCamera');
      const screenShareTurnedOffByHost = isHostControlTurnedOffForLocal(
        context,
        'turnOffScreenShare',
      );

      if (!context.isNativeMode) {
        const localParticipant = context.room?.localParticipant;
        if (audioTurnedOffByHost && localParticipant?.isMicrophoneEnabled) {
          void localParticipant.setMicrophoneEnabled(false);
        }
        if (cameraTurnedOffByHost && localParticipant?.isCameraEnabled) {
          void localParticipant.setCameraEnabled(false);
        }
        if (screenShareTurnedOffByHost && localParticipant?.isScreenShareEnabled) {
          void localParticipant?.setScreenShareEnabled(false);
        }
        return;
      }

      const localParticipant = context.participants.find(p => p.isLocal);
      if (audioTurnedOffByHost && localParticipant?.isMicrophoneEnabled) {
        reactNativeBridge.livekitToggleMic(false);
      }
      if (cameraTurnedOffByHost && localParticipant?.isCameraEnabled) {
        reactNativeBridge.livekitToggleCamera(false);
      }
      if (screenShareTurnedOffByHost && localParticipant?.isScreenShareEnabled) {
        reactNativeBridge.livekitToggleScreenShare(false);
      }
    },
    showRequestingAdmissionToast: () => {
      toast.info('Requesting to join', {
        description: 'Waiting for the host to let you in.',
        duration: 4000,
      });
    },
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QCcD2qC2BZAhgYwAsBLAOzADoIjY9USy8AXSAYgGEB5AOS4FE2AKgG0ADAF1EoAA6pYRRkTqSQAD0QBWAIwAOcgHZtAThEA2E5r2aATNYDMAGhABPRNpPr9VgCwj1JrwEi2tqaAL6hjmiYuISkFLT0YEykUCwQdBSkAG6oANYUUdj4xGTkCQwKJFAI2ah4OAp0omLNyjJyjSTKagiGeobktrbqhlqmvlbq6o4uCJo6urb+JtpW5np+k+GR6EWxpeVJlalgyGjI5FIANg0AZqjIGOSFMSXxdBUpNSQ59Z3NrSQIHa8kUXSBPXUthE5C82i8tgM2j0ehEIkMVhmiE0Ik0JnIQVsCPmejMVnJ2xAL2KcTKHyOrAAIgBJADKnB4-GE4jaslBSgh2K8-XIbj0NjhekCIi8WLmVlM5CsISJhmsIls5O0lOp+3eiSYrAEHAA4iaADK8AD6WGZbEB0j5nW62MmXgJXishjVawVmnUejlOJWouV5Os6islhlOt2r1ph0NEBYxrNlqtbAAglheAAlTMO4FOsEu+VLcgWdTaUz9KaaWzaOV9KyDDZBdQ+KPt2PRGkHelJlOmi3W9m53i8LhW1kACUz48LIOdgvl6MGhnhfhMKLWHblyI8GM0hi8o0jqPcPb2bzpBuYyY5fEEzO404EmYE1rYc64Jt4jMXYsBVAHp5m0WxYU0HxVk2KsjDlFEBi8FYVVRLtkKveN+zvVgAAV5wEO1mXwrgBFZDMfz-ACeSBJcSxXdU9FhSZq1RSxhncOUVgg3E-BRbRzxELYIipOM+31CojXzNgAGlpwAVQAITHZlFP-QCOnokDXUmUUTCGIT3ARSMHGcDQ3HIWDPTRLtfEw8Tb0k5MBGkuT5K4VklJUtTqIkWigPBbT5X9CtePhatfT3MyEFPGEcRPUx-TWDd1HsvVHIZZNzQ4LNzStFzM1kq1cKU802RndSaMdTTgNUV0NUGKZT0mQx9JGTFotsQwIPcEwu2hZLLxE3Ub0Te8WGy3L8tcq13JKxSytnSq-Oq-lArquZjxbEZESlKVkM1Ew5S9JiFVsesAkjEwT1S4axPSsbWDzXMOFzDS1tLaxUUs1Ehn04w4Q62YFRhKVvQ3ExDIxYU0pvKgaAHY4WHe5cgv9YVyBWDZlT0XbkMbaKQlhcG+mhvpPTCO7e3S24cCIK5WEfLkUa0jaoM0Ct-FMSZoQCVqg39RZ0W9TskWRWHaVp+mmTZJnBBZ2rQK8Dm8R8PqoRlU8jui4wmIDGV-UjZEhkMcIRJIVAIDgZQRriXkavWnoAFptdmF2CTRT2vc9mwJdKeHHoge2PpXJYYUh-0VhOnEutlHWggJVFlb6FCuspnZqdGxGUmD1GNqlXRyXcSxuoMMxA2i+Z9L0-HUT6DXtSp68E0RyBc9Z0CFSYjcZSMf1vTRUzZhJGFlXrAMcSjOw-YoAPs6qdvFexfwWxRIkzC0bqvSH7E8QGNx8eFG73CsGfyClhmg-8h3S09IMNV0cZcVrSxxT0M3QiAA */
  context: {
    room: null,
    token: null,
    serverUrl: null,
    callType: CallType.VIDEO,
    participants: [],
    connectionState: ConnectionState.Disconnected,
    error: null,
    externalId: null,
    zero: null,
    viewMode: 'mini',
    callId: null,
    channelId: null,
    externalLobbyUrl: null,
    sdlcLink: null,
    scopeType: null,
    invitedUserId: null,
    conversationId: null,
    artifactMessageId: null,
    targetUserIds: [],
    roomLink: null,
    isChatOpen: false,
    chatMessages: [],
    unreadChatCount: 0,
    activeCalls: [],
    isInitiator: false,
    callStartTime: null,
    isAIAssistantEnabled: false,
    transcriptionAgentLeft: false,
    isTranscriptionEnabled: true,
    transcriptionToggleNotice: null,
    privacyPopoverOpen: false,
    transcriptionPending: false,
    aiController: null,
    pendingControlRequest: null,
    isAiControlRequested: false,
    inviteDialogOpen: false,
    inviteUsers: [],
    inviteSuggestedMessage: '',
    ticketDialogOpen: false,
    ticketTitle: '',
    ticketDescription: '',
    ticketAssignedToName: null,
    ticketBoardId: null,
    // Use native LiveKit flow only if explicitly enabled by React Native app
    // The native app sets window.nativeCallSupported = true to enable this
    isNativeMode: isNativeCallSupported(),
    callDisplayName: null,
    // Permission error state
    permissionError: {
      type: null,
      dismissed: false,
    },
    pushToTalkState: 'idle',
    isCallChatOpen: false,
    unreadCallChatCount: 0,
    isBackgroundBlurEnabled: false,
    hostControls: DEFAULT_HOST_CONTROLS,
    callUrlOverrides: null,
  },
  id: 'roomMachine',
  on: {
    UPDATE_ACTIVE_CALLS: {
      actions: [
        assign({
          activeCalls: ({ event }) => (event.type === 'UPDATE_ACTIVE_CALLS' ? event.calls : []),
        }),
        'enforceHostControls',
      ],
    },
    HOST_CONTROLS_CHANGED: {
      actions: [
        assign({
          hostControls: ({ event, context }) =>
            event.type === 'HOST_CONTROLS_CHANGED' ? event.hostControls : context.hostControls,
        }),
        'enforceHostControls',
      ],
    },
  },
  initial: 'idle',
  states: {
    idle: {
      entry: [
        ({ context }): void => {
          logRoomMachineEvent(context.externalId ?? context.callId, 'idle_state_entered');
        },
      ],
      on: {
        CONNECT: {
          target: 'connecting',
          actions: ['createRoom', 'storeConnectionParams', 'clearError'],
        },
        INITIATE_CALL: {
          target: 'initiating',
          actions: assign({
            channelId: ({ event }) =>
              event.type === 'INITIATE_CALL' ? (event.channelId ?? null) : null,
            scopeType: ({ event }) =>
              event.type === 'INITIATE_CALL' ? (event.scopeType ?? null) : null,
            callType: ({ event }) =>
              event.type === 'INITIATE_CALL' ? event.callType : CallType.VIDEO,
            targetUserIds: ({ event }) =>
              event.type === 'INITIATE_CALL' ? event.targetUserIds || [] : [],
            zero: ({ event }) => (event.type === 'INITIATE_CALL' ? event.zero : null),
            callDisplayName: ({ event }) =>
              event.type === 'INITIATE_CALL' ? (event.callDisplayName ?? null) : null,
            viewMode: ({ event }) =>
              event.type === 'INITIATE_CALL' && event.viewMode ? event.viewMode : ('mini' as const),
            conversationId: ({ event }) =>
              event.type === 'INITIATE_CALL' ? (event.conversationId ?? null) : null,
            artifactMessageId: ({ event }) =>
              event.type === 'INITIATE_CALL' ? (event.artifactMessageId ?? null) : null,
            sdlcLink: ({ event }) =>
              event.type === 'INITIATE_CALL' ? (event.sdlcLink ?? null) : null,
            callUrlOverrides: ({ event }) =>
              event.type === 'INITIATE_CALL' ? (event.callUrlOverrides ?? null) : null,
            isInitiator: () => true,
          }),
        },
        JOIN_CALL: {
          target: 'joining',
          actions: [
            ({ event }): void => {
              const callId = event.type === 'JOIN_CALL' ? event.callId : null;
              logRoomMachineEvent(callId, 'join_call_received');
            },
            assign({
              callId: ({ event }) => (event.type === 'JOIN_CALL' ? event.callId : null),
              zero: ({ event }) => (event.type === 'JOIN_CALL' ? (event.zero ?? null) : null),
              viewMode: ({ event }) =>
                event.type === 'JOIN_CALL' && event.viewMode ? event.viewMode : ('mini' as const),
              callUrlOverrides: ({ event }) =>
                event.type === 'JOIN_CALL' ? (event.callUrlOverrides ?? null) : null,
              externalLobbyUrl: ({ event }) =>
                event.type === 'JOIN_CALL' ? (event.externalLobbyUrl ?? null) : null,
              isInitiator: () => false,
            }),
          ],
        },
      },
    },
    initiating: {
      entry: [
        // Send CALL_INITIATING to native app before API call (only if native calls are enabled)
        ({ context }): void => {
          if (isNativeCallSupported() && reactNativeBridge.isAvailable()) {
            const payload: {
              channelId?: string;
              scopeType?: string | null;
              callType?: CallType;
            } = {
              callType: context.callType,
            };
            if (context.channelId) {
              payload.channelId = context.channelId;
            }
            // Use scopeType from context (already set from INITIATE_CALL event)
            if (context.scopeType) {
              payload.scopeType = context.scopeType;
            }
            reactNativeBridge.send('CALL_INITIATING', payload);
          } else {
            logRoomMachineEvent(
              context.externalId ?? context.callId,
              'native_call_initiating_skipped',
              {
                reason: 'native_calls_not_supported',
              },
            );
          }
        },
      ],
      on: {
        // Handle early disconnects from native during API call phase
        NATIVE_DISCONNECTED: {
          target: 'failed',
          actions: assign({
            error: () => 'Call setup was interrupted',
          }),
        },
      },
      invoke: {
        src: 'createCallEntry',
        input: ({ context }) => {
          const input: {
            channelId?: string;
            callType: CallType;
            targetUserIds?: string[];
            conversationId?: string;
            artifactMessageId?: string;
            sdlcLink?: SdlcCallLink;
          } = {
            callType: context.callType,
          };
          if (context.channelId) {
            input.channelId = context.channelId;
          }
          if (context.targetUserIds && context.targetUserIds.length > 0) {
            input.targetUserIds = context.targetUserIds;
          }
          if (context.conversationId) {
            input.conversationId = context.conversationId;
          }
          if (context.artifactMessageId) {
            input.artifactMessageId = context.artifactMessageId;
          }
          if (context.sdlcLink) {
            input.sdlcLink = context.sdlcLink;
          }
          return input;
        },
        onDone: [
          {
            guard: ({ event }): boolean => event.output.pending === true,
            target: 'idle',
            actions: ['showRequestingAdmissionToast'],
          },
          {
            target: 'connecting',
            actions: [
              assign({
                externalId: ({ event }) => event.output.externalId ?? null,
                token: ({ event }) => event.output.token ?? null,
                serverUrl: ({ event }) => event.output.livekitUrl ?? null,
                callType: ({ event, context }) => event.output.callType ?? context.callType,
                roomLink: ({ event }) => event.output.roomLink ?? null,
                channelId: ({ event }) => event.output.channelId ?? null,
                targetUserIds: ({ event }) => event.output.targetUserIds || [],
                scopeType: ({ event }) => event.output.scopeType ?? null,
              }),
              'createRoom',
              'clearError',
            ],
          },
        ],
        onError: {
          target: 'failed',
          actions: assign({
            error: ({ event }) =>
              event.error instanceof Error ? event.error.message : 'Failed to initiate call',
          }),
        },
      },
    },
    joining: {
      entry: [
        // Send CALL_INITIATING to native app for incoming call overlay (only if native calls are enabled)
        ({ context }): void => {
          logRoomMachineEvent(context.externalId ?? context.callId, 'joining_state_entered', {
            isNativeCallSupported: isNativeCallSupported(),
          });
          if (isNativeCallSupported() && reactNativeBridge.isAvailable()) {
            // Find the call being joined to get its type and channel
            const call = context.activeCalls.find(c => c.externalId === context.callId);
            const payload: { channelId?: string; callType?: CallType } = {
              callType: call?.callType ?? CallType.AUDIO,
            };
            if (call?.channelId) {
              payload.channelId = call.channelId;
            }
            reactNativeBridge.send('CALL_INITIATING', payload);
          }
        },
      ],
      invoke: {
        src: 'joinCall',
        input: ({ context }) => ({
          callId: context.callId || '',
        }),
        onDone: [
          {
            guard: ({ event }): boolean => event.output.pending === true,
            target: 'idle',
            actions: ['showRequestingAdmissionToast'],
          },
          {
            target: 'connecting',
            actions: [
              assign({
                externalId: ({ event }) => event.output.externalId ?? null,
                token: ({ event }) => event.output.token ?? null,
                serverUrl: ({ event }) => event.output.livekitUrl ?? null,
                callId: ({ event }) => event.output.callId ?? null,
                roomLink: ({ event }) => event.output.roomLink ?? null,
                channelId: ({ event }) => event.output.channelId || null,
                scopeType: ({ event }) => event.output.scopeType ?? null,
              }),
              'createRoom',
              'clearError',
            ],
          },
        ],
        onError: [
          {
            // Not a failure to report — the call is simply not one this
            // workspace can see, and the lobby takes it from here. Guarded on
            // the invite URL so only link-borne joins open one: an in-app join
            // button hitting 404 means the call ended, and that belongs in a
            // toast rather than a tab.
            guard: ({ context, event }): boolean =>
              Boolean(context.externalLobbyUrl) &&
              [403, 404].includes(apiErrorStatus(event.error) ?? 0),
            target: 'failed',
            actions: [
              ({ context }): void => {
                logRoomMachineEvent(context.callId, 'join_call_routed_to_external_lobby');
              },
              assign({
                error: () => 'Call is not in this workspace',
              }),
              'routeToExternalCallLobby',
            ],
          },
          {
            target: 'failed',
            actions: [
              assign({
                error: ({ event }) =>
                  event.error instanceof Error ? event.error.message : 'Failed to join call',
              }),
              'showJoinCallErrorToast',
            ],
          },
        ],
      },
    },
    connecting: {
      entry: assign({
        callStartTime: () => Date.now(), // Start tracking join time
      }),
      invoke: {
        src: 'connectToRoom',
        input: ({ context }) => ({
          room: context.room!,
          token: context.token!,
          serverUrl: context.serverUrl!,
          callType: context.callType,
          externalId: context.externalId || '',
          ...(context.roomLink && { roomLink: context.roomLink }),
          isNativeMode: isNativeCallSupported(), // Check dynamically - context.isNativeMode is stale from module init
          channelId: context.channelId,
          conversationId: context.conversationId,
          callDisplayName: context.callDisplayName,
          scopeType: context.scopeType,
        }),
        onDone: {
          target: 'connected',
        },
        onError: {
          target: 'idle',
          actions: [
            'cleanupRoom',
            'clearContext',
            assign({
              error: ({ event }) =>
                event.error instanceof Error ? event.error.message : 'Failed to connect',
            }),
          ],
        },
      },
    },
    connected: {
      initial: 'determineMode',
      states: {
        determineMode: {
          always: [
            {
              guard: ({ context }): boolean => context.isNativeMode,
              target: 'nativeMode',
            },
            {
              target: 'webMode',
            },
          ],
        },
        nativeMode: {
          entry: ({ context }): void => {
            logRoomMachineEvent(
              context.externalId ?? context.callId,
              'connected_native_mode_entered',
            );
          },
          invoke: {
            src: 'nativeBridgeEventListener',
            input: ({ context }) => ({
              callId: context.externalId ?? context.callId,
            }),
          },
        },
        webMode: {
          invoke: {
            src: 'roomEventListener',
            input: ({ context }) => ({
              room: context.room!,
              callId: context.externalId || 'unknown',
            }),
          },
        },
      },
      entry: [
        'enableLocalTracks',
        'updateParticipants',
        assign({
          callStartTime: () => Date.now(),
        }),
        // Play sound when successfully joined the call
        (): void => {
          playAudio(AUDIO_PATHS.CALL_JOIN);
        },
      ],
      on: {
        DISCONNECT: {
          target: 'disconnecting',
          actions: ({ context, event }): void => {
            logRoomMachineEvent(context.externalId ?? context.callId, 'disconnect_event_received', {
              endForAll: event.type === 'DISCONNECT' ? (event.endForAll ?? false) : false,
              stack: new Error().stack,
            });
          },
        },
        TOGGLE_MIC: {
          actions: ({ context }) => {
            if (isHostControlTurnedOffForLocal(context, 'turnOffAudio')) return;

            if (context.isNativeMode) {
              // Get current state from participants
              const localParticipant = context.participants.find(p => p.isLocal);
              const currentState = localParticipant?.isMicrophoneEnabled ?? false;
              reactNativeBridge.livekitToggleMic(!currentState);
            } else if (context.room) {
              const currentState = context.room.localParticipant.isMicrophoneEnabled;
              void context.room.localParticipant.setMicrophoneEnabled(!currentState);
            }
          },
        },
        PUSH_TO_TALK_START: {
          actions: [
            assign({
              pushToTalkState: ({ context }) => {
                if (isHostControlTurnedOffForLocal(context, 'turnOffAudio')) return 'idle';

                // Only activate push-to-talk if currently muted
                const isCurrentlyMuted = context.isNativeMode
                  ? !(context.participants.find(p => p.isLocal)?.isMicrophoneEnabled ?? false)
                  : !(context.room?.localParticipant.isMicrophoneEnabled ?? false);
                return isCurrentlyMuted ? 'active' : 'idle';
              },
            }),
            ({ context }) => {
              if (isHostControlTurnedOffForLocal(context, 'turnOffAudio')) return;

              // Only unmute if currently muted
              const isCurrentlyMuted = context.isNativeMode
                ? !(context.participants.find(p => p.isLocal)?.isMicrophoneEnabled ?? false)
                : !(context.room?.localParticipant.isMicrophoneEnabled ?? false);

              if (isCurrentlyMuted) {
                if (context.isNativeMode) {
                  reactNativeBridge.livekitToggleMic(true);
                } else if (context.room) {
                  void context.room.localParticipant.setMicrophoneEnabled(true);
                }
              }
            },
          ],
        },
        PUSH_TO_TALK_END: {
          actions: [
            assign({
              pushToTalkState: () => 'idle',
            }),
            ({ context }) => {
              // Always mute since push-to-talk can only be triggered when muted
              if (context.isNativeMode) {
                reactNativeBridge.livekitToggleMic(false);
              } else if (context.room) {
                void context.room.localParticipant.setMicrophoneEnabled(false);
              }
            },
          ],
        },
        TOGGLE_CAMERA: {
          actions: ({ context }) => {
            if (isHostControlTurnedOffForLocal(context, 'turnOffCamera')) return;

            if (context.isNativeMode) {
              const localParticipant = context.participants.find(p => p.isLocal);
              const currentState = localParticipant?.isCameraEnabled ?? false;
              reactNativeBridge.livekitToggleCamera(!currentState);
            } else if (context.room) {
              const currentState = context.room.localParticipant.isCameraEnabled;
              void context.room.localParticipant.setCameraEnabled(!currentState);
            }
          },
        },
        TOGGLE_BACKGROUND_BLUR: {
          // Flip flag first, then apply — assign runs before the action sees context.
          actions: [
            assign({ isBackgroundBlurEnabled: ({ context }) => !context.isBackgroundBlurEnabled }),
            'applyBackgroundBlur',
          ],
        },
        SET_BACKGROUND_BLUR: {
          // Explicit set (used to revert the flag when enabling fails).
          actions: [
            assign({
              isBackgroundBlurEnabled: ({ event }) =>
                event.type === 'SET_BACKGROUND_BLUR' ? event.enabled : false,
            }),
            'applyBackgroundBlur',
          ],
        },
        TOGGLE_SCREEN_SHARE: {
          actions: ({ context }): void => {
            if (isHostControlTurnedOffForLocal(context, 'turnOffScreenShare')) return;

            if (context.isNativeMode) {
              // Get current state from participants
              const localParticipant = context.participants.find(p => p.isLocal);
              const currentState = localParticipant?.isScreenShareEnabled ?? false;
              reactNativeBridge.livekitToggleScreenShare(!currentState);
            } else if (context.room) {
              const currentState = context.room.localParticipant.isScreenShareEnabled;
              const { screenShareQuality } = getCallMediaQualitySettings();
              const quality = CALL_MEDIA_QUALITY_CONFIG[screenShareQuality];
              void context.room.localParticipant
                .setScreenShareEnabled(!currentState, {
                  resolution: {
                    width: quality.width,
                    height: quality.height,
                    frameRate: quality.frameRate,
                  },
                })
                .catch((error: Error) => {
                  // User cancelled or error occurred
                  logRoomMachineEvent(
                    context.externalId ?? context.callId,
                    'screen_share_toggle_failed',
                    {
                      error: error.message,
                    },
                  );
                });
            }
          },
        },
        TOGGLE_VIEW: {
          actions: assign({
            viewMode: ({ context }) => (context.viewMode === 'mini' ? 'full' : 'mini'),
          }),
        },
        TOGGLE_CHAT: {
          actions: assign({
            isChatOpen: ({ context }) => !context.isChatOpen,
            unreadChatCount: ({ context }) => (!context.isChatOpen ? 0 : context.unreadChatCount),
          }),
        },
        TOGGLE_CALL_CHAT: {
          actions: assign({
            isCallChatOpen: ({ context }) => !context.isCallChatOpen,
            unreadCallChatCount: ({ context }) =>
              !context.isCallChatOpen ? 0 : context.unreadCallChatCount,
          }),
        },
        INCREMENT_UNREAD_CALL_CHAT: {
          actions: assign({
            unreadCallChatCount: ({ context }) => context.unreadCallChatCount + 1,
          }),
        },
        TOGGLE_AI_ASSISTANT: {
          actions: [
            assign({
              isAIAssistantEnabled: ({ context }) => !context.isAIAssistantEnabled,
            }),
            ({ context }): void => {
              if (context.room) {
                const enabled = context.isAIAssistantEnabled;
                // Send data message to LiveKit room to notify Python agent
                void context.room.localParticipant.publishData(
                  new TextEncoder().encode(
                    JSON.stringify({
                      type: 'ai_voice_toggle',
                      enabled,
                      participantId: context.room.localParticipant.identity,
                      participantName: context.room.localParticipant.name,
                    }),
                  ),
                  { reliable: true },
                );
              }
            },
          ],
        },
        TRANSCRIPTION_AGENT_LEFT: {
          actions: assign({
            transcriptionAgentLeft: () => true,
          }),
        },
        DISMISS_AGENT_LEFT_WARNING: {
          actions: assign({
            transcriptionAgentLeft: () => false,
          }),
        },
        // Host kill-switch (COMMAND ONLY): request the change from the agent and mark it
        // pending. We do NOT flip the local privacy state here — the client reflects the
        // agent's authoritative `transcription_state` confirmation instead, so the UI can
        // never show "off" while the agent may still be capturing (e.g. if the publish
        // fails or the agent rejects the command).
        TOGGLE_TRANSCRIPTION: {
          actions: [
            assign({
              transcriptionPending: () => true,
            }),
            ({ context }): void => {
              if (!context.room) return;
              const desired = !context.isTranscriptionEnabled;
              void context.room.localParticipant.publishData(
                new TextEncoder().encode(
                  JSON.stringify({
                    type: 'transcription_toggle',
                    enabled: desired,
                    at: Date.now(),
                    participantId: context.room.localParticipant.identity,
                    participantName: context.room.localParticipant.name,
                  }),
                ),
                { reliable: true, topic: AI_DATA_TOPIC },
              );
            },
          ],
        },
        // Agent's authoritative confirmation: reflect the real state + clear pending.
        // Peers get the toast; the host's own toast/undo is handled by useTranscriptionHostToast.
        TRANSCRIPTION_CONFIRMED: {
          actions: assign({
            isTranscriptionEnabled: ({ event }) => event.enabled,
            isAIAssistantEnabled: ({ event, context }) =>
              event.enabled ? context.isAIAssistantEnabled : false,
            transcriptionPending: () => false,
            transcriptionToggleNotice: ({ event }) => ({
              enabled: event.enabled,
              byName: 'The host',
            }),
          }),
        },
        // No confirmation arrived — clear pending; the privacy state is left unchanged
        // (never optimistically flipped), so the UI keeps the last confirmed state.
        TRANSCRIPTION_TIMEOUT: {
          actions: assign({
            transcriptionPending: () => false,
          }),
        },
        DISMISS_TRANSCRIPTION_NOTICE: {
          actions: assign({
            transcriptionToggleNotice: () => null,
          }),
        },
        SET_PRIVACY_POPOVER: {
          actions: assign({
            privacyPopoverOpen: ({ event }) => event.open,
          }),
        },
        // Silent late-joiner sync from room metadata (no toast; idempotent for peers
        // who already reflected the live data-channel toggle).
        SYNC_TRANSCRIPTION_STATE: {
          actions: assign({
            isTranscriptionEnabled: ({ event }) => event.enabled,
            isAIAssistantEnabled: ({ event, context }) =>
              event.enabled ? context.isAIAssistantEnabled : false,
          }),
        },
        AI_CONTROLLER_CHANGED: {
          actions: assign({
            aiController: ({ event }) =>
              event.controller && event.controllerName
                ? { id: event.controller, name: event.controllerName }
                : null,
            // Clear pending request for everyone when controller changes
            pendingControlRequest: () => null,
            // Clear pending request flag if local user became the controller
            isAiControlRequested: ({ event, context }) => {
              if (
                event.controller &&
                context.room &&
                event.controller === context.room.localParticipant.identity
              ) {
                return false;
              }
              return context.isAiControlRequested;
            },
          }),
        },
        AI_CONTROL_REQUEST: {
          actions: assign({
            pendingControlRequest: ({ event }) => ({
              requesterId: event.requesterId,
              requesterName: event.requesterName,
            }),
            // Set isAiControlRequested if the requester is the local user
            isAiControlRequested: ({ event, context }) => {
              if (context.room && event.requesterId === context.room.localParticipant.identity) {
                return true;
              }
              return context.isAiControlRequested;
            },
          }),
        },
        AI_CONTROL_REQUEST_PENDING: {
          actions: assign({
            pendingControlRequest: ({ event }) => ({
              requesterId: event.requesterId,
              requesterName: event.requesterName,
            }),
            // Set isAiControlRequested if the requester is the local user
            isAiControlRequested: ({ event, context }) => {
              if (context.room && event.requesterId === context.room.localParticipant.identity) {
                return true;
              }
              return context.isAiControlRequested;
            },
          }),
        },
        AI_CONTROL_REQUEST_SENT: {
          actions: assign({
            isAiControlRequested: () => true,
          }),
        },
        APPROVE_CONTROL_REQUEST: {
          actions: [
            ({ context }): void => {
              if (context.room && context.pendingControlRequest) {
                const payload = {
                  type: 'ai_control_transfer',
                  // eslint-disable-next-line @typescript-eslint/naming-convention
                  new_controller_id: context.pendingControlRequest.requesterId,
                  // eslint-disable-next-line @typescript-eslint/naming-convention
                  new_controller_name: context.pendingControlRequest.requesterName,
                };
                void context.room.localParticipant.publishData(
                  new TextEncoder().encode(JSON.stringify(payload)),
                  { reliable: true },
                );
              }
            },
            assign({
              pendingControlRequest: null,
              isAiControlRequested: () => false,
            }),
          ],
        },
        DENY_CONTROL_REQUEST: {
          actions: [
            ({ context }): void => {
              // Broadcast denial to ALL participants so everyone clears their pending state
              if (context.room && context.pendingControlRequest) {
                const payload = {
                  type: 'ai_control_request_denied',
                  requester_id: context.pendingControlRequest.requesterId,
                };
                void context.room.localParticipant.publishData(
                  new TextEncoder().encode(JSON.stringify(payload)),
                  { reliable: true },
                );
              }
            },
            assign({
              isAiControlRequested: () => false,
              pendingControlRequest: null,
            }),
          ],
        },
        AI_CONTROL_REQUEST_DENIED: {
          actions: assign({
            isAiControlRequested: () => false,
            pendingControlRequest: null,
          }),
        },
        AI_INVITE_ACTION: {
          actions: assign({
            inviteDialogOpen: true,
            inviteUsers: ({ event }) => event.users,
            inviteSuggestedMessage: ({ event }) => event.suggestedMessage,
          }),
        },
        CLOSE_INVITE_DIALOG: {
          actions: assign({
            inviteDialogOpen: false,
            inviteUsers: [],
            inviteSuggestedMessage: '',
          }),
        },
        SEND_INVITE: {
          actions: assign({
            inviteDialogOpen: false,
            inviteUsers: [],
            inviteSuggestedMessage: '',
          }),
        },
        AI_CREATE_TICKET_ACTION: {
          actions: assign({
            ticketDialogOpen: true,
            ticketTitle: ({ event }) => event.title,
            ticketDescription: ({ event }) => event.description,
            ticketAssignedToName: ({ event }) => event.assignedToName || null,
            ticketBoardId: ({ event }) => event.boardId || null,
          }),
        },
        CLOSE_TICKET_DIALOG: {
          actions: assign({
            ticketDialogOpen: false,
            ticketTitle: '',
            ticketDescription: '',
            ticketAssignedToName: null,
            ticketBoardId: null,
          }),
        },
        TICKET_CREATED: {
          actions: assign({
            ticketDialogOpen: false,
            ticketTitle: '',
            ticketDescription: '',
            ticketAssignedToName: null,
            ticketBoardId: null,
          }),
        },
        ADD_CHAT_MESSAGE: {
          actions: assign({
            chatMessages: ({ context, event }) => [...context.chatMessages, event.message],
            unreadChatCount: ({ context, event }) => {
              // Only increment unread count if chat is closed and message is not from local user
              if (!context.isChatOpen && !event.message.isLocal) {
                return context.unreadChatCount + 1;
              }
              return context.unreadChatCount;
            },
          }),
        },
        CONNECTION_STATE_CHANGED: [
          {
            guard: ({ event }): boolean =>
              event.type === 'CONNECTION_STATE_CHANGED' &&
              event.state === ConnectionState.Disconnected &&
              event.disconnectReason === DisconnectReason.PARTICIPANT_REMOVED,
            target: 'disconnecting',
            actions: [
              'updateConnectionState',
              (): void => {
                toast.info('Call ended', {
                  description: 'The host has ended the call for you',
                  duration: 5000,
                });
              },
            ],
          },
          {
            // User switched to this call from another device/tab - evicted silently, no toast
            guard: ({ event }): boolean =>
              event.type === 'CONNECTION_STATE_CHANGED' &&
              event.state === ConnectionState.Disconnected &&
              event.disconnectReason === DisconnectReason.DUPLICATE_IDENTITY,
            target: 'disconnecting',
            actions: ['updateConnectionState'],
          },
          {
            // Any other disconnect (network outage, server shutdown, room deleted).
            // LiveKit only emits Disconnected once its own retries are exhausted, so
            // the call is really over - staying here left the UI showing a dead call.
            guard: ({ event }): boolean =>
              event.type === 'CONNECTION_STATE_CHANGED' &&
              event.state === ConnectionState.Disconnected,
            target: 'disconnecting',
            actions: ['updateConnectionState', 'showDisconnectedToast'],
          },
          {
            // Connecting/Reconnecting - LiveKit is still retrying, keep the call up.
            actions: ['updateConnectionState'],
          },
        ],
        PARTICIPANTS_CHANGED: {
          actions: 'updateParticipants',
        },
        TRACK_SUBSCRIBED: {
          actions: 'updateParticipants',
        },
        TRACK_UNSUBSCRIBED: {
          actions: 'updateParticipants',
        },
        LOCAL_TRACK_PUBLISHED: {
          // Re-apply blur when the camera track (re)publishes: join, re-enable,
          // or device switch (which republishes a fresh track, dropping the processor).
          actions: ['updateParticipants', 'enforceHostControls', 'applyBackgroundBlur'],
        },
        LOCAL_TRACK_UNPUBLISHED: {
          actions: 'updateParticipants',
        },
        ERROR: {
          actions: 'setError',
        },
        PERMISSION_ERROR: {
          actions: ['setPermissionError', 'showPermissionErrorToast'],
        },
        DISMISS_PERMISSION_ERROR: {
          actions: 'dismissPermissionError',
        },
        // Native mode events
        NATIVE_CONNECTION_STATE: [
          {
            // When native reports disconnected, transition to idle and cleanup
            guard: ({ event }): boolean =>
              event.type === 'NATIVE_CONNECTION_STATE' && event.state === 'disconnected',
            target: 'idle',
            actions: [
              ({ context }): void => {
                logRoomMachineEvent(
                  context.externalId ?? context.callId,
                  'native_disconnected_transition_to_idle',
                );
              },
              'clearContext',
            ],
          },
          {
            // For other states (connecting, connected, reconnecting), just update context
            actions: assign({
              connectionState: ({ event }) => {
                if (event.type !== 'NATIVE_CONNECTION_STATE') return ConnectionState.Disconnected;
                const stateMap: Record<string, ConnectionState> = {
                  disconnected: ConnectionState.Disconnected,
                  connecting: ConnectionState.Connecting,
                  connected: ConnectionState.Connected,
                  reconnecting: ConnectionState.Reconnecting,
                };
                return stateMap[event.state] ?? ConnectionState.Disconnected;
              },
            }),
          },
        ],
        NATIVE_PARTICIPANTS_CHANGED: {
          actions: assign({
            participants: ({ event }): ParticipantInfo[] => {
              if (event.type !== 'NATIVE_PARTICIPANTS_CHANGED') return [];
              return event.participants.map(p => ({
                identity: p.identity,
                name: p.name || p.identity,
                isCameraEnabled: p.isCameraEnabled,
                isMicrophoneEnabled: p.isMicrophoneEnabled,
                isScreenShareEnabled: p.isScreenShareEnabled,
                isLocal: p.isLocal,
                participant: null as unknown as Participant, // Not available in native mode
              }));
            },
          }),
        },
        NATIVE_ERROR: {
          actions: assign({
            error: ({ event }) => (event.type === 'NATIVE_ERROR' ? event.error : 'Unknown error'),
          }),
        },
        // Handle native-initiated call end with cleanup
        NATIVE_CALL_ENDED: {
          target: 'idle',
          actions: [
            // Play exit sound
            (): void => {
              playAudio(AUDIO_PATHS.CALL_EXIT);
            },
            'clearContext',
          ],
        },
      },
    },
    disconnecting: {
      entry: [
        ({ context }): void => {
          logRoomMachineEvent(context.externalId ?? context.callId, 'disconnecting_state_entered');
        },
        // Play sound when exiting the call
        (): void => {
          playAudio(AUDIO_PATHS.CALL_EXIT);
        },
      ],
      invoke: {
        src: 'disconnectAndCleanup',
        input: ({ context, event }) => ({
          room: context.room, // May be null in native mode
          externalId: context.externalId,
          zero: context.zero,
          isNativeMode: isNativeCallSupported(), // Check dynamically - context.isNativeMode is stale from module init
          endForAll: event.type === 'DISCONNECT' ? (event.endForAll ?? false) : false,
        }),
        onDone: {
          target: 'idle',
          actions: [
            ({ context }): void => {
              logRoomMachineEvent(
                context.externalId ?? context.callId,
                'disconnect_cleanup_done_transition_to_idle',
              );
            },
            'clearContext',
          ],
        },
        onError: {
          target: 'idle',
          actions: [
            ({ context, event }): void => {
              logger.error(Event.LIVEKIT_ROOM_EVENT, {
                callId: context.externalId ?? context.callId,
                eventName: 'disconnect_cleanup_actor_failed',
                error: event.error instanceof Error ? event.error.message : String(event.error),
              });
            },
            'clearContext',
            assign({
              error: () => 'Failed to disconnect from room',
            }),
          ],
        },
      },
    },
    failed: {
      entry: [
        // Notify native app of failure so it can show error and reset UI
        ({ context }): void => {
          if (detectReactNativeWebView() && reactNativeBridge.isAvailable()) {
            reactNativeBridge.send('CALL_FAILED', {
              error: context.error || 'Call failed',
            });
          }
        },
      ],
      always: {
        target: 'idle',
        actions: ['clearContext', 'clearError'],
      },
    },
  },
});

// Create the global Room actor instance
export const roomActor = createActor(roomMachine).start();

/**
 * Join a call from outside the React tree, leaving any call already running.
 *
 * JOIN_CALL is only accepted from `idle`, so a join raised mid-call has to wait
 * out the teardown. Inside the tree that waiting is what useCallJoinOrInitiate
 * does — a pending ref plus an effect on the machine state — which is how the
 * "Switch" button on a call message works. The document-level link handler in
 * App.tsx sits above the providers that hook needs, so it comes through here.
 */
export const joinCallSwitchingIfNeeded = (
  event: Extract<RoomMachineEvent, { type: 'JOIN_CALL' }>,
): void => {
  if (reactNativeBridge.isAvailable()) {
    reactNativeBridge.requestMediaPermissions({
      permissions: ['microphone', 'camera', 'screenShare'],
    });
  }

  if (roomActor.getSnapshot().value === 'idle') {
    roomActor.send(event);
    return;
  }

  // Subscribed before the disconnect is sent, so the transition to idle cannot
  // be missed. Reading `subscription` inside its own callback is safe: this runs
  // only when the machine is not idle, so an implementation that replayed the
  // current state on subscribe would hit the early return first.
  const subscription = roomActor.subscribe(state => {
    if (state.value !== 'idle') return;
    subscription.unsubscribe();
    roomActor.send(event);
  });
  roomActor.send({ type: 'DISCONNECT' });
};

// Expose roomActor on window for debugging in development
if (typeof window !== 'undefined') {
  (window as unknown as { roomActor: typeof roomActor }).roomActor = roomActor;
}
