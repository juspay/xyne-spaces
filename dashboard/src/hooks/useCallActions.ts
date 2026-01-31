import { useEffect, useRef } from 'react';
import { useSelector } from '@xstate/react';
import { useZero } from '@rocicorp/zero/react';
import { roomActor } from '../machines/roomMachine';
import { CallType } from '@xyne/shared';
import { reactNativeBridge } from '../utils/reactNativeBridge';
import { usePlatform } from './usePlatform';

interface PendingAction {
  type: 'JOIN_CALL' | 'INITIATE_CALL';
  callId?: string;
  channelId?: string;
  targetUserIds?: string[];
  callDisplayName?: string;
}

interface UseCallActionsOptions {
  channelId: string;
  targetUserIds?: string[] | undefined;
  callDisplayName?: string | undefined; // Display name for CallKit (DM: participant name, Channel: channel name)
}

interface UseCallActionsReturn {
  handleCallClick: () => void;
  isInCall: boolean;
  isCurrentChannelOnCall: boolean;
  hasActiveCallInChannel: boolean;
  isUserInCurrentChannelCall: boolean;
  machineState: string;
}

/**
 * Custom hook to manage call actions and state
 * Handles joining, initiating, and disconnecting from calls
 * Manages pending actions when switching between calls
 */
export const useCallActions = ({
  channelId,
  targetUserIds,
  callDisplayName,
}: UseCallActionsOptions): UseCallActionsReturn => {
  const zero = useZero();
  const { isMobile } = usePlatform();
  const pendingActionRef = useRef<PendingAction | null>(null);

  // Get state from roomActor
  const stateSnapshot = useSelector(roomActor, state => state);
  const machineState = stateSnapshot.value;

  // Handle both simple states ('initiating') and nested states ({connected: 'webMode'})
  const isInCall =
    stateSnapshot.matches('initiating') ||
    stateSnapshot.matches('joining') ||
    stateSnapshot.matches('connecting') ||
    stateSnapshot.matches('connected');

  const isCurrentChannelOnCall = isInCall && stateSnapshot.context.channelId === channelId;

  // Get active calls from roomActor context
  const activeCalls = useSelector(roomActor, state => state.context.activeCalls);

  // Find active call in the current channel
  const currentChannelCall = activeCalls?.find(call => call.channelId === channelId);
  const hasActiveCallInChannel = !!currentChannelCall;

  // Check if user is actually in this channel's call (for both initiator and receiver)
  const isUserInCurrentChannelCall = !!(
    isInCall &&
    currentChannelCall &&
    (isCurrentChannelOnCall || stateSnapshot.context.externalId === currentChannelCall.externalId)
  );

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
      } else if (action.type === 'INITIATE_CALL' && action.channelId) {
        roomActor.send({
          type: 'INITIATE_CALL',
          channelId: action.channelId,
          callType: CallType.AUDIO,
          zero,
          viewMode: isMobile ? 'full' : 'mini',
          ...(action.targetUserIds && { targetUserIds: action.targetUserIds }),
          ...(action.callDisplayName && { callDisplayName: action.callDisplayName }),
        });
      }
    }
  }, [machineState, zero, isMobile]);

  const handleCallClick = (): void => {
    if (hasActiveCallInChannel) {
      // If there's an active call in this channel
      if (isUserInCurrentChannelCall) {
        // User is in this channel's call - leave it
        roomActor.send({ type: 'DISCONNECT' });
      } else if (isInCall) {
        // User is in another call, need to disconnect first then join
        pendingActionRef.current = {
          type: 'JOIN_CALL',
          callId: currentChannelCall.externalId,
        };
        roomActor.send({ type: 'DISCONNECT' });
      } else {
        // Call exists and user is not in any call - join it
        // Request media permissions from native before joining call
        if (reactNativeBridge.isAvailable()) {
          reactNativeBridge.requestMediaPermissions({
            permissions: ['microphone', 'camera', 'screenShare'],
          });
        }
        roomActor.send({
          type: 'JOIN_CALL',
          callId: currentChannelCall.externalId,
          zero,
          viewMode: isMobile ? 'full' : 'mini',
        });
      }
    } else {
      // No active call in this channel
      if (isInCall) {
        // User is in another call - disconnect first then initiate new one
        pendingActionRef.current = {
          type: 'INITIATE_CALL',
          channelId,
          ...(targetUserIds && { targetUserIds }),
          ...(callDisplayName && { callDisplayName }),
        };
        roomActor.send({ type: 'DISCONNECT' });
      } else {
        // User is not in any call - initiate new call
        // Request media permissions from native before starting call
        if (reactNativeBridge.isAvailable()) {
          reactNativeBridge.requestMediaPermissions({
            permissions: ['microphone', 'camera', 'screenShare'],
          });
        }
        roomActor.send({
          type: 'INITIATE_CALL',
          channelId,
          callType: CallType.AUDIO,
          zero,
          viewMode: isMobile ? 'full' : 'mini',
          ...(targetUserIds && { targetUserIds }),
          ...(callDisplayName && { callDisplayName }),
        });
      }
    }
  };

  return {
    handleCallClick,
    isInCall,
    isCurrentChannelOnCall,
    hasActiveCallInChannel,
    isUserInCurrentChannelCall,
    machineState: typeof machineState === 'string' ? machineState : JSON.stringify(machineState),
  };
};
