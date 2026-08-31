import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { SdlcCallLink } from '@xyne/shared';
import { useSelector } from '@xstate/react';
import { useZero } from './useZero';
import { roomActor } from '../machines/roomMachine';
import { CallType, CallOrigin } from '@xyne/shared';
import { reactNativeBridge } from '../utils/reactNativeBridge';
import { usePlatform } from './usePlatform';
import { useAuthContextValues } from './useAuth';
import { isUserActiveInCall } from './useCalls';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../zero/queries';
import { isSdlcSurface } from '../config';
import { SDLC_FRAME_MESSAGE } from '../routes/SdlcScreen/sdlcFrameMessages';
import {
  getLiveCallWindowState,
  sendCallWindowCommand,
  subscribeLiveCallWindow,
} from '../utils/callWindowChannel';
import {
  openInitiateCallWindow,
  openJoinCallWindow,
  shouldUseCallWindow,
} from '../routes/CallWindow/callWindowLauncher';

type ActiveCall = QueryResultType<typeof queries.userActiveCalls>[number];

interface PendingAction {
  type: 'JOIN_CALL' | 'INITIATE_CALL';
  callId?: string;
  channelId?: string;
  targetUserIds?: string[];
  callDisplayName?: string;
  conversationId?: string;
  sdlcLink?: SdlcCallLink;
}

interface UseCallActionsOptions {
  channelId: string;
  targetUserIds?: string[] | undefined;
  callDisplayName?: string | undefined; // Display name for CallKit (DM: participant name, Channel: channel name)
  conversationId?: string | undefined; // Optional: for thread-initiated calls
  sdlcLink?: SdlcCallLink | undefined; // Optional: SDLC entity to link the call to
}

interface UseCallActionsReturn {
  handleCallClick: () => void;
  isInCall: boolean;
  isCurrentChannelOnCall: boolean;
  hasActiveCallInChannel: boolean;
  isUserInCurrentChannelCall: boolean;
  isUserInChannelCallElsewhere: boolean;
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
  conversationId,
  sdlcLink,
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
  const activeCalls = useSelector(roomActor, state => state.context.activeCalls) as ActiveCall[];

  // Find active call in the current channel. Match CHANNEL explicitly rather than
  // excluding CONVERSATION — the query is ordered newest-first, so "anything but a
  // thread call" follows a calendar call that started later and resolves the wrong
  // call. CHANNEL is what the backend converges on in findActiveCallByChannelId.
  const currentChannelCall = activeCalls?.find(
    call => call.channelId === channelId && call.callOrigin === CallOrigin.CHANNEL,
  );
  const hasActiveCallInChannel = !!currentChannelCall;

  const liveCallWindow = useSyncExternalStore(
    subscribeLiveCallWindow,
    getLiveCallWindowState,
    () => null,
  );
  const isCallWindowOnThisChannel = !!(
    currentChannelCall && liveCallWindow?.callId === currentChannelCall.externalId
  );

  // Check if user is actually in this channel's call (for both initiator and receiver)
  const isUserInCurrentChannelCall = !!(
    isCallWindowOnThisChannel ||
    (isInCall &&
      currentChannelCall &&
      (isCurrentChannelOnCall ||
        stateSnapshot.context.externalId === currentChannelCall.externalId))
  );

  // Check cross-device active status via DB participant record
  const { userID } = useAuthContextValues();
  const isUserInChannelCallElsewhere = isUserActiveInCall(
    currentChannelCall?.participants ?? [],
    userID,
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
          ...(action.conversationId && { conversationId: action.conversationId }),
          ...(action.sdlcLink && { sdlcLink: action.sdlcLink }),
        });
      }
    }
  }, [machineState, zero, isMobile]);

  const handleCallClick = (): void => {
    // SDLC lane: the iframe's call overlay is suppressed, so a call started here
    // must be owned by the HOST for its mini-view to render globally. Hand the
    // request across the frame bridge and stop — the host initiates on its own
    // roomActor and shows the global mini-view.
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
      return;
    }

    if (shouldUseCallWindow(isMobile)) {
      if (isCallWindowOnThisChannel) {
        sendCallWindowCommand('leave');
        return;
      }
      if (hasActiveCallInChannel) {
        openJoinCallWindow(currentChannelCall.externalId);
      } else {
        openInitiateCallWindow({
          channelId,
          callType: CallType.AUDIO,
          targetUserIds,
          callDisplayName,
          conversationId,
          sdlcLink,
        });
      }
      return;
    }

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
          ...(conversationId && { conversationId }),
          ...(sdlcLink && { sdlcLink }),
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
          ...(conversationId && { conversationId }),
          ...(sdlcLink && { sdlcLink }),
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
    isUserInChannelCallElsewhere,
    machineState: typeof machineState === 'string' ? machineState : JSON.stringify(machineState),
  };
};
