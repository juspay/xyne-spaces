/**
 * Lotus Native Bridge Adapter
 *
 * This adapter implements the same interface as dashboard's reactNativeBridge
 * but directly calls CallRuntimeNativeService instead of using WebView bridge.
 * This allows roomMachine to work in Lotus standalone native app.
 */
import { callRuntimeNativeService } from './CallRuntimeNativeService';
import { callKitService } from './CallKitService';
import { CallType } from '@xyne/shared';
import type { Participant } from 'livekit-client';
import type { CallKitCallType } from './CallKit.types';

// Types matching dashboard's reactNativeBridge
export interface LiveKitConnectPayload {
  token: string;
  serverUrl: string;
  callType: CallKitCallType;
  externalId: string;
  initialMicrophoneEnabled?: boolean;
  initialCameraEnabled?: boolean;
  roomLink?: string;
  callerName?: string;
  roomName?: string;
  channelId?: string;
  conversationId?: string;
  scopeType?: string | null;
}

export interface LiveKitTogglePayload {
  enabled: boolean;
}

export interface LiveKitParticipantPayload {
  identity: string;
  name?: string;
  isCameraEnabled: boolean;
  isMicrophoneEnabled: boolean;
  isScreenShareEnabled: boolean;
  isLocal: boolean;
}

export interface LiveKitConnectionStatePayload {
  state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
}

export interface LiveKitCallEndedPayload {
  callId: string;
  callType: 'AUDIO' | 'VIDEO';
  durationMs: number;
  initiatedBy: 'user' | 'callkit' | 'error';
}

export interface BridgeEnvelope<T extends string, P = Record<string, unknown> | undefined> {
  version: number;
  channel: string;
  source: string;
  type: T;
  timestamp: number;
  payload?: P;
}

type Listener = (message: BridgeEnvelope<string, unknown>) => void;

class LotusNativeBridge {
  private listeners = new Map<string, Set<Listener>>();
  private connectionState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' =
    'disconnected';
  private currentCallId: string | null = null;
  private unsubscribeFromRuntime: (() => void) | null = null;

  /**
   * Always available in Lotus (standalone native app)
   */
  isAvailable(): boolean {
    return true;
  }

  /**
   * Send a message (used for CALL_INITIATING, CALL_FAILED, etc.)
   * In Lotus, these are handled directly by CallKitService
   */
  send<T extends string>(type: T, payload?: Record<string, unknown>): boolean {
    // eslint-disable-next-line no-console
    console.log('[LotusNativeBridge] send:', type, payload);

    switch (type) {
      case 'CALL_INITIATING':
        // Handle call initiating - could trigger CallKit UI
        if (payload?.['callType'] && payload?.['channelId']) {
          const callTypeStr = payload['callType'] as string;
          const callType = callTypeStr === 'VIDEO' ? CallType.VIDEO : CallType.AUDIO;
          callKitService.startOutgoingCall(
            payload['channelId'] as string,
            (payload['callerName'] as string) || 'Call',
            callType as CallKitCallType,
          );
        }
        break;
      case 'CALL_FAILED':
        // Handle call failure - notify CallKit
        if (this.currentCallId) {
          callKitService.endCall(this.currentCallId);
        }
        break;
    }

    return true;
  }

  /**
   * Connect to LiveKit room
   */
  livekitConnect(payload: LiveKitConnectPayload): boolean {
    // eslint-disable-next-line no-console
    console.log('[LotusNativeBridge] livekitConnect called with:', {
      externalId: payload.externalId,
      callType: payload.callType,
      hasToken: !!payload.token,
      hasServerUrl: !!payload.serverUrl,
      initialMicrophoneEnabled: payload.initialMicrophoneEnabled,
      initialCameraEnabled: payload.initialCameraEnabled,
    });

    this.currentCallId = payload.externalId;
    this.connectionState = 'connecting';
    this.emit('LIVEKIT_CONNECTION_STATE', { state: 'connecting' });

    // Subscribe to runtime service state changes
    this.unsubscribeFromRuntime = callRuntimeNativeService.subscribe(state => {
      console.log('[LotusNativeBridge] Runtime state changed:', state);
      this.handleRuntimeStateChange(state);
    });

    // Connect via CallRuntimeNativeService
    const connectParams: {
      callId: string;
      callType: CallType;
      token: string;
      serverUrl: string;
      isHost: boolean;
      initialMicrophoneEnabled?: boolean;
      initialCameraEnabled?: boolean;
      roomLink?: string;
    } = {
      callId: payload.externalId,
      callType: payload.callType as CallType,
      token: payload.token,
      serverUrl: payload.serverUrl,
      isHost: true, // Will be determined by Zero data later
    };

    if (payload.initialMicrophoneEnabled !== undefined) {
      connectParams.initialMicrophoneEnabled = payload.initialMicrophoneEnabled;
    }
    if (payload.initialCameraEnabled !== undefined) {
      connectParams.initialCameraEnabled = payload.initialCameraEnabled;
    }

    // Only add roomLink if it has a value
    if (payload.roomLink) {
      connectParams.roomLink = payload.roomLink;
    }

    callRuntimeNativeService
      .connect(connectParams)
      .then(() => {
        console.log('[LotusNativeBridge] connect() succeeded');
        this.connectionState = 'connected';
        this.emit('LIVEKIT_CONNECTION_STATE', { state: 'connected' });
        this.emitParticipants();
      })
      .catch(error => {
        console.error('[LotusNativeBridge] connect() failed:', error);
        this.connectionState = 'disconnected';
        this.emit('LIVEKIT_ERROR', { error: error.message || 'Connection failed' });
        this.emit('LIVEKIT_CONNECTION_STATE', { state: 'disconnected' });
      });

    return true;
  }

  /**
   * Disconnect from LiveKit room
   */
  livekitDisconnect(): boolean {
    // eslint-disable-next-line no-console
    console.log('[LotusNativeBridge] livekitDisconnect');

    const activeCall = callRuntimeNativeService.getActiveCall();
    const durationMs = activeCall?.startedAt ? Date.now() - activeCall.startedAt : 0;

    // Emit call ended event before disconnecting
    if (this.currentCallId) {
      this.emit('LIVEKIT_CALL_ENDED', {
        callId: this.currentCallId,
        callType:
          callRuntimeNativeService.getActiveCall()?.callType === CallType.VIDEO ? 'VIDEO' : 'AUDIO',
        durationMs,
        initiatedBy: 'user' as const,
      });
    }

    callRuntimeNativeService.disconnect().then(() => {
      this.connectionState = 'disconnected';
      this.emit('LIVEKIT_CONNECTION_STATE', { state: 'disconnected' });
      this.currentCallId = null;

      // Unsubscribe from runtime service
      if (this.unsubscribeFromRuntime) {
        this.unsubscribeFromRuntime();
        this.unsubscribeFromRuntime = null;
      }
    });

    return true;
  }

  /**
   * Toggle microphone
   */
  livekitToggleMic(enabled: boolean): boolean {
    // eslint-disable-next-line no-console
    console.log('[LotusNativeBridge] livekitToggleMic:', enabled);
    void callRuntimeNativeService.toggleMic(enabled);
    return true;
  }

  /**
   * Toggle camera
   */
  livekitToggleCamera(enabled: boolean): boolean {
    // eslint-disable-next-line no-console
    console.log('[LotusNativeBridge] livekitToggleCamera:', enabled);
    void callRuntimeNativeService.toggleCamera(enabled);
    return true;
  }

  /**
   * Toggle screen share
   */
  livekitToggleScreenShare(enabled: boolean): boolean {
    // eslint-disable-next-line no-console
    console.log('[LotusNativeBridge] livekitToggleScreenShare:', enabled);
    void callRuntimeNativeService.toggleScreenShare(enabled);
    return true;
  }

  /**
   * Subscribe to bridge events
   */
  on(type: string, handler: (message: BridgeEnvelope<string, unknown>) => void): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);

    // Return unsubscribe function
    return () => {
      const typeListeners = this.listeners.get(type);
      if (typeListeners) {
        typeListeners.delete(handler);
        if (typeListeners.size === 0) {
          this.listeners.delete(type);
        }
      }
    };
  }

  /**
   * Handle state changes from CallRuntimeNativeService
   */
  private handleRuntimeStateChange(state: {
    connectionState: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
    activeCall: {
      callId: string;
      callType: CallType;
      startedAt: number;
      roomLink?: string;
      isHost: boolean;
    } | null;
    participantCount: number;
    error: string | null;
  }): void {
    // Map runtime states to bridge states
    const stateMap: Record<string, 'disconnected' | 'connecting' | 'connected' | 'reconnecting'> = {
      idle: 'disconnected',
      connecting: 'connecting',
      connected: 'connected',
      disconnected: 'disconnected',
      error: 'disconnected',
    };

    const newState = stateMap[state.connectionState] || 'disconnected';

    if (newState !== this.connectionState) {
      this.connectionState = newState;
      this.emit('LIVEKIT_CONNECTION_STATE', { state: newState });
    }

    // Emit error if present
    if (state.error) {
      this.emit('LIVEKIT_ERROR', { error: state.error });
    }

    // Emit participants whenever connected — this keeps track state (mic/camera/screen)
    // in roomMachine context up-to-date after every LiveKit track event.
    if (state.connectionState === 'connected') {
      this.emitParticipants();
    }
  }

  /**
   * Emit participants from the room
   */
  private emitParticipants(): void {
    const room = callRuntimeNativeService.getRoom();
    if (!room) return;

    const participants: LiveKitParticipantPayload[] = [];

    // Add local participant
    participants.push({
      identity: room.localParticipant.identity,
      name: room.localParticipant.name || 'You',
      isCameraEnabled: room.localParticipant.isCameraEnabled,
      isMicrophoneEnabled: room.localParticipant.isMicrophoneEnabled,
      isScreenShareEnabled: room.localParticipant.isScreenShareEnabled,
      isLocal: true,
    });

    // Add remote participants
    room.remoteParticipants.forEach((participant: Participant) => {
      participants.push({
        identity: participant.identity,
        name: participant.name || participant.identity,
        isCameraEnabled: participant.isCameraEnabled,
        isMicrophoneEnabled: participant.isMicrophoneEnabled,
        isScreenShareEnabled: participant.isScreenShareEnabled,
        isLocal: false,
      });
    });

    this.emit('LIVEKIT_PARTICIPANTS_CHANGED', { participants });
  }

  /**
   * Emit an event to listeners
   */
  private emit(type: string, payload: unknown): void {
    const envelope: BridgeEnvelope<string, unknown> = {
      version: 1,
      channel: 'xyne-spaces-bridge',
      source: 'xyne-native',
      type,
      timestamp: Date.now(),
      payload: payload as Record<string, unknown>,
    };

    const typeListeners = this.listeners.get(type);
    if (typeListeners) {
      typeListeners.forEach(listener => {
        try {
          listener(envelope);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error('[LotusNativeBridge] Listener error:', error);
        }
      });
    }
  }

  /**
   * Get client session ID (stub for Lotus)
   */
  async getClientSessionId(): Promise<string> {
    return 'lotus-native-session';
  }
}

export const lotusNativeBridge = new LotusNativeBridge();
