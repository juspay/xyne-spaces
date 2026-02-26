import { useEffect, useRef } from 'react';
import { useSelector } from '@xstate/react';
import { useZero } from './useZero';
import { roomActor } from '../machines/roomMachine';
import { CallType } from '@xyne/shared';
import { reactNativeBridge } from '../utils/reactNativeBridge';
import { usePlatform } from './usePlatform';

interface JoinCallParams {
  callId: string;
  onComplete?: () => void;
}

interface InitiateCallParams {
  channelId: string;
  targetUserIds?: string[];
  callDisplayName?: string;
  conversationId?: string;
  onComplete?: () => void;
}

interface UseCallJoinOrInitiateReturn {
  joinCall: (params: JoinCallParams) => void;
  initiateCall: (params: InitiateCallParams) => void;
  isInCall: boolean;
  machineState: string | object;
}

export const useCallJoinOrInitiate = (): UseCallJoinOrInitiateReturn => {
  const zero = useZero();
  const { isMobile } = usePlatform();

  // Store pending action and completion callback
  const pendingActionRef = useRef<{
    type: 'JOIN_CALL' | 'INITIATE_CALL';
    callId?: string;
    channelId?: string;
    targetUserIds?: string[];
    callDisplayName?: string;
    conversationId?: string;
    onComplete?: () => void;
  } | null>(null);

  // Get state from roomActor
  const stateSnapshot = useSelector(roomActor, state => state);
  const machineState = stateSnapshot.value;

  // Check if user is in any call
  const isInCall =
    stateSnapshot.matches('initiating') ||
    stateSnapshot.matches('joining') ||
    stateSnapshot.matches('connecting') ||
    stateSnapshot.matches('connected');

  // Watch for machine state changes and execute pending action when idle
  useEffect(() => {
    if (machineState === 'idle' && pendingActionRef.current) {
      const action = pendingActionRef.current;
      pendingActionRef.current = null;

      // Request media permissions from native before starting/joining call
      if (reactNativeBridge.isAvailable()) {
        reactNativeBridge.requestMediaPermissions({
          permissions: ['microphone', 'camera', 'screenShare'],
        });
      }

      if (action.type === 'JOIN_CALL' && action.callId) {
        roomActor.send({
          type: 'JOIN_CALL',
          callId: action.callId,
          zero,
          viewMode: isMobile ? 'full' : 'mini',
        });

        // Call completion callback after sending join event
        action.onComplete?.();
      } else if (action.type === 'INITIATE_CALL' && action.channelId) {
        roomActor.send({
          type: 'INITIATE_CALL',
          channelId: action.channelId,
          callType: CallType.AUDIO,
          zero,
          viewMode: isMobile ? 'full' : 'mini',
          ...(action.targetUserIds && { targetUserIds: action.targetUserIds }),
          ...(action.callDisplayName && { callDisplayName: action.callDisplayName }),
          ...(action.conversationId && { conversationId: action.conversationId }),
        });

        // Call completion callback after sending initiate event
        action.onComplete?.();
      }
    }
  }, [machineState, zero, isMobile]);

  /**
   * Request media permissions (common helper)
   */
  const requestMediaPermissions = (): void => {
    if (reactNativeBridge.isAvailable()) {
      reactNativeBridge.requestMediaPermissions({
        permissions: ['microphone', 'camera', 'screenShare'],
      });
    }
  };

  /**
   * Join a specific call
   */
  const joinCall = ({ callId, onComplete }: JoinCallParams): void => {
    if (!callId) return;

    // Case 1: User not in any call - join directly
    if (!isInCall) {
      requestMediaPermissions();
      roomActor.send({
        type: 'JOIN_CALL',
        callId,
        zero,
        viewMode: isMobile ? 'full' : 'mini',
      });
      onComplete?.();
      return;
    }

    // Case 2: User is in another call - disconnect first, then join
    pendingActionRef.current = {
      type: 'JOIN_CALL',
      callId,
      ...(onComplete && { onComplete }),
    };
    roomActor.send({ type: 'DISCONNECT' });
    // Note: onComplete will be called after join completes (in useEffect)
  };

  /**
   * Initiate a new call
   */
  const initiateCall = ({
    channelId,
    targetUserIds,
    callDisplayName,
    conversationId,
    onComplete,
  }: InitiateCallParams): void => {
    if (!channelId) return;

    // Case 1: User not in any call - initiate directly
    if (!isInCall) {
      requestMediaPermissions();
      roomActor.send({
        type: 'INITIATE_CALL',
        channelId,
        callType: CallType.AUDIO,
        zero,
        viewMode: isMobile ? 'full' : 'mini',
        ...(targetUserIds && { targetUserIds }),
        ...(callDisplayName && { callDisplayName }),
        ...(conversationId && { conversationId }),
      });
      onComplete?.();
      return;
    }

    // Case 2: User is in another call - disconnect first, then initiate
    pendingActionRef.current = {
      type: 'INITIATE_CALL',
      channelId,
      ...(targetUserIds && { targetUserIds }),
      ...(callDisplayName && { callDisplayName }),
      ...(conversationId && { conversationId }),
      ...(onComplete && { onComplete }),
    };
    roomActor.send({ type: 'DISCONNECT' });
    // Note: onComplete will be called after initiate completes (in useEffect)
  };

  return {
    joinCall,
    initiateCall,
    isInCall,
    machineState: typeof machineState === 'string' ? machineState : JSON.stringify(machineState),
  };
};
