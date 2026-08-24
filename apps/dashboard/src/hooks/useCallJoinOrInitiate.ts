import { useEffect, useRef } from 'react';
import type { SdlcCallLink } from '@xyne/shared';
import { useSelector } from '@xstate/react';
import { useZero } from './useZero';
import { roomActor } from '../machines/roomMachine';
import { CallType } from '@xyne/shared';
import { reactNativeBridge } from '../utils/reactNativeBridge';
import { usePlatform } from './usePlatform';
import { isSdlcSurface } from '../config';
import { SDLC_FRAME_MESSAGE } from '../routes/SdlcScreen/sdlcFrameMessages';

interface JoinCallParams {
  callId: string;
  onComplete?: () => void;
}

interface InitiateCallParams {
  channelId: string;
  targetUserIds?: string[];
  callDisplayName?: string;
  conversationId?: string;
  artifactMessageId?: string;
  sdlcLink?: SdlcCallLink;
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

  // Store pending action and completion callback. Joins no longer queue here —
  // the machine switches calls on its own — so this is the initiate path only.
  const pendingActionRef = useRef<{
    type: 'INITIATE_CALL';
    channelId?: string;
    targetUserIds?: string[];
    callDisplayName?: string;
    conversationId?: string;
    artifactMessageId?: string;
    sdlcLink?: SdlcCallLink;
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

      if (action.type === 'INITIATE_CALL' && action.channelId) {
        roomActor.send({
          type: 'INITIATE_CALL',
          channelId: action.channelId,
          callType: CallType.AUDIO,
          zero,
          viewMode: isMobile ? 'full' : 'mini',
          ...(action.targetUserIds && { targetUserIds: action.targetUserIds }),
          ...(action.callDisplayName && { callDisplayName: action.callDisplayName }),
          ...(action.conversationId && { conversationId: action.conversationId }),
          ...(action.artifactMessageId && { artifactMessageId: action.artifactMessageId }),
          ...(action.sdlcLink && { sdlcLink: action.sdlcLink }),
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
   * Join a specific call.
   *
   * Sent straight to the machine, in a call or not: it is the one place that
   * knows which call this session is in, so it is where "already in this call"
   * and "switch out of the current one" get decided. `allowSwitch` carries the
   * intent this hook has always had — every caller is a user asking to be in
   * the call — so a different call still ends the current one and joins.
   */
  const joinCall = ({ callId, onComplete }: JoinCallParams): void => {
    if (!callId) return;

    requestMediaPermissions();
    roomActor.send({
      type: 'JOIN_CALL',
      callId,
      zero,
      viewMode: isMobile ? 'full' : 'mini',
      allowSwitch: true,
    });
    onComplete?.();
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
    sdlcLink,
    onComplete,
  }: InitiateCallParams): void => {
    if (!channelId) return;

    // SDLC lane: the iframe's call overlay is deliberately suppressed, so a call
    // started here must be owned by the HOST for its mini-view to render globally.
    // Hand the request across the frame bridge and stop — the host's roomActor
    // takes it from here. onComplete stays local (it cannot cross the boundary).
    if (isSdlcSurface) {
      window.parent?.postMessage(
        {
          type: SDLC_FRAME_MESSAGE.initiateCall,
          channelId,
          ...(targetUserIds && { targetUserIds }),
          ...(callDisplayName && { callDisplayName }),
          ...(conversationId && { conversationId }),
          ...(sdlcLink && { sdlcLink }),
        },
        window.location.origin,
      );
      onComplete?.();
      return;
    }

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
        ...(artifactMessageId && { artifactMessageId }),
        ...(sdlcLink && { sdlcLink }),
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
      ...(artifactMessageId && { artifactMessageId }),
      ...(sdlcLink && { sdlcLink }),
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
