import { setup, assign, createActor, fromCallback, fromPromise } from 'xstate';
import {
  Room,
  RoomEvent as LiveKitRoomEvent,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  LocalTrackPublication,
  VideoPresets,
  ConnectionState,
  RoomConnectOptions,
  Participant,
  TrackPublication,
  setLogLevel,
  DisconnectReason,
  SubscriptionError,
  MediaDeviceFailure,
} from 'livekit-client';
import type { Zero } from '@rocicorp/zero';
import type { Call } from '@xyne/shared';
import {
  parseAIDataMessage,
  decodeDataPayload,
  AI_DATA_TOPIC,
  AI_MESSAGE_TYPES,
  type AIInviteUser,
  type AIEvent,
} from '@xyne/shared';
import { callService } from '../services/Call/callService';
import { callRuntimeNativeService } from '../services/CallRuntimeNativeService';
import { logCallAction } from '../services/Call/callActionLog';
import { CallType } from '@xyne/shared';
// import { playAudio, AUDIO_PATHS } from '../utils/audioPlayer'; // Sounds handled natively by CallKeep
import { Alert } from 'react-native';
import {
  reactNativeBridge,
  detectReactNativeWebView,
  isNativeCallSupported,
} from '../utils/reactNativeBridge';
import { logger, Event } from '../utils/logger';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Returns the active LiveKit Room regardless of mode.
 * In native mode context.room is null; use callRuntimeNativeService as fallback.
 */
function getActiveRoom(context: { room: Room | null }): Room | null {
  return context.room ?? callRuntimeNativeService.getRoom();
}

// ============================================================================
// BRIDGE PAYLOAD TYPES
// ============================================================================

interface BridgeConnectionStatePayload {
  state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
}

interface BridgeErrorPayload {
  error: string;
}

interface BridgeParticipantsPayload {
  participants: Array<{
    identity: string;
    name?: string;
    isCameraEnabled: boolean;
    isMicrophoneEnabled: boolean;
    isScreenShareEnabled: boolean;
    isLocal: boolean;
  }>;
}

interface BridgeCallEndedPayload {
  callId: string;
  callType: 'AUDIO' | 'VIDEO';
  durationMs: number;
  initiatedBy: 'user' | 'callkit' | 'error';
}

// Set LiveKit log level
setLogLevel('warn');

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
export interface RoomContext {
  room: Room | null;
  token: string | null;
  serverUrl: string | null;
  callType: CallType;
  initialMicrophoneEnabled: boolean;
  initialCameraEnabled: boolean;
  participants: ParticipantInfo[];
  connectionState: ConnectionState;
  error: string | null;
  externalId: string | null;
  zero: Zero | null;
  viewMode: 'mini' | 'full';
  callId: string | null;
  channelId: string | null;
  scopeType: string | null; // Channel scope type (DM, GROUP_DM, DEFAULT, etc.)
  invitedUserId: string | null;
  conversationId: string | null;
  targetUserIds: string[];
  roomLink: string | null;
  isChatOpen: boolean;
  chatMessages: ChatMessage[];
  unreadChatCount: number;
  activeCalls: Call[]; // Store all active calls for the user
  isInitiator: boolean; // Track if user initiated vs joined the call
  callStartTime: number | null; // Track when the call started for duration calculation
  isAIAssistantEnabled: boolean; // Track Xyne Automatic state
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
    }
  | {
      type: 'JOIN_CALL';
      callId: string;
      zero: Zero | null;
      viewMode?: 'mini' | 'full';
      initialMicrophoneEnabled?: boolean;
      initialCameraEnabled?: boolean;
    }
  | {
      /**
       * Join a call whose credentials (LiveKit token + serverUrl) are already known
       * (e.g. provided in the VoIP push payload). Transitions directly to `connecting`,
       * skipping the backend joinCall API call that `JOIN_CALL` would trigger.
       */
      type: 'JOIN_CALL_WITH_CREDENTIALS';
      callId: string;
      token: string;
      serverUrl: string;
      channelId?: string;
      callType?: CallType;
      viewMode?: 'mini' | 'full';
    }
  | { type: 'TOGGLE_MIC' }
  | { type: 'PUSH_TO_TALK_START' }
  | { type: 'PUSH_TO_TALK_END' }
  | { type: 'TOGGLE_CAMERA' }
  | { type: 'TOGGLE_SCREEN_SHARE' }
  | { type: 'SCREEN_SHARE_FAILED' }
  | { type: 'TOGGLE_VIEW' }
  | { type: 'TOGGLE_CHAT' }
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
      callType: 'AUDIO' | 'VIDEO';
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
        };
      }) => {
        const { channelId, callType, targetUserIds, conversationId } = input;

        // Backend now only generates LiveKit credentials, no DB writes
        // If targetUserIds is provided without channelId, backend will find/create DM or group DM channel
        const result = await callService.initiateCall({
          ...(channelId && { channelId }),
          ...(targetUserIds && targetUserIds.length > 0 && { invitedUserIds: targetUserIds }),
          ...(conversationId && { conversationId }),
          callType,
        });

        return {
          externalId: result.externalId,
          token: result.token,
          livekitUrl: result.livekitUrl,
          callType,
          roomLink: result.roomLink,
          channelId: result.channelId, // Use channelId from backend response (may be resolved from invitedUserId)
          targetUserIds,
          scopeType: result.scopeType, // Channel scope type for CallKit filtering
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

      return {
        externalId: result.externalId,
        token: result.token,
        livekitUrl: result.livekitUrl,
        callId: callId, // Pass through the externalId for DB writes
        roomLink: result.roomLink,
        channelId: result.channelId,
        scopeType: result.scopeType, // Channel scope type for CallKit filtering
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

        // Helper to update participants
        const updateParticipants = (): void => {
          sendBack({ type: 'PARTICIPANTS_CHANGED' });
        };

        // Connection events
        room.on(LiveKitRoomEvent.Connected, () => {
          sendBack({ type: 'CONNECTION_STATE_CHANGED', state: ConnectionState.Connected });
          updateParticipants();
        });

        room.on(LiveKitRoomEvent.Reconnecting, () => {
          sendBack({ type: 'CONNECTION_STATE_CHANGED', state: ConnectionState.Reconnecting });
        });

        room.on(LiveKitRoomEvent.Reconnected, () => {
          sendBack({ type: 'CONNECTION_STATE_CHANGED', state: ConnectionState.Connected });
        });

        room.on(LiveKitRoomEvent.Disconnected, (reason?: DisconnectReason) => {
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
          // playAudio(AUDIO_PATHS.CALL_EXIT); // Sounds handled natively by CallKeep
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

        // Remote track unpublished (e.g. camera turned off): keeps the roster's camera state in
        // sync right away. Logged by the catch-all room-event logger below.
        room.on(LiveKitRoomEvent.TrackUnpublished, () => {
          updateParticipants();
        });

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
        room.on(LiveKitRoomEvent.ParticipantConnected, (_participant: RemoteParticipant) => {
          updateParticipants();
          // playAudio(AUDIO_PATHS.PARTICIPANT_JOIN); // Sounds handled natively by CallKeep
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

            // Handle message types not covered by the shared parser directly
            switch (data.type) {
              // Control transfer: current controller approved a request — update controller for all
              case 'ai_control_transfer':
                if (data.new_controller_id) {
                  sendBack({
                    type: 'AI_CONTROLLER_CHANGED',
                    controller: data.new_controller_id,
                    controllerName: data.new_controller_name ?? null,
                  } as const);
                }
                return;

              // Denial broadcast: requester's pending state should be cleared for all
              case 'ai_control_request_denied':
                sendBack({ type: 'AI_CONTROL_REQUEST_DENIED' } as const);
                return;

              // Voice toggle from another participant: sync AI enabled state + controller
              case 'ai_voice_toggle':
                if (data.enabled && data.participantId) {
                  sendBack({
                    type: 'AI_CONTROLLER_CHANGED',
                    controller: data.participantId,
                    controllerName: data.participantName ?? null,
                  } as const);
                } else if (!data.enabled) {
                  sendBack({
                    type: 'AI_CONTROLLER_CHANGED',
                    controller: null,
                    controllerName: null,
                  } as const);
                }
                return;
            }

            // Parse into AI event using shared parser for remaining types
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
          initialMicrophoneEnabled: boolean;
          initialCameraEnabled: boolean;
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
          initialMicrophoneEnabled,
          initialCameraEnabled,
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

          // eslint-disable-next-line no-console
          console.log('[LiveKit] CallKit display name:', {
            callerName,
            channelId,
            conversationId,
          });

          reactNativeBridge.livekitConnect({
            token,
            serverUrl,
            callType: callType,
            externalId,
            initialMicrophoneEnabled,
            initialCameraEnabled,
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
              const payload = message.payload as BridgeConnectionStatePayload | undefined;
              const state = payload?.state;
              // eslint-disable-next-line no-console
              console.log('[LiveKit Native] Connection state changed:', state);

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
              const payload = message.payload as BridgeErrorPayload | undefined;
              clearTimeout(timeout);
              unsubscribe();
              unsubError();
              reject(new Error(payload?.error ?? 'Native LiveKit error'));
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
            // eslint-disable-next-line no-console
            console.log(`[LiveKit] Connection attempt ${attempt + 1}/${MAX_RETRIES}`);

            await room.connect(serverUrl, token, options);

            // eslint-disable-next-line no-console
            console.log('[LiveKit] Successfully connected to room');
            return; // Success!
          } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            // eslint-disable-next-line no-console
            console.error(
              `[LiveKit] Connection attempt ${attempt + 1}/${MAX_RETRIES} failed:`,
              lastError.message,
            );

            // Don't retry on the last attempt
            if (attempt < MAX_RETRIES - 1) {
              // eslint-disable-next-line no-console
              console.log(`[LiveKit] Retrying...`);
            }
          }
        }

        // All retries failed
        // eslint-disable-next-line no-console
        console.error('[LiveKit] All connection attempts failed');
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

        // eslint-disable-next-line no-console
        console.log('[roomMachine] disconnectAndCleanup started', {
          hasRoom: !!room,
          externalId,
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
                context: 'roomMachine.disconnectAndCleanup.endForAll',
                error: error instanceof Error ? error.message : String(error),
              });
              // Continue with disconnect even if API call fails
            }
          }

          // If in native mode, send disconnect to React Native bridge
          if (isNativeMode) {
            // eslint-disable-next-line no-console
            console.log('[roomMachine] Sending LIVEKIT_DISCONNECT to native');
            reactNativeBridge.livekitDisconnect();
            // eslint-disable-next-line no-console
            console.log('[roomMachine] disconnectAndCleanup completed (native mode)');
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

          // eslint-disable-next-line no-console
          console.log('[roomMachine] disconnectAndCleanup completed (web mode)');
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error('[roomMachine] disconnectAndCleanup error:', error);
          // Don't rethrow - we want to transition to idle even on error
        }
      },
    ),

    // Native bridge event listener - receives events from React Native
    nativeBridgeEventListener: fromCallback(({ sendBack }) => {
      // eslint-disable-next-line no-console
      console.log('[Room Machine] nativeBridgeEventListener STARTED - listening for native events');

      const unsubConnectionState = reactNativeBridge.on('LIVEKIT_CONNECTION_STATE', message => {
        const payload = message.payload as BridgeConnectionStatePayload | undefined;
        // eslint-disable-next-line no-console
        console.log(
          '[Room Machine] Received LIVEKIT_CONNECTION_STATE in connected state:',
          payload?.state,
        );
        sendBack({
          type: 'NATIVE_CONNECTION_STATE',
          state: payload?.state ?? 'disconnected',
        });
      });

      const unsubParticipants = reactNativeBridge.on('LIVEKIT_PARTICIPANTS_CHANGED', message => {
        const payload = message.payload as BridgeParticipantsPayload | undefined;
        sendBack({
          type: 'NATIVE_PARTICIPANTS_CHANGED',
          participants: payload?.participants ?? [],
        });
      });

      const unsubError = reactNativeBridge.on('LIVEKIT_ERROR', message => {
        const payload = message.payload as BridgeErrorPayload | undefined;
        // eslint-disable-next-line no-console
        console.log('[Room Machine] Received LIVEKIT_ERROR in connected state:', payload?.error);
        sendBack({ type: 'NATIVE_ERROR', error: payload?.error ?? 'Unknown error' });
      });

      const unsubCallEnded = reactNativeBridge.on('LIVEKIT_CALL_ENDED', message => {
        const payload = message.payload as BridgeCallEndedPayload | undefined;
        // eslint-disable-next-line no-console
        console.log('[Room Machine] Received LIVEKIT_CALL_ENDED in connected state:', payload);
        if (payload) {
          sendBack({
            type: 'NATIVE_CALL_ENDED',
            callId: payload.callId,
            callType: payload.callType,
            durationMs: payload.durationMs,
            initiatedBy: payload.initiatedBy,
          });
        }
      });

      return (): void => {
        // eslint-disable-next-line no-console
        console.log('[Room Machine] nativeBridgeEventListener STOPPED - cleanup called');
        unsubConnectionState();
        unsubParticipants();
        unsubError();
        unsubCallEnded();
      };
    }),

    // Listens to LiveKit DataReceived events in native mode so AI control messages
    // (ai_voice_toggle, ai_control_request, ai_control_transfer, etc.) are forwarded
    // to the machine. This is needed because roomEventListener only runs in webMode.
    nativeRoomDataListener: fromCallback(({ sendBack }) => {
      const room = callRuntimeNativeService.getRoom();
      if (!room) {
        // eslint-disable-next-line no-console
        console.warn(
          '[Room Machine] nativeRoomDataListener: no room available, skipping data listener',
        );
        return (): void => {};
      }

      // eslint-disable-next-line no-console
      console.log('[Room Machine] nativeRoomDataListener STARTED');

      const handleDataReceived = (
        payload: Uint8Array,
        _participant?: RemoteParticipant,
        _kind?: unknown,
        _topic?: string,
      ): void => {
        const data = decodeDataPayload(payload);
        if (!data) return;

        switch (data.type) {
          case 'ai_control_transfer':
            if (data.new_controller_id) {
              sendBack({
                type: 'AI_CONTROLLER_CHANGED',
                controller: data.new_controller_id,
                controllerName: data.new_controller_name ?? null,
              } as const);
            }
            return;

          case 'ai_control_request_denied':
            sendBack({ type: 'AI_CONTROL_REQUEST_DENIED' } as const);
            return;

          case 'ai_voice_toggle':
            if (data.enabled && data.participantId) {
              sendBack({
                type: 'AI_CONTROLLER_CHANGED',
                controller: data.participantId,
                controllerName: data.participantName ?? null,
              } as const);
            } else if (!data.enabled) {
              sendBack({
                type: 'AI_CONTROLLER_CHANGED',
                controller: null,
                controllerName: null,
              } as const);
            }
            return;
        }

        const event: AIEvent | null = parseAIDataMessage(data);
        if (!event) return;

        switch (event.type) {
          case 'AI_INVITE':
            if (_topic === AI_DATA_TOPIC) {
              sendBack({
                type: 'AI_INVITE_ACTION',
                users: event.users,
                suggestedMessage: event.suggestedMessage,
              } as const);
            }
            break;

          case 'AI_CREATE_TICKET':
            if (_topic === AI_DATA_TOPIC) {
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
            sendBack({
              type: 'AI_CONTROLLER_CHANGED',
              controller: event.controller,
              controllerName: event.controllerName,
            } as const);
            break;

          case 'AI_CONTROL_REQUEST':
            sendBack({
              type: 'AI_CONTROL_REQUEST',
              requesterId: event.requesterId,
              requesterName: event.requesterName,
            } as const);
            break;
        }
      };

      room.on(LiveKitRoomEvent.DataReceived, handleDataReceived);

      return (): void => {
        // eslint-disable-next-line no-console
        console.log('[Room Machine] nativeRoomDataListener STOPPED');
        room.off(LiveKitRoomEvent.DataReceived, handleDataReceived);
      };
    }),
  },
  actions: {
    createRoom: assign({
      room: () => {
        // Check dynamically - context.isNativeMode is stale from module init
        if (isNativeCallSupported()) {
          return null;
        }

        const room = new Room({
          adaptiveStream: false, // Disable adaptive streaming for consistent screen share quality
          dynacast: true,
          videoCaptureDefaults: {
            resolution: VideoPresets.h2160.resolution,
          },
          audioCaptureDefaults: {
            autoGainControl: true,
            echoCancellation: true,
            noiseSuppression: true,
          },
          publishDefaults: {
            // Custom ultra-high quality encoding for screen sharing
            // 10 Mbps bitrate ensures crystal clear screen sharing from the start
            screenShareEncoding: {
              maxBitrate: 10_000_000, // 10 Mbps for maximum quality
              maxFramerate: 30,
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
          isScreenShareEnabled: localParticipant.isScreenShareEnabled,
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
            isScreenShareEnabled: participant.isScreenShareEnabled ?? false,
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

    showPermissionErrorToast: () => {
      // No-op: Native app handles permission errors via native dialogs
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
      initialMicrophoneEnabled: () => true,
      initialCameraEnabled: ({ event }) =>
        event.type === 'CONNECT' && event.callType === CallType.VIDEO,
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
      initialMicrophoneEnabled: () => true,
      initialCameraEnabled: () => false,
      participants: () => [],
      connectionState: () => ConnectionState.Disconnected,
      error: () => null,
      callId: () => null,
      channelId: () => null,
      externalId: () => null,
      invitedUserId: () => null,
      conversationId: () => null,
      targetUserIds: () => [],
      roomLink: () => null,
      isChatOpen: () => false,
      chatMessages: () => [],
      unreadChatCount: () => 0,
      viewMode: () => 'mini' as const, // Reset to default mini view
      isInitiator: () => false,
      callStartTime: () => null,
      isAIAssistantEnabled: () => false,
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
    }),

    enableLocalTracks: ({ context }) => {
      if (context.room && context.initialMicrophoneEnabled) {
        const enableTracksAndSelectDevices = async (): Promise<void> => {
          try {
            // First, enable tracks and wait for them to be created
            await context.room!.localParticipant.setMicrophoneEnabled(true);

            // This triggers the ActiveDeviceChanged event that the UI listens to
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

    showJoinCallErrorToast: () => {
      Alert.alert('Failed to join call', 'Unable to connect to the room. Please try again.');
    },
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QCcD2qC2BZAhgYwAsBLAOzADoIjY9USy8AXSAYgGEB5AOS4FE2AKgG0ADAF1EoAA6pYRRkTqSQAD0QBWAIwAOcgHZtAThEA2E5r2aATNYDMAGhABPRNpPr9VgCwj1JrwEi2tqaAL6hjmiYuISkFLT0YEykUCwQdBSkAG6oANYUUdj4xGTkCQwKJFAI2ah4OAp0omLNyjJyjSTKagiGeobktrbqhlqmvlbq6o4uCJo6urb+JtpW5np+k+GR6EWxpeVJlalgyGjI5FIANg0AZqjIGOSFMSXxdBUpNSQ59Z3NrSQIHa8kUXSBPXUthE5C82i8tgM2j0ehEIkMVhmiE0Ik0JnIQVsCPmejMVnJ2xAL2KcTKHyOrAAIgBJADKnB4-GE4jaslBSgh2K8-XIbj0NjhekCIi8WLmVlM5CsISJhmsIls5O0lOp+3eiSYrAEHAA4iaADK8AD6WGZbEB0j5nW62MmXgJXishjVawVmnUejlOJWouV5Os6islhlOt2r1ph0NEBYxrNlqtbAAglheAAlTMO4FOsEu+VLcgWdTaUz9KaaWzaOV9KyDDZBdQ+KPt2PRGkHelJlOmi3W9m53i8LhW1kACUz48LIOdgvl6MGhnhfhMKLWHblyI8GM0hi8o0jqPcPb2bzpBuYyY5fEEzO404EmYE1rYc64Jt4jMXYsBVAHp5m0WxYU0HxVk2KsjDlFEBi8FYVVRLtkKveN+zvVgAAV5wEO1mXwrgBFZDMfz-ACeSBJcSxXdU9FhSZq1RSxhncOUVgg3E-BRbRzxELYIipOM+31CojXzNgAGlpwAVQAITHZlFP-QCOnokDXUmUUTCGIT3ARSMHGcDQ3HIWDPTRLtfEw8Tb0k5MBGkuT5K4VklJUtTqIkWigPBbT5X9CtePhatfT3MyEFPGEcRPUx-TWDd1HsvVHIZZNzQ4LNzStFzM1kq1cKU802RndSaMdTTgNUV0NUGKZT0mQx9JGTFotsQwIPcEwu2hZLLxE3Ub0Te8WGy3L8tcq13JKxSytnSq-Oq-lArquZjxbEZESlKVkM1Ew5S9JiFVsesAkjEwT1S4axPSsbWDzXMOFzDS1tLaxUUs1Ehn04w4Q62YFRhKVvQ3ExDIxYU0pvKgaAHY4WHe5cgv9YVyBWDZlT0XbkMbaKQlhcG+mhvpPTCO7e3S24cCIK5WEfLkUa0jaoM0Ct-FMSZoQCVqg39RZ0W9TskWRWHaVp+mmTZJnBBZ2rQK8Dm8R8PqoRlU8jui4wmIDGV-UjZEhkMcIRJIVAIDgZQRriXkavWnoAFptdmF2CTRT2vc9mwJdKeHHoge2PpXJYYUh-0VhOnEutlHWggJVFlb6FCuspnZqdGxGUmD1GNqlXRyXcSxuoMMxA2i+Z9L0-HUT6DXtSp68E0RyBc9Z0CFSYjcZSMf1vTRUzZhJGFlXrAMcSjOw-YoAPs6qdvFexfwWxRIkzC0bqvSH7E8QGNx8eFG73CsGfyClhmg-8h3S09IMNV0cZcVrSxxT0M3QiAA */
  context: {
    room: null,
    token: null,
    serverUrl: null,
    callType: CallType.VIDEO,
    initialMicrophoneEnabled: true,
    initialCameraEnabled: true,
    participants: [],
    connectionState: ConnectionState.Disconnected,
    error: null,
    externalId: null,
    zero: null,
    viewMode: 'mini',
    callId: null,
    channelId: null,
    scopeType: null,
    invitedUserId: null,
    conversationId: null,
    targetUserIds: [],
    roomLink: null,
    isChatOpen: false,
    chatMessages: [],
    unreadChatCount: 0,
    activeCalls: [],
    isInitiator: false,
    callStartTime: null,
    isAIAssistantEnabled: false,
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
  },
  id: 'roomMachine',
  on: {
    UPDATE_ACTIVE_CALLS: {
      actions: assign({
        activeCalls: ({ event }) => (event.type === 'UPDATE_ACTIVE_CALLS' ? event.calls : []),
      }),
    },
  },
  initial: 'idle',
  states: {
    idle: {
      entry: [
        // eslint-disable-next-line no-console
        (): void => console.log('[roomMachine] Entered idle state'),
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
            initialMicrophoneEnabled: () => true,
            initialCameraEnabled: ({ event }) =>
              event.type === 'INITIATE_CALL' && event.callType === CallType.VIDEO,
            targetUserIds: ({ event }) =>
              event.type === 'INITIATE_CALL' ? event.targetUserIds || [] : [],
            zero: ({ event }) => (event.type === 'INITIATE_CALL' ? event.zero : null),
            callDisplayName: ({ event }) =>
              event.type === 'INITIATE_CALL' ? (event.callDisplayName ?? null) : null,
            viewMode: ({ event }) =>
              event.type === 'INITIATE_CALL' && event.viewMode ? event.viewMode : ('mini' as const),
            conversationId: ({ event }) =>
              event.type === 'INITIATE_CALL' ? (event.conversationId ?? null) : null,
            isInitiator: () => true,
          }),
        },
        JOIN_CALL: {
          target: 'joining',
          actions: [
            // eslint-disable-next-line no-console
            ({ event }): void =>
              console.log('[roomMachine] JOIN_CALL received in idle state', {
                callId: event.type === 'JOIN_CALL' ? event.callId : null,
              }),
            assign({
              callId: ({ event }) => (event.type === 'JOIN_CALL' ? event.callId : null),
              zero: ({ event }) => (event.type === 'JOIN_CALL' ? (event.zero ?? null) : null),
              viewMode: ({ event }) =>
                event.type === 'JOIN_CALL' && event.viewMode ? event.viewMode : ('mini' as const),
              initialMicrophoneEnabled: ({ event }) =>
                event.type === 'JOIN_CALL' ? (event.initialMicrophoneEnabled ?? true) : true,
              initialCameraEnabled: ({ event }) =>
                event.type === 'JOIN_CALL' ? (event.initialCameraEnabled ?? false) : false,
              isInitiator: () => false,
            }),
          ],
        },
        JOIN_CALL_WITH_CREDENTIALS: {
          // Credentials already available (from VoIP push payload) — skip the joinCall API call
          // and go straight to connecting so LiveKit can join immediately.
          target: 'connecting',
          actions: [
            // eslint-disable-next-line no-console
            ({ event }): void =>
              console.log('[XCALL][ROOM] JOIN_CALL_WITH_CREDENTIALS — skipping joinCall API', {
                callId: event.type === 'JOIN_CALL_WITH_CREDENTIALS' ? event.callId : null,
                hasToken: event.type === 'JOIN_CALL_WITH_CREDENTIALS' ? !!event.token : false,
                hasServerUrl:
                  event.type === 'JOIN_CALL_WITH_CREDENTIALS' ? !!event.serverUrl : false,
              }),
            assign({
              callId: ({ event }) =>
                event.type === 'JOIN_CALL_WITH_CREDENTIALS' ? event.callId : null,
              externalId: ({ event }) =>
                event.type === 'JOIN_CALL_WITH_CREDENTIALS' ? event.callId : null,
              token: ({ event }) =>
                event.type === 'JOIN_CALL_WITH_CREDENTIALS' ? event.token : null,
              serverUrl: ({ event }) =>
                event.type === 'JOIN_CALL_WITH_CREDENTIALS' ? event.serverUrl : null,
              channelId: ({ event }) =>
                event.type === 'JOIN_CALL_WITH_CREDENTIALS' ? (event.channelId ?? null) : null,
              callType: ({ event }) =>
                event.type === 'JOIN_CALL_WITH_CREDENTIALS'
                  ? (event.callType ?? CallType.AUDIO)
                  : CallType.AUDIO,
              initialMicrophoneEnabled: () => true,
              initialCameraEnabled: ({ event }) =>
                event.type === 'JOIN_CALL_WITH_CREDENTIALS' && event.callType === CallType.VIDEO,
              viewMode: ({ event }) =>
                event.type === 'JOIN_CALL_WITH_CREDENTIALS' && event.viewMode
                  ? event.viewMode
                  : ('full' as const),
              isInitiator: () => false,
            }),
            'createRoom',
            'clearError',
          ],
        },
      },
    },
    initiating: {
      entry: [
        // eslint-disable-next-line no-console
        ({ context }): void => {
          console.log('[roomMachine] Entered initiating state with context:', {
            channelId: context.channelId,
            callType: context.callType,
            targetUserIds: context.targetUserIds,
          });
        },
        // Send CALL_INITIATING to native app before API call (only if native calls are enabled)
        ({ context }): void => {
          if (isNativeCallSupported() && reactNativeBridge.isAvailable()) {
            const payload: {
              channelId?: string;
              scopeType?: string | null;
              callType?: 'AUDIO' | 'VIDEO';
            } = {
              callType: context.callType as 'AUDIO' | 'VIDEO',
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
            // eslint-disable-next-line no-console
            console.log('[Room Machine] Not sending CALL_INITIATING - native calls not supported');
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
          return input;
        },
        onDone: {
          target: 'connecting',
          actions: [
            assign({
              externalId: ({ event }) => event.output.externalId,
              token: ({ event }) => event.output.token,
              serverUrl: ({ event }) => event.output.livekitUrl,
              callType: ({ event }) => event.output.callType,
              roomLink: ({ event }) => event.output.roomLink,
              channelId: ({ event }) => event.output.channelId,
              targetUserIds: ({ event }) => event.output.targetUserIds || [],
              scopeType: ({ event }) => event.output.scopeType ?? null, // Store scopeType from API response
            }),
            // eslint-disable-next-line no-console
            ({ event }): void => {
              console.log('[roomMachine] createCallEntry onDone:', {
                externalId: event.output.externalId,
                hasToken: !!event.output.token,
                livekitUrl: event.output.livekitUrl,
                channelId: event.output.channelId,
              });
            },
            'createRoom',
            'clearError',
          ],
        },
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
          // eslint-disable-next-line no-console
          console.log(
            '[roomMachine] joining state entry, isNativeCallSupported:',
            isNativeCallSupported(),
          );
          if (isNativeCallSupported() && reactNativeBridge.isAvailable()) {
            // Find the call being joined to get its type and channel
            const call = context.activeCalls.find(c => c.externalId === context.callId);
            const payload: { channelId?: string; callType?: 'AUDIO' | 'VIDEO' } = {
              callType: (call?.callType as 'AUDIO' | 'VIDEO') || 'AUDIO',
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
        onDone: {
          target: 'connecting',
          actions: [
            assign({
              externalId: ({ event }) => event.output.externalId,
              token: ({ event }) => event.output.token,
              serverUrl: ({ event }) => event.output.livekitUrl,
              callType: () => CallType.AUDIO,
              callId: ({ event }) => event.output.callId,
              roomLink: ({ event }) => event.output.roomLink,
              channelId: ({ event }) => event.output.channelId || null,
              scopeType: ({ event }) => event.output.scopeType ?? null,
            }),
            'createRoom',
            'clearError',
          ],
        },
        onError: {
          target: 'failed',
          actions: [
            assign({
              error: ({ event }) =>
                event.error instanceof Error ? event.error.message : 'Failed to join call',
            }),
            'showJoinCallErrorToast',
          ],
        },
      },
    },
    connecting: {
      entry: [
        assign({
          callStartTime: () => Date.now(), // Start tracking join time
        }),
        // eslint-disable-next-line no-console
        ({ context }): void => {
          console.log('[XCALL][ROOM] → connecting state entered', {
            externalId: context.externalId,
            hasToken: !!context.token,
            serverUrl: context.serverUrl,
            channelId: context.channelId,
            isNativeMode: context.isNativeMode,
          });
        },
      ],
      invoke: {
        src: 'connectToRoom',
        input: ({ context }) => {
          // eslint-disable-next-line no-console
          console.log('[roomMachine] connectToRoom input:', {
            hasRoom: !!context.room,
            hasToken: !!context.token,
            serverUrl: context.serverUrl,
            externalId: context.externalId,
            isNativeMode: isNativeCallSupported(),
          });
          return {
            room: context.room!,
            token: context.token!,
            serverUrl: context.serverUrl!,
            callType: context.callType,
            initialMicrophoneEnabled: context.initialMicrophoneEnabled,
            initialCameraEnabled: context.initialCameraEnabled,
            externalId: context.externalId || '',
            ...(context.roomLink && { roomLink: context.roomLink }),
            isNativeMode: isNativeCallSupported(), // Check dynamically - context.isNativeMode is stale from module init
            channelId: context.channelId,
            conversationId: context.conversationId,
            callDisplayName: context.callDisplayName,
            scopeType: context.scopeType,
          };
        },
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
          entry: (): void => {
            // eslint-disable-next-line no-console
            console.log('[Room Machine] Entering connected.nativeMode state');
          },
          invoke: [
            {
              src: 'nativeBridgeEventListener',
            },
            {
              // Listen to LiveKit DataReceived so AI control messages are processed
              src: 'nativeRoomDataListener',
            },
          ],
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
        // Play sound when successfully joined the call - handled natively by CallKeep
        // (): void => {
        //   playAudio(AUDIO_PATHS.CALL_JOIN);
        // },
      ],
      on: {
        DISCONNECT: {
          target: 'disconnecting',
          actions: ({ event }): void => {
            // eslint-disable-next-line no-console
            console.log(
              '[Room Machine] Received DISCONNECT event in connected state',
              { endForAll: event.type === 'DISCONNECT' ? event.endForAll : false },
              new Error().stack,
            );
          },
        },
        TOGGLE_MIC: {
          actions: ({ context }) => {
            if (context.isNativeMode) {
              // Always read from the live room to avoid stale context.participants state
              const room = callRuntimeNativeService.getRoom();
              const currentState = room?.localParticipant.isMicrophoneEnabled ?? false;
              reactNativeBridge.livekitToggleMic(!currentState);
            } else if (context.room) {
              const currentState = context.room.localParticipant.isMicrophoneEnabled;
              void context.room.localParticipant.setMicrophoneEnabled(!currentState);
            }
          },
        },
        PUSH_TO_TALK_START: {
          actions: [
            ({ context }): void => {
              logCallAction('push_to_talk_start', {
                callId: callRuntimeNativeService.getActiveCall()?.callId,
                source: 'push_to_talk',
                isNativeMode: context.isNativeMode,
              });
            },
            assign({
              pushToTalkState: ({ context }) => {
                // Always read from live room in native mode to avoid stale state
                const isCurrentlyMuted = context.isNativeMode
                  ? !(
                      callRuntimeNativeService.getRoom()?.localParticipant.isMicrophoneEnabled ??
                      false
                    )
                  : !(context.room?.localParticipant.isMicrophoneEnabled ?? false);
                return isCurrentlyMuted ? 'active' : 'idle';
              },
            }),
            ({ context }) => {
              // Only unmute if currently muted
              const isCurrentlyMuted = context.isNativeMode
                ? !(
                    callRuntimeNativeService.getRoom()?.localParticipant.isMicrophoneEnabled ??
                    false
                  )
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
            (): void => {
              logCallAction('push_to_talk_end', {
                callId: callRuntimeNativeService.getActiveCall()?.callId,
                source: 'push_to_talk',
              });
            },
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
            if (context.isNativeMode) {
              // Always read from the live room to avoid stale context.participants state
              const room = callRuntimeNativeService.getRoom();
              const currentState = room?.localParticipant.isCameraEnabled ?? false;
              reactNativeBridge.livekitToggleCamera(!currentState);
            } else if (context.room) {
              const currentState = context.room.localParticipant.isCameraEnabled;
              void context.room.localParticipant.setCameraEnabled(!currentState);
            }
          },
        },
        TOGGLE_SCREEN_SHARE: {
          actions: ({ context }): void => {
            if (context.isNativeMode) {
              // Always read from the live room to avoid stale context.participants state.
              // This is the primary fix for "screen share doesn't work on first try" —
              // stale participant state caused the toggle direction to be wrong.
              const room = callRuntimeNativeService.getRoom();
              const currentState = room?.localParticipant.isScreenShareEnabled ?? false;
              reactNativeBridge.livekitToggleScreenShare(!currentState);
            } else if (context.room) {
              const currentState = context.room.localParticipant.isScreenShareEnabled;
              void context.room.localParticipant
                .setScreenShareEnabled(!currentState, {
                  // Request 4K resolution for maximum quality capture
                  resolution: {
                    width: 3840,
                    height: 2160,
                    frameRate: 30,
                  },
                })
                .catch((error: Error) => {
                  // User cancelled or error occurred
                  // eslint-disable-next-line no-console
                  console.log('Screen share toggle cancelled or failed:', error);
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
        TOGGLE_AI_ASSISTANT: {
          actions: [
            assign({
              isAIAssistantEnabled: ({ context }) => !context.isAIAssistantEnabled,
            }),
            ({ context }): void => {
              // Use getActiveRoom to support native mode where context.room is null
              const room = getActiveRoom(context);
              if (room) {
                const enabled = context.isAIAssistantEnabled;
                // Send data message to LiveKit room to notify Python agent
                void room.localParticipant.publishData(
                  new TextEncoder().encode(
                    JSON.stringify({
                      type: AI_MESSAGE_TYPES.VOICE_TOGGLE,
                      enabled,
                      participantId: room.localParticipant.identity,
                      participantName: room.localParticipant.name,
                    }),
                  ),
                  { reliable: true, topic: AI_DATA_TOPIC },
                );
              }
            },
          ],
        },
        AI_CONTROLLER_CHANGED: {
          actions: assign({
            aiController: ({ event }) =>
              event.controller && event.controllerName
                ? { id: event.controller, name: event.controllerName }
                : null,
            // Sync enabled state: AI is enabled when there is an active controller
            isAIAssistantEnabled: ({ event }) => !!event.controller,
            // Clear pending request for everyone when controller changes
            pendingControlRequest: () => null,
            // Clear pending request flag if local user became the controller
            isAiControlRequested: ({ event, context }) => {
              // Support both web (context.room) and native mode (context.participants)
              const localIdentity =
                context.room?.localParticipant.identity ??
                context.participants.find(p => p.isLocal)?.identity;
              if (event.controller && localIdentity && event.controller === localIdentity) {
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
              const localIdentity =
                context.room?.localParticipant.identity ??
                context.participants.find(p => p.isLocal)?.identity;
              if (localIdentity && event.requesterId === localIdentity) {
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
              const localIdentity =
                context.room?.localParticipant.identity ??
                context.participants.find(p => p.isLocal)?.identity;
              if (localIdentity && event.requesterId === localIdentity) {
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
              // Use getActiveRoom to support native mode where context.room is null
              const room = getActiveRoom(context);
              if (room && context.pendingControlRequest) {
                const payload = {
                  type: AI_MESSAGE_TYPES.CONTROL_TRANSFER,
                  // eslint-disable-next-line @typescript-eslint/naming-convention
                  new_controller_id: context.pendingControlRequest.requesterId,
                  // eslint-disable-next-line @typescript-eslint/naming-convention
                  new_controller_name: context.pendingControlRequest.requesterName,
                };
                void room.localParticipant.publishData(
                  new TextEncoder().encode(JSON.stringify(payload)),
                  { reliable: true, topic: AI_DATA_TOPIC },
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
              // Use getActiveRoom to support native mode where context.room is null
              const room = getActiveRoom(context);
              if (room && context.pendingControlRequest) {
                const payload = {
                  type: 'ai_control_request_denied',
                  requester_id: context.pendingControlRequest.requesterId,
                };
                void room.localParticipant.publishData(
                  new TextEncoder().encode(JSON.stringify(payload)),
                  { reliable: true, topic: AI_DATA_TOPIC },
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
                Alert.alert('Call ended', 'The host has ended the call for everyone');
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
          actions: 'updateParticipants',
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
              // eslint-disable-next-line no-console
              (): void =>
                console.log(
                  '[roomMachine] NATIVE_CONNECTION_STATE disconnected - transitioning to idle',
                ),
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
            // Play exit sound - handled natively by CallKeep
            // (): void => {
            //   playAudio(AUDIO_PATHS.CALL_EXIT);
            // },
            'clearContext',
          ],
        },
      },
    },
    disconnecting: {
      entry: [
        // eslint-disable-next-line no-console
        (): void => console.log('[roomMachine] Entered disconnecting state'),
        // Play sound when exiting the call - handled natively by CallKeep
        // (): void => {
        //   playAudio(AUDIO_PATHS.CALL_EXIT);
        // },
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
            // eslint-disable-next-line no-console
            (): void =>
              console.log('[roomMachine] disconnectAndCleanup onDone - transitioning to idle'),
            'clearContext',
          ],
        },
        onError: {
          target: 'idle',
          actions: [
            // eslint-disable-next-line no-console
            ({ event }): void =>
              console.error('[roomMachine] disconnectAndCleanup onError:', event),
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

// Expose roomActor on window for debugging in development
if (typeof window !== 'undefined') {
  (window as unknown as { roomActor: typeof roomActor }).roomActor = roomActor;
}
