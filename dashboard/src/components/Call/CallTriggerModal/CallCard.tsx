import React, { useMemo, Fragment } from 'react';
import { Users } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import AvatarGroup from '../../ui/Avatar/AvatarGroup';
import { useUsers } from '../../../hooks/useUsers';
import { useChannel } from '../../../hooks/useChannels';
import { useAuth } from '../../../hooks/useAuth';
import { roomActor } from '../../../machines/roomMachine';
import { CallConfirmationModal } from '../CallConfirmationModal';
import { useCallConfirmation } from '../../../hooks/useCallConfirmation';
import { useCallDuration, useFetchCallTitle, getActiveParticipants } from '../../../hooks/useCalls';
import type { CallData } from './CallTriggerModal';

export interface CallCardProps {
  call: CallData;
  currentCallId: string | null;
  isMobileLiveCall?: boolean;
  onActionClick?: () => void;
  joinCall: (params: { callId: string; onComplete?: () => void }) => void;
  isInCall: boolean;
}

export const CallCard: React.FC<CallCardProps> = ({
  call,
  currentCallId,
  isMobileLiveCall = false,
  onActionClick,
  joinCall,
  isInCall,
}) => {
  const allUsers = useUsers();
  const { user } = useAuth();

  const isCurrentCall = currentCallId === call.externalId;

  // Get channel info for confirmation modal
  const channel = useChannel(call.channelId || '');

  // Use call confirmation hook for join action
  const { showConfirmModal, modalContent, handleCallAction, handleConfirmCall, closeModal } =
    useCallConfirmation({
      scopeType: channel?.scopeType,
      channelName: channel?.name,
      participantCount: call.participants?.length || 0,
      hasActiveCallInChannel: false, // Not relevant for joining existing call
      isUserInCurrentChannelCall: false, // Not relevant for joining existing call
      isInCall,
      onlyShowSwitchModal: true,
    });

  // Handle leaving the current call
  const handleLeaveCall = (): void => {
    roomActor.send({ type: 'DISCONNECT' });
    onActionClick?.();
  };

  // Handle joining a call (with confirmation modal if switching)
  const handleJoinCallDirect = (): void => {
    if (!call.externalId) return;
    joinCall({
      callId: call.externalId,
      ...(onActionClick ? { onComplete: onActionClick } : {}),
    });
  };

  // Use handleCallAction to show confirmation modal when switching calls
  const handleJoinCall = (): void => {
    handleCallAction(handleJoinCallDirect);
  };

  // Get active participants (accepted and not left)
  const activeParticipants = useMemo(
    () => getActiveParticipants(call.participants || []),
    [call.participants],
  );

  // Check if user is a participant in this call
  const isUserCallParticipant = useMemo(() => {
    if (!user || !call.participants) return false;
    return call.participants.some(p => p.userId === user.id);
  }, [user, call.participants]);

  // Get participant user IDs for avatars (limit to 3)
  const participantUserIds = useMemo(
    () => activeParticipants.map(p => p.userId).slice(0, 3),
    [activeParticipants],
  );

  // Get initiator name
  const initiatorName = useMemo(() => {
    const initiator = allUsers.find(u => u.id === call.createdByUserId);
    return initiator?.name || 'Someone';
  }, [call.createdByUserId, allUsers]);

  // Get message content and truncate to characters
  const callTitle = useFetchCallTitle(call.externalId);

  // For current call: use detailed duration (M:SS min format, updates every second)
  // For other calls: use simple duration (X min format, updates every minute)
  const callDuration = useCallDuration(
    call.startedAt,
    !!call.startedAt,
    isCurrentCall ? 'detailed' : 'simple',
  );

  return (
    <Fragment>
      <div
        className={cn(
          'flex items-center gap-3 px-6 py-4',
          isCurrentCall ? 'rounded-tl-lg rounded-tr-lg border-b border-border' : '!bg-background',
          isMobileLiveCall ? 'flex-col !pb-8 !pt-6 !border-none' : 'bg-[#F3FEF1]',
        )}
      >
        {/* Avatars on the left */}
        <div className='flex-shrink-0'>
          {participantUserIds.length > 0 ? (
            <AvatarGroup
              userIds={participantUserIds}
              size={isMobileLiveCall ? 'lg' : 'sm'}
              count={2}
            />
          ) : (
            <div className='w-10 h-10 rounded-md bg-border' />
          )}
        </div>

        {/* Call info */}
        <div className='flex-1 min-w-0'>
          <div className={cn('flex items-center gap-2', isMobileLiveCall ? 'justify-center' : '')}>
            <div
              className={cn(
                'text-sm font-semibold text-foreground',
                isMobileLiveCall ? 'text-md mb-1' : '',
              )}
            >
              {callTitle}
            </div>
            {!isCurrentCall && (
              <div className='text-xs text-muted-foreground mt-0.5'>
                {call.startedAt
                  ? new Date(call.startedAt).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                      hour12: true,
                    })
                  : ''}
              </div>
            )}
          </div>
          <div className='flex items-center gap-3'>
            <div className='text-xs text-muted-foreground'>{initiatorName}</div>
            <span className='w-1 h-1 bg-gray-600 rounded-full flex-shrink-0' />
            <div className='text-xs text-muted-foreground flex items-center gap-1'>
              <Users className='w-3 h-3' />
              {activeParticipants.length}
            </div>
            {!isCurrentCall && (
              <>
                <span className='w-1 h-1 bg-gray-600 rounded-full flex-shrink-0' />
                <div className='text-xs text-muted-foreground'>
                  {callDuration ? `Live ${callDuration}` : 'Just started'}
                </div>
              </>
            )}
          </div>
        </div>

        <div className='flex-shrink-0 flex items-center gap-4'>
          {isCurrentCall ? (
            <>
              {!isMobileLiveCall && callDuration && (
                <div className='text-xs text-muted-foreground'>{callDuration}</div>
              )}
              <button
                onClick={handleLeaveCall}
                data-track-category='CALL'
                data-track-name='LeaveCall'
                data-track-metadata={JSON.stringify({
                  callId: call.externalId,
                  channelId: call.channelId,
                })}
              >
                <span
                  className={cn(
                    'text-sm font-semibold text-white bg-red-500 rounded-full px-4 py-2',
                    isMobileLiveCall ? 'mt-6 !px-8' : '',
                  )}
                >
                  Leave
                </span>
              </button>
            </>
          ) : (
            isUserCallParticipant && (
              <button
                className='flex items-center gap-2'
                onClick={handleJoinCall}
                data-track-category='CALL'
                data-track-name='JoinCall'
                data-track-metadata={JSON.stringify({
                  callId: call.externalId,
                  channelId: call.channelId,
                })}
              >
                <span className='text-sm font-semibold text-foreground hover:text-green-600'>
                  Join
                </span>
              </button>
            )
          )}
        </div>
      </div>
      <CallConfirmationModal
        isOpen={showConfirmModal}
        onClose={closeModal}
        onConfirm={() => {
          handleConfirmCall(handleJoinCallDirect);
        }}
        title={modalContent.title}
        subtitle={modalContent.subtitle}
        description={modalContent.description}
      />
    </Fragment>
  );
};
