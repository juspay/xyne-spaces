import { setup, assign, createActor, fromCallback, fromPromise } from 'xstate';
import {
  Room,
  RoomEvent as LiveKitRoomEvent,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  VideoPresets,
  ConnectionState,
  RoomConnectOptions,
  Participant,
  setLogLevel,
  DisconnectReason,
} from 'livekit-client';
import type { Zero } from '@rocicorp/zero';
import { mutators } from '../zero/mutators';
import type { Call } from '@xyne/shared';
import {
  parseAIDataMessage,
  decodeDataPayload,
  AI_DATA_TOPIC,
  type AIInviteUser,
  type AIEvent,
} from '@xyne/shared';
// import type { Mutators } from '../zero/mutators';
import { callService } from '../services/Call/callService';
import { CallType } from '@xyne/shared';
import { mixpanelService } from '../services/Analytics/mixpanelService';
import { EVENTS, EVENT_PROPERTIES } from '../services/Analytics/mixpanel.types';
import { playAudio, AUDIO_PATHS } from '../utils/audioPlayer';
import { toast } from 'sonner';
import {
  reactNativeBridge,
  detectReactNativeWebView,
  isNativeCallSupported,
} from '../utils/reactNativeBridge';
import { v4 as uuidv4 } from 'uuid';
import { logger, Event, Logger } from '../utils/logger';

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

// Context for Room state management
export interface RoomContext {
  room: Room | null;
  token: string | null;
  serverUrl: string | null;
  callType: CallType;
  participants: ParticipantInfo[];
  connectionState: ConnectionState;
  isMicEnabled: boolean;
  isCameraEnabled: boolean;
  isScreenSharing: boolean;
  error: string | null;
  externalId: string | null;
  zero: Zero | null;
  viewMode: 'mini' | 'full';
  callId: string | null;
  channelId: string | null;
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
      callType: CallType;
      targetUserIds?: string[];
      zero: Zero | null;
      callDisplayName?: string; // Display name for CallKit (DM: participant name, Channel: channel name)
      viewMode?: 'mini' | 'full';
    }
  | {
      type: 'JOIN_CALL';
      callId: string;
      zero: Zero | null;
      viewMode?: 'mini' | 'full';
    }
  | { type: 'TOGGLE_MIC' }
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
        };
      }) => {
        const { channelId, callType, targetUserIds } = input;

        // Backend now only generates LiveKit credentials, no DB writes
        // If targetUserIds is provided without channelId, backend will find/create DM or group DM channel
        const result = await callService.initiateCall({
          ...(channelId && { channelId }),
          ...(targetUserIds && targetUserIds.length > 0 && { invitedUserIds: targetUserIds }),
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
        };
      },
    ),

    // Actor to join call - Uses backend API for LiveKit token generation
    joinCall: fromPromise(async ({ input }: { input: { callId: string } }) => {
      const { callId } = input;

      // Backend now only generates LiveKit credentials, no DB writes
      const result = await callService.joinCall({ callId });

      return {
        externalId: result.externalId,
        token: result.token,
        livekitUrl: result.livekitUrl,
        callId: callId, // Pass through the externalId for DB writes
        roomLink: result.roomLink,
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
          playAudio(AUDIO_PATHS.CALL_EXIT);
        });

        // Track events
        room.on(
          LiveKitRoomEvent.TrackSubscribed,
          (
            track: RemoteTrack,
            _publication: RemoteTrackPublication,
            participant: RemoteParticipant,
          ) => {
            updateParticipants();
            sendBack({ type: 'TRACK_SUBSCRIBED', participant, track });
          },
        );

        room.on(
          LiveKitRoomEvent.TrackUnsubscribed,
          (
            track: RemoteTrack,
            _publication: RemoteTrackPublication,
            participant: RemoteParticipant,
          ) => {
            updateParticipants();
            sendBack({ type: 'TRACK_UNSUBSCRIBED', participant, track });
          },
        );

        room.on(LiveKitRoomEvent.LocalTrackPublished, () => {
          updateParticipants();
          sendBack({ type: 'LOCAL_TRACK_PUBLISHED' });
        });

        room.on(LiveKitRoomEvent.LocalTrackUnpublished, () => {
          updateParticipants();
          sendBack({ type: 'LOCAL_TRACK_UNPUBLISHED' });
        });

        // Track muted/unmuted events
        room.on(LiveKitRoomEvent.TrackMuted, updateParticipants);
        room.on(LiveKitRoomEvent.TrackUnmuted, updateParticipants);

        // Participant connected
        room.on(LiveKitRoomEvent.ParticipantConnected, (_participant: RemoteParticipant) => {
          updateParticipants();
          playAudio(AUDIO_PATHS.PARTICIPANT_JOIN);
        });

        // Error handling
        room.on(LiveKitRoomEvent.MediaDevicesError, (error: Error) => {
          sendBack({ type: 'ERROR', error: error.message });
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
            }
          },
        );

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
          externalId: string;
          roomLink?: string;
          isNativeMode: boolean;
          channelId?: string | null;
          conversationId?: string | null;
          callDisplayName?: string | null;
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
            callType: callType as 'AUDIO' | 'VIDEO',
            externalId,
            ...(roomLink && { roomLink }),
            ...(callerName && { callerName }),
            ...(channelId && { channelId }),
            ...(conversationId && { conversationId }),
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
        const { room, externalId, zero, isNativeMode, endForAll } = input;

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
              logger.error(Logger.Event.API_CALL_FAILED, {
                context: 'roomMachine.disconnectAndCleanup.endForAll',
                error: error instanceof Error ? error.message : String(error),
              });
              // Continue with disconnect even if API call fails
            }
          } else {
            // Normal disconnect - update database to mark user as left
            if (zero && externalId) {
              void zero.mutate(mutators.calls.leave({ callId: externalId, timestamp: Date.now() }));
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
        // eslint-disable-next-line no-console
        console.log(
          '[Room Machine] Received LIVEKIT_CONNECTION_STATE in connected state:',
          message.payload?.state,
        );
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
        // eslint-disable-next-line no-console
        console.log(
          '[Room Machine] Received LIVEKIT_ERROR in connected state:',
          message.payload?.error,
        );
        sendBack({ type: 'NATIVE_ERROR', error: message.payload?.error ?? 'Unknown error' });
      });

      const unsubCallEnded = reactNativeBridge.on('LIVEKIT_CALL_ENDED', message => {
        // eslint-disable-next-line no-console
        console.log(
          '[Room Machine] Received LIVEKIT_CALL_ENDED in connected state:',
          message.payload,
        );
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
        // eslint-disable-next-line no-console
        console.log('[Room Machine] nativeBridgeEventListener STOPPED - cleanup called');
        unsubConnectionState();
        unsubParticipants();
        unsubError();
        unsubCallEnded();
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
          isCameraEnabled: context.isCameraEnabled,
          isMicrophoneEnabled: context.isMicEnabled,
          isScreenShareEnabled: localParticipant.isScreenShareEnabled,
          isLocal: true,
          participant: localParticipant,
        });

        // Add remote participants
        room.remoteParticipants.forEach((participant: RemoteParticipant) => {
          participantList.push({
            identity: participant.identity,
            name: participant.name || participant.identity,
            isCameraEnabled: participant.isCameraEnabled,
            isMicrophoneEnabled: participant.isMicrophoneEnabled,
            isScreenShareEnabled: participant.isScreenShareEnabled,
            isLocal: false,
            participant: participant,
          });
        });

        return participantList;
      },
      isScreenSharing: ({ context }) => {
        return context.room?.localParticipant.isScreenShareEnabled ?? context.isScreenSharing;
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

    storeConnectionParams: assign({
      token: ({ event }) => (event.type === 'CONNECT' ? event.token : null),
      serverUrl: ({ event }) => (event.type === 'CONNECT' ? event.serverUrl : null),
      callType: ({ event }) => (event.type === 'CONNECT' ? event.callType : CallType.VIDEO),
      externalId: ({ event }) => (event.type === 'CONNECT' ? event.externalId : null),
      zero: ({ event }) => (event.type === 'CONNECT' ? event.zero : null),
      isCameraEnabled: ({ event }) =>
        event.type === 'CONNECT' ? event.callType === CallType.VIDEO : true,
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
      isMicEnabled: () => false,
      isCameraEnabled: () => true,
      isScreenSharing: () => false,
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
    }),

    enableLocalTracks: ({ context }) => {
      if (context.room) {
        const enableTracksAndSelectDevices = async (): Promise<void> => {
          try {
            // First, enable tracks and wait for them to be created
            await context.room!.localParticipant.setMicrophoneEnabled(context.isMicEnabled);

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

    writeCallToDB: ({ context }) => {
      if (context.isInitiator) {
        // Initiator: write full call record via Zero mutator
        if (context.zero && context.externalId && context.channelId && context.roomLink) {
          const params: {
            channelId: string;
            callType: CallType;
            targetUserIds?: string[];
            externalId: string;
            roomLink: string;
          } = {
            channelId: context.channelId,
            callType: context.callType,
            externalId: context.externalId,
            roomLink: context.roomLink,
          };
          if (context.targetUserIds && context.targetUserIds.length > 0) {
            params.targetUserIds = context.targetUserIds;
          }
          // Fire and forget - mutator is synchronous but DB write happens async via CDC
          try {
            const callId = uuidv4();
            const creatorParticipantId = uuidv4();
            const targetParticipantIds = params.targetUserIds?.reduce(
              (acc, userId) => {
                acc[userId] = uuidv4();
                return acc;
              },
              {} as Record<string, string>,
            );
            context.zero.mutate(
              mutators.calls.initiate({
                ...params,
                timestamp: Date.now(),
                callId,
                creatorParticipantId,
                targetParticipantIds,
              }),
            );
          } catch (error) {
            // eslint-disable-next-line no-console
            console.error('Failed to call initiate mutator:', error);
          }
        }
      } else {
        // Joiner: write participant record only via Zero mutator
        if (context.zero && context.externalId) {
          try {
            context.zero.mutate(
              mutators.calls.join({
                callId: context.externalId,
                timestamp: Date.now(),
                participantId: uuidv4(),
              }),
            );
          } catch (error) {
            // eslint-disable-next-line no-console
            console.error('Failed to call join mutator:', error);
          }
        }
      }
    },

    showJoinCallErrorToast: () => {
      toast.error('Failed to join call', {
        description: 'Unable to connect to the room. Please try again.',
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
    isMicEnabled: false,
    isCameraEnabled: false,
    isScreenSharing: false,
    error: null,
    externalId: null,
    zero: null,
    viewMode: 'mini',
    callId: null,
    channelId: null,
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
            callType: ({ event }) =>
              event.type === 'INITIATE_CALL' ? event.callType : CallType.VIDEO,
            targetUserIds: ({ event }) =>
              event.type === 'INITIATE_CALL' ? event.targetUserIds || [] : [],
            zero: ({ event }) => (event.type === 'INITIATE_CALL' ? event.zero : null),
            callDisplayName: ({ event }) =>
              event.type === 'INITIATE_CALL' ? (event.callDisplayName ?? null) : null,
            viewMode: ({ event }) =>
              event.type === 'INITIATE_CALL' && event.viewMode ? event.viewMode : ('mini' as const),
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
            const payload: { channelId?: string; callType?: 'AUDIO' | 'VIDEO' } = {
              callType: context.callType as 'AUDIO' | 'VIDEO',
            };
            if (context.channelId) {
              payload.channelId = context.channelId;
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
          } = {
            callType: context.callType,
          };
          if (context.channelId) {
            input.channelId = context.channelId;
          }
          if (context.targetUserIds && context.targetUserIds.length > 0) {
            input.targetUserIds = context.targetUserIds;
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
              isCameraEnabled: () => false,
              roomLink: ({ event }) => event.output.roomLink,
              channelId: ({ event }) => event.output.channelId,
              targetUserIds: ({ event }) => event.output.targetUserIds || [],
            }),
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
              isCameraEnabled: () => false,
              callId: ({ event }) => event.output.callId,
              roomLink: ({ event }) => event.output.roomLink,
              channelId: ({ context }) => {
                const call = context.activeCalls.find(c => c.externalId === context.callId);
                return call?.channelId || null;
              },
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
        }),
        onDone: {
          target: 'connected',
          actions: [
            ({ context }): void => {
              // Track successful call join
              if (context.callStartTime) {
                const timeTakenMs = Date.now() - context.callStartTime;
                const participantCount = context.participants.length;

                mixpanelService.track(EVENTS.PERFORMANCE_METRIC, {
                  type: EVENT_PROPERTIES.PERFORMANCE_METRIC_TYPES.CALL_JOIN,
                  timeTakenMs,
                  participantCount,
                  callType: context.callType,
                  isInitiator: context.isInitiator,
                });
              }
            },
          ],
        },
        onError: {
          target: 'idle',
          actions: [
            ({ context, event }): void => {
              // Track failed call join
              const errorMessage =
                event.error instanceof Error ? event.error.message : 'Failed to connect';
              const timeTakenMs = context.callStartTime ? Date.now() - context.callStartTime : 0;

              mixpanelService.track(EVENTS.PERFORMANCE_METRIC, {
                type: EVENT_PROPERTIES.PERFORMANCE_METRIC_TYPES.CALL_CONNECTION_FAILED,
                timeTakenMs,
                errorMessage: errorMessage,
                callType: context.callType,
                isInitiator: context.isInitiator,
              });
            },
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
          invoke: {
            src: 'nativeBridgeEventListener',
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
        // Enable mic by default when connected to ensure audio tracks are published
        assign({
          isMicEnabled: () => true,
        }),
        'enableLocalTracks',
        'updateParticipants',
        'writeCallToDB',
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
          actions: assign({
            isMicEnabled: ({ context }) => {
              const newState = !context.isMicEnabled;
              if (context.isNativeMode) {
                reactNativeBridge.livekitToggleMic(newState);
              } else if (context.room) {
                void context.room.localParticipant.setMicrophoneEnabled(newState);
              }
              return newState;
            },
          }),
        },
        TOGGLE_CAMERA: {
          actions: assign({
            isCameraEnabled: ({ context }) => {
              const newState = !context.isCameraEnabled;
              if (context.isNativeMode) {
                reactNativeBridge.livekitToggleCamera(newState);
              } else if (context.room) {
                void context.room.localParticipant.setCameraEnabled(newState);
              }
              return newState;
            },
          }),
        },
        TOGGLE_SCREEN_SHARE: {
          actions: [
            assign({
              isScreenSharing: ({ context }) => !context.isScreenSharing,
            }),
            ({ context }): void => {
              const newState = context.isScreenSharing;
              if (context.isNativeMode) {
                reactNativeBridge.livekitToggleScreenShare(newState);
              } else if (context.room) {
                void context.room.localParticipant
                  .setScreenShareEnabled(newState, {
                    // Request 4K resolution for maximum quality capture
                    resolution: {
                      width: 3840,
                      height: 2160,
                      frameRate: 30,
                    },
                  })
                  .catch((error: Error) => {
                    // User cancelled or error occurred, revert the state
                    // eslint-disable-next-line no-console
                    console.log('Screen share toggle cancelled or failed:', error);
                    // Send event to revert the state
                    roomActor.send({ type: 'SCREEN_SHARE_FAILED' });
                  });
              }
            },
          ],
        },
        SCREEN_SHARE_FAILED: {
          actions: assign({
            isScreenSharing: ({ context }) => !context.isScreenSharing,
          }),
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
                  description: 'The host has ended the call for everyone',
                  duration: 5000,
                });
              },
            ],
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
              // Update database to mark user as left (must happen before clearContext clears zero/externalId)
              ({ context }): void => {
                if (context.zero && context.externalId) {
                  // eslint-disable-next-line no-console
                  console.log(
                    '[roomMachine] Calling mutators.calls.leave for:',
                    context.externalId,
                  );
                  void context.zero.mutate(
                    mutators.calls.leave({ callId: context.externalId, timestamp: Date.now() }),
                  );
                }
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
            // Track analytics for native-initiated call end
            ({ event, context }): void => {
              if (event.type !== 'NATIVE_CALL_ENDED') return;
              const durationSeconds = Math.floor(event.durationMs / 1000);
              mixpanelService.track(EVENTS.INITIATE_ACTION, {
                type: EVENT_PROPERTIES.ACTION_TYPES.END_CALL,
                callType: event.callType,
                durationSeconds,
                isInitiator: context.isInitiator,
                initiatedBy: event.initiatedBy,
                platform: 'native',
              });
            },
            // Play exit sound
            (): void => {
              playAudio(AUDIO_PATHS.CALL_EXIT);
            },
            // Update database to mark user as left
            ({ event, context }): void => {
              if (event.type !== 'NATIVE_CALL_ENDED') return;
              if (context.zero && event.callId) {
                void context.zero.mutate(
                  mutators.calls.leave({ callId: event.callId, timestamp: Date.now() }),
                );
              }
            },
            'clearContext',
          ],
        },
      },
    },
    disconnecting: {
      entry: [
        // eslint-disable-next-line no-console
        (): void => console.log('[roomMachine] Entered disconnecting state'),
        ({ context }): void => {
          // Track call ended (no sensitive data - only metadata)
          const duration = context.callStartTime ? Date.now() - context.callStartTime : 0;
          mixpanelService.track(EVENTS.INITIATE_ACTION, {
            type: EVENT_PROPERTIES.ACTION_TYPES.END_CALL,
            callType: context.callType,
            durationSeconds: Math.floor(duration / 1000),
            isInitiator: context.isInitiator,
          });
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
      on: {
        CONNECT: {
          target: 'connecting',
          actions: ['createRoom', 'storeConnectionParams', 'clearError'],
        },
        DISCONNECT: {
          target: 'idle',
          actions: ['clearContext'],
        },
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
