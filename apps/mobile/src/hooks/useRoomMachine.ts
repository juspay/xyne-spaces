/**
 * Hook to interact with the roomMachine for Lotus
 * Provides reactive state from the XState machine
 */
import { useCallback } from 'react';
import { useSyncExternalStore } from 'react';
import { roomActor, type RoomContext, type RoomMachineEvent } from '@/src/machines/roomMachine';
import { CallType } from '@xyne/shared';
import type { Zero } from '@rocicorp/zero';

// Selector function type
type Selector<T> = (context: RoomContext) => T;

/**
 * Subscribe to roomMachine state changes
 */
function subscribe(callback: () => void): () => void {
  const subscription = roomActor.subscribe(callback);
  return () => subscription.unsubscribe();
}

/**
 * Get current context from roomMachine
 */
function getSnapshot(): RoomContext {
  return roomActor.getSnapshot().context;
}

/**
 * Hook to select specific data from roomMachine context
 */
export function useRoomSelector<T>(selector: Selector<T>): T {
  return useSyncExternalStore(
    subscribe,
    useCallback(() => selector(getSnapshot()), [selector]),
  );
}

/**
 * Hook to get the full roomMachine state
 */
export function useRoomState(): RoomContext {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * Hook to get roomMachine send function
 */
export function useRoomSend() {
  return useCallback((event: RoomMachineEvent) => {
    roomActor.send(event);
  }, []);
}

/**
 * Hook to get the current machine state value (e.g., 'idle', 'connecting', 'connected')
 * Handles XState v5 nested states (e.g., { connected: 'nativeMode' } -> 'connected')
 */
export function useRoomStatus(): string {
  return useSyncExternalStore(
    subscribe,
    useCallback(() => {
      const snapshot = roomActor.getSnapshot();
      const value = snapshot.value;

      // Handle nested states (e.g., { connected: 'nativeMode' } -> 'connected')
      if (typeof value === 'object' && value !== null) {
        return Object.keys(value)[0] ?? 'unknown';
      }

      return value as string;
    }, []),
  );
}

/**
 * Returns true whenever the room machine is in an active call state
 * (initiating, connecting, connected, or disconnecting).
 * Mirrors the dashboard's `isInCall` check in useCallHistory.
 */
export function useIsInCall(): boolean {
  return useSyncExternalStore(
    subscribe,
    useCallback(() => {
      const snapshot = roomActor.getSnapshot();
      const value = snapshot.value;
      const topState =
        typeof value === 'object' && value !== null
          ? (Object.keys(value)[0] ?? 'idle')
          : (value as string);
      return (
        topState === 'initiating' ||
        topState === 'connecting' ||
        topState === 'connected' ||
        topState === 'disconnecting'
      );
    }, []),
  );
}

/**
 * Hook to get the externalId of the call the user is currently in on this device.
 * Returns null when not in a call. Used for `isUserInThisDevice` checks.
 */
export function useCurrentCallExternalId(): string | null {
  return useSyncExternalStore(
    subscribe,
    useCallback(() => roomActor.getSnapshot().context.externalId, []),
  );
}

/**
 * Hook for call actions
 */
export function useCallActions() {
  const send = useRoomSend();

  return {
    initiateCall: useCallback(
      (params: {
        channelId?: string;
        scopeType?: string;
        callType: CallType;
        targetUserIds?: string[];
        zero: Zero | null;
        callDisplayName?: string;
        viewMode?: 'mini' | 'full';
        conversationId?: string;
      }) => {
        send({
          type: 'INITIATE_CALL',
          ...params,
        });
      },
      [send],
    ),

    joinCall: useCallback(
      (params: { callId: string; zero: Zero | null; viewMode?: 'mini' | 'full' }) => {
        send({
          type: 'JOIN_CALL',
          ...params,
        });
      },
      [send],
    ),

    disconnect: useCallback(
      (endForAll?: boolean) => {
        const event: RoomMachineEvent = { type: 'DISCONNECT' };
        if (endForAll !== undefined) {
          event.endForAll = endForAll;
        }
        send(event);
      },
      [send],
    ),

    toggleMic: useCallback(() => {
      send({ type: 'TOGGLE_MIC' });
    }, [send]),

    toggleCamera: useCallback(() => {
      send({ type: 'TOGGLE_CAMERA' });
    }, [send]),

    toggleScreenShare: useCallback(() => {
      send({ type: 'TOGGLE_SCREEN_SHARE' });
    }, [send]),

    toggleAIAssistant: useCallback(() => {
      send({ type: 'TOGGLE_AI_ASSISTANT' });
    }, [send]),

    approveControlRequest: useCallback(() => {
      send({ type: 'APPROVE_CONTROL_REQUEST' });
    }, [send]),

    denyControlRequest: useCallback(() => {
      send({ type: 'DENY_CONTROL_REQUEST' });
    }, [send]),

    requestAIControl: useCallback(() => {
      send({ type: 'AI_CONTROL_REQUEST_SENT' });
    }, [send]),
  };
}

/**
 * Convenience hook that combines state and actions
 */
export function useRoomMachine() {
  const context = useRoomState();
  const status = useRoomStatus();
  const actions = useCallActions();

  return {
    // State
    context,
    status,

    // Derived state
    participants: context.participants,
    connectionState: context.connectionState,
    isMicrophoneEnabled: context.participants.find(p => p.isLocal)?.isMicrophoneEnabled ?? false,
    isCameraEnabled: context.participants.find(p => p.isLocal)?.isCameraEnabled ?? false,
    isScreenShareEnabled: context.participants.find(p => p.isLocal)?.isScreenShareEnabled ?? false,
    isAIAssistantEnabled: context.isAIAssistantEnabled,
    aiController: context.aiController,
    pendingControlRequest: context.pendingControlRequest,
    isAiControlRequested: context.isAiControlRequested,
    callStartTime: context.callStartTime,
    error: context.error,
    roomLink: context.roomLink,
    externalId: context.externalId,
    channelId: context.channelId,

    // Status checks
    isIdle: status === 'idle',
    isInitiating: status === 'initiating',
    isJoining: status === 'joining',
    isConnecting: status === 'connecting',
    isConnected: status === 'connected',
    isDisconnecting: status === 'disconnecting',
    isFailed: status === 'failed',

    // Actions
    ...actions,
  };
}
