import { useEffect, useRef } from 'react';
import { useSelector } from '@xstate/react';
import { useZero } from './useZero';
import { roomActor } from '../machines/roomMachine';
import { CallType } from '@xyne/shared';
import { reactNativeBridge } from '../utils/reactNativeBridge';
import { usePlatform } from './usePlatform';

/**
 * Call setup a caller can request up front, applied by roomMachine as the call
 * connects. Every field is optional; omitting one keeps the existing default
 * (platform-derived view mode, user's saved mic/camera join preferences).
 */
interface CallSetupOverrides {
  viewMode?: 'full' | 'mini';
  initialMicEnabled?: boolean;
  initialCameraEnabled?: boolean;
  initialPresentationMode?: boolean;
  isUrlDrivenJoin?: boolean;
}

interface JoinCallParams extends CallSetupOverrides {
  callId: string;
  onComplete?: () => void;
}

interface InitiateCallParams extends CallSetupOverrides {
  channelId: string;
  targetUserIds?: string[];
  callDisplayName?: string;
  conversationId?: string;
  artifactMessageId?: string;
  onComplete?: () => void;
}

/**
 * Only forward the media fields the caller actually set — a literal `undefined`
 * and an absent key mean the same thing to roomMachine, but keeping them absent
 * matches how the other optional event fields are spread below.
 */
const mediaOverrideFields = (
  overrides: CallSetupOverrides,
): Pick<
  CallSetupOverrides,
  'initialMicEnabled' | 'initialCameraEnabled' | 'initialPresentationMode' | 'isUrlDrivenJoin'
> => ({
  ...(overrides.initialMicEnabled !== undefined && {
    initialMicEnabled: overrides.initialMicEnabled,
  }),
  ...(overrides.initialCameraEnabled !== undefined && {
    initialCameraEnabled: overrides.initialCameraEnabled,
  }),
  ...(overrides.initialPresentationMode !== undefined && {
    initialPresentationMode: overrides.initialPresentationMode,
  }),
  ...(overrides.isUrlDrivenJoin !== undefined && {
    isUrlDrivenJoin: overrides.isUrlDrivenJoin,
  }),
});

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
  const pendingActionRef = useRef<
    | (CallSetupOverrides & {
        type: 'JOIN_CALL' | 'INITIATE_CALL';
        callId?: string;
        channelId?: string;
        targetUserIds?: string[];
        callDisplayName?: string;
        conversationId?: string;
        artifactMessageId?: string;
    onComplete?: () => void;
      })
    | null
  >(null);

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
          viewMode: action.viewMode ?? (isMobile ? 'full' : 'mini'),
          ...mediaOverrideFields(action),
        });

        // Call completion callback after sending join event
        action.onComplete?.();
      } else if (action.type === 'INITIATE_CALL' && action.channelId) {
        roomActor.send({
          type: 'INITIATE_CALL',
          channelId: action.channelId,
          callType: CallType.AUDIO,
          zero,
          viewMode: action.viewMode ?? (isMobile ? 'full' : 'mini'),
          ...mediaOverrideFields(action),
          ...(action.targetUserIds && { targetUserIds: action.targetUserIds }),
          ...(action.callDisplayName && { callDisplayName: action.callDisplayName }),
          ...(action.conversationId && { conversationId: action.conversationId }),
          ...(action.artifactMessageId && { artifactMessageId: action.artifactMessageId }),
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
  const joinCall = ({ callId, onComplete, ...overrides }: JoinCallParams): void => {
    if (!callId) return;

    // Case 1: User not in any call - join directly
    if (!isInCall) {
      requestMediaPermissions();
      roomActor.send({
        type: 'JOIN_CALL',
        callId,
        zero,
        viewMode: overrides.viewMode ?? (isMobile ? 'full' : 'mini'),
        ...mediaOverrideFields(overrides),
      });
      onComplete?.();
      return;
    }

    // Case 2: User is in another call - disconnect first, then join
    pendingActionRef.current = {
      type: 'JOIN_CALL',
      callId,
      ...overrides,
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
    artifactMessageId,
    onComplete,
    ...overrides
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
        viewMode: overrides.viewMode ?? (isMobile ? 'full' : 'mini'),
        ...mediaOverrideFields(overrides),
        ...(targetUserIds && { targetUserIds }),
        ...(callDisplayName && { callDisplayName }),
        ...(conversationId && { conversationId }),
        ...(artifactMessageId && { artifactMessageId }),
      });
      onComplete?.();
      return;
    }

    // Case 2: User is in another call - disconnect first, then initiate
    pendingActionRef.current = {
      type: 'INITIATE_CALL',
      channelId,
      ...overrides,
      ...(targetUserIds && { targetUserIds }),
      ...(callDisplayName && { callDisplayName }),
      ...(conversationId && { conversationId }),
      ...(artifactMessageId && { artifactMessageId }),
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
