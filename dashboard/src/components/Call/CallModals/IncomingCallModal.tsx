import { Phone, Video, PhoneOff } from 'lucide-react';
import { useSelector } from '@xstate/react';
import { useEffect, useRef, useMemo, useCallback } from 'react';
import { useZero } from '../../../hooks/useZero';
import { QueryResultType } from '@rocicorp/zero';
import { useAuth } from '../../../hooks/useAuth';
import { callActor } from '../../../machines/callMachine';
import { roomActor } from '../../../machines/roomMachine';
import { CallParticipant, CallType, Channel } from '@xyne/shared';
import { mutators } from '../../../zero/mutators';
import { InvitationResponse, ChannelScopeType } from '@xyne/shared';
import { queries } from '../../../zero/queries';
import { useAllChannels } from '../../../hooks/useChannels';
import {
  Button,
  ButtonType,
  ButtonSize,
  ButtonSubType,
  Avatar,
  AvatarShape,
  AvatarSize,
  Modal,
} from '@juspay/blend-design-system';
import { useUsers } from '../../../hooks/useUsers';

type CallWithRelations = QueryResultType<typeof queries.userActiveCalls>[number];

export function IncomingCallModal(): React.ReactElement | null {
  const { user } = useAuth();
  const zero = useZero();
  const allUsers = useUsers();

  // Use selectors to get state from the call actor
  const callState = useSelector(callActor, snapshot => snapshot.value);
  const incomingCallQueue = useSelector(callActor, snapshot => snapshot.context.incomingCallQueue);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const processingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Get active calls from roomActor context and filter for incoming calls (where user is invited)
  const allActiveCalls = useSelector(roomActor, state => state.context.activeCalls);
  const currentCallId = useSelector(roomActor, state => state.context.externalId); // Get current call ID
  // Get nativeActiveCallId - calls joined via VoIP notification before Zero syncs
  const nativeActiveCallId = useSelector(
    callActor,
    snapshot => snapshot.context.nativeActiveCallId,
  );

  // Check if user is currently in an active call (reactive)
  const roomState = useSelector(roomActor, state => state.value);
  const roomSnapshot = useSelector(roomActor, state => state);
  const isInActiveCall =
    roomSnapshot.matches('initiating') ||
    roomSnapshot.matches('joining') ||
    roomSnapshot.matches('connecting') ||
    roomSnapshot.matches('connected');

  // Only allow incoming call notifications in stable states (idle or connected)
  const canShowIncomingCalls =
    roomState === 'idle' || (typeof roomState === 'object' && 'connected' in roomState);

  const allChannels = useAllChannels();
  const channelMap = useMemo(() => {
    const map = new Map<string, Channel>();
    allChannels.forEach(ch => map.set(ch.id, ch));
    return map;
  }, [allChannels]);

  // Filter for calls where user has 'INVITED' status
  // Exclude calls from DEFAULT scope channels (channel calls should not show invitation modal)
  // Also exclude the call active in the room (if we just joined it via notification)
  const incomingCalls = allActiveCalls?.filter(call => {
    // If we are already in this call (connecting/connected), don't show incoming modal for it
    if (currentCallId && call.externalId === currentCallId) {
      return false;
    }

    // If this call was joined via native VoIP notification (cold start), exclude it
    // This prevents the modal from showing before Zero syncs the participant status
    if (nativeActiveCallId && call.externalId === nativeActiveCallId) {
      return false;
    }

    const callWithRelations = call as CallWithRelations;
    const channel = call.channelId ? channelMap.get(call.channelId) : null;

    // Filter out DEFAULT scope channel calls
    if (channel?.scopeType === ChannelScopeType.DEFAULT) {
      return false;
    }

    const userParticipant = callWithRelations.participants?.find(
      (p: CallParticipant) => p.userId === user?.id,
    );
    // Exclude if user has already left the call (leftAt !== null) or if not invited
    return (
      userParticipant?.response === InvitationResponse.INVITED && userParticipant?.leftAt === null
    );
  });

  useEffect(() => {
    // Clear any existing timeout
    if (processingTimeoutRef.current) {
      clearTimeout(processingTimeoutRef.current);
    }

    // Debounce processing incoming calls to allow state transitions to complete
    processingTimeoutRef.current = setTimeout(() => {
      // Only process incoming calls when in stable states (not during transitions)
      if (!canShowIncomingCalls) return;

      // Get current active call IDs from database
      const activeCallIds = new Set(incomingCalls?.map(call => String(call.externalId)) || []);

      // Check if current ringing call is still active in database
      const currentCall = incomingCallQueue[0];
      if (currentCall && !activeCallIds.has(currentCall.callId)) {
        // Call was ended/cancelled by initiator, auto-reject it
        callActor.send({ type: 'REJECT' });
        return;
      }

      if (!incomingCalls?.length) return;

      // Build a quick lookup for users by ID from XState store
      const usersById = new Map(allUsers.map(u => [u.id, u]));

      incomingCalls.forEach(call => {
        const callId = String(call.externalId);
        const callWithRelations = call as CallWithRelations;

        // Find current user's participant record to get who invited them
        const userParticipant = callWithRelations.participants?.find(
          (p: CallParticipant) => p.userId === user?.id,
        );

        // Use the inviter instead of the original call creator
        const inviterUserId = userParticipant?.invitedBy ?? callWithRelations.createdByUserId ?? '';
        const inviterUser = inviterUserId ? usersById.get(inviterUserId) : undefined;

        const callData = {
          callId,
          caller: {
            id: inviterUserId ?? '',
            name: inviterUser?.name ?? 'Unknown',
            email: inviterUser?.email ?? '',
            picture: inviterUser?.picture ?? '',
          },
          callType: call.callType,
        };

        callActor.send({
          type: 'INCOMING_CALL',
          callData,
        });
      });
    }, 500); // 500ms delay to allow state transitions to complete

    return (): void => {
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
      }
    };
  }, [incomingCalls, incomingCallQueue, canShowIncomingCalls, user?.id]);

  // Initialize audio once
  useEffect(() => {
    audioRef.current = new Audio('/sounds/call_ringtone.mp3');
    audioRef.current.loop = true;

    return (): void => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }
    };
  }, []);

  // Check if we're in the ringing state (simplified)
  const isRinging = callState === 'ringing';

  // Get the first call in the queue (active incoming call)
  const incomingCallData = incomingCallQueue[0];

  // Play notification sound when incoming call appears
  useEffect(() => {
    const shouldPlay = isRinging && incomingCallData;

    if (shouldPlay && audioRef.current) {
      audioRef.current.currentTime = 0;
      void audioRef.current.play().catch(() => {
        // Silently handle audio play failures
      });
    } else if (!shouldPlay && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, [isRinging, incomingCallData]);

  const handleAcceptCall = useCallback(
    (callIdToAccept?: string): void => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }

      // Close the native notification if in Electron
      if (
        window.electronAPI &&
        callIdToAccept &&
        typeof window.electronAPI.closeCallNotification === 'function'
      ) {
        window.electronAPI.closeCallNotification(callIdToAccept);
      }

      if (isInActiveCall) {
        // Send SWITCH_CALL event to disconnect current call and join new one
        callActor.send({ type: 'SWITCH_CALL', zero });
      } else {
        // Normal accept flow
        callActor.send({ type: 'ACCEPT', zero });
      }
    },
    [isInActiveCall, zero],
  );

  const handleRejectCall = useCallback(
    (callIdToReject?: string): void => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }

      // Close the native notification if in Electron
      if (
        window.electronAPI &&
        callIdToReject &&
        typeof window.electronAPI.closeCallNotification === 'function'
      ) {
        window.electronAPI.closeCallNotification(callIdToReject);
      }

      // Call Zero mutator directly to update database
      const callId = callIdToReject ?? incomingCallData?.callId;
      if (zero && callId) {
        void zero.mutate(mutators.calls.reject({ callId, timestamp: Date.now() }));
      }

      // Update UI state
      callActor.send({ type: 'REJECT' });
    },
    [zero, incomingCallData?.callId],
  );

  // Show native Electron notification when app is in background
  useEffect(() => {
    if (
      !window.electronAPI ||
      !isRinging ||
      !incomingCallData ||
      typeof window.electronAPI.showCallNotification !== 'function'
    ) {
      return;
    }

    window.electronAPI.showCallNotification({
      callId: incomingCallData.callId,
      callerName: incomingCallData.caller.name,
      callerEmail: incomingCallData.caller.email,
      callType: incomingCallData.callType as 'AUDIO' | 'VIDEO',
      ...(incomingCallData.caller.picture && { callerPicture: incomingCallData.caller.picture }),
    });

    return (): void => {
      if (window.electronAPI && typeof window.electronAPI.closeCallNotification === 'function') {
        window.electronAPI.closeCallNotification(incomingCallData.callId);
      }
    };
  }, [isRinging, incomingCallData]);

  // Handle Electron notification action callbacks (accept/reject from notification)
  useEffect(() => {
    if (
      !window.electronAPI ||
      typeof window.electronAPI.onCallAction !== 'function' ||
      typeof window.electronAPI.onCallNotificationClicked !== 'function'
    ) {
      return;
    }

    const cleanupCallAction = window.electronAPI.onCallAction(
      (data: { callId: string; action: 'accept' | 'reject' }) => {
        // Find the call in the queue
        const callInQueue = incomingCallQueue.find(call => call.callId === data.callId);
        if (!callInQueue) return;

        if (data.action === 'accept') {
          handleAcceptCall(data.callId);
        } else if (data.action === 'reject') {
          handleRejectCall(data.callId);
        }
      },
    );

    // Register for notification clicks - window focusing is handled by Electron main process
    const cleanupNotificationClicked = window.electronAPI.onCallNotificationClicked(() => {});

    return (): void => {
      cleanupCallAction();
      cleanupNotificationClicked();
    };
  }, [incomingCallQueue, handleAcceptCall, handleRejectCall]);

  // Show incoming call modal when in ringing state
  if (isRinging && incomingCallData) {
    return (
      <CallNotificationUI
        notification={incomingCallData}
        onAccept={() => handleAcceptCall(incomingCallData.callId)}
        onReject={() => handleRejectCall(incomingCallData.callId)}
        isInActiveCall={isInActiveCall}
      />
    );
  }

  return null;
}

interface CallNotificationUIProps {
  notification: {
    callId: string;
    caller: {
      id: string;
      name: string;
      email: string;
      picture?: string;
    };
    callType: CallType;
  };
  queuedCallsCount?: number; // Number of calls in queue
  isInActiveCall?: boolean; // Whether user is currently in an active call
  onAccept: () => void;
  onReject: () => void;
}

function CallNotificationUI({
  notification,
  queuedCallsCount = 0,
  isInActiveCall = false,
  onAccept,
  onReject,
}: CallNotificationUIProps): React.ReactElement {
  const { caller, callType } = notification;

  return (
    <Modal
      isOpen={true}
      onClose={onReject}
      title={`Incoming ${callType === CallType.VIDEO ? 'Video' : 'Audio'} Call`}
    >
      <div className='p-6 text-center space-y-6'>
        {isInActiveCall && (
          <div className='bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 px-3 py-2 rounded-md text-sm font-medium'>
            ⚠️ This will end your current call
          </div>
        )}

        {queuedCallsCount > 0 && (
          <div className='bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 px-3 py-2 rounded-md text-sm'>
            {queuedCallsCount === 1
              ? 'You have another incoming call'
              : `You have ${queuedCallsCount} incoming calls waiting`}
          </div>
        )}

        {/* Caller Avatar */}
        <div className='flex justify-center'>
          <div className='[&_*]:!rounded-full'>
            <Avatar
              src={caller.picture || ''}
              alt={caller.name}
              shape={AvatarShape.ROUNDED}
              size={AvatarSize.LG}
              fallback={caller.name
                .split(' ')
                .map(n => n[0])
                .join('')
                .toUpperCase()
                .slice(0, 2)}
            />
          </div>
        </div>

        {/* Call Info */}
        <div className='space-y-2'>
          <p className='text-lg font-medium text-gray-700 dark:text-gray-300'>{caller.name}</p>
          <p className='text-sm text-gray-500 dark:text-gray-400'>{caller.email}</p>
        </div>

        {/* Call Type Icon */}
        <div className='flex justify-center'>
          {callType === CallType.VIDEO ? (
            <Video className='h-8 w-8 text-blue-500 animate-pulse' />
          ) : (
            <Phone className='h-8 w-8 text-green-500 animate-pulse' />
          )}
        </div>

        {/* Action Buttons */}
        <div className='flex gap-4 justify-center'>
          <Button
            onClick={onReject}
            buttonType={ButtonType.DANGER}
            size={ButtonSize.LARGE}
            subType={ButtonSubType.ICON_ONLY}
            leadingIcon={<PhoneOff className='h-6 w-6' />}
          />

          <Button
            onClick={onAccept}
            buttonType={ButtonType.SUCCESS}
            size={ButtonSize.LARGE}
            text={isInActiveCall ? 'Switch Call' : ''}
            subType={isInActiveCall ? ButtonSubType.DEFAULT : ButtonSubType.ICON_ONLY}
            leadingIcon={<Phone className='h-6 w-6' />}
          />
        </div>
      </div>
    </Modal>
  );
}
