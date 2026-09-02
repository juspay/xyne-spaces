import React, { useMemo, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import { Button } from '../../ui/Button/Button';
import AvatarGroup from '../../ui/Avatar/AvatarGroup';
import { useUsers } from '../../../hooks/useUsers';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { useChannel } from '../../../hooks/useChannels';
import { useAuth } from '../../../hooks/useAuth';
import { useRouteContext } from '../../../hooks/useRouteContext';
import { standaloneNavigate } from '../../../utils/electronApp';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { roomActor } from '../../../machines/roomMachine';
import { CallConfirmationModal } from '../CallConfirmationModal';
import { useCallConfirmation } from '../../../hooks/useCallConfirmation';
import { useCallDuration, useFetchCallTitle, isUserActiveInCall } from '../../../hooks/useCalls';
import { useAutoJoinOnAccept, useCallJoinState } from '../../../hooks/useCallJoinState';
import { CallJoinButton } from '../CallJoinButton/CallJoinButton';
import type { CallData } from './CallTriggerModal';
import {
  getCallParticipantCount,
  getPreviewParticipantUserIds,
} from '../../../routes/CallHistoryScreen/callHistoryItem.utils';

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
  const navigate = useNavigate();
  const { baseRoute } = useRouteContext();

  const isCurrentCall = currentCallId === call.externalId;
  const channel = useChannel(call.channelId || '');
  const participantCount = getCallParticipantCount(call);
  const conversationId = call.metadata?.conversationId;

  // Same ticketId lookup and route shape as ChatListV2/V3/V4's handleOpenThread
  // (.../{conversationId}/{ticketId}?selectedTab=thread for ticket-linked threads,
  // plain .../{conversationId} otherwise), so this title lands on the same route.
  const [conversationDetails] = useCachedQuery(
    queries.getConversationById({ conversationId: conversationId || '' }),
    { enabled: !!conversationId },
  );
  const conversationMetadata = conversationDetails?.metadata as { ticketId?: string } | null;
  const messageMetadata = conversationDetails?.initialMessage?.metadata as {
    ticketId?: string;
  } | null;
  const ticketId = conversationMetadata?.ticketId || messageMetadata?.ticketId;

  const handleOpenThread = (e?: React.MouseEvent): void => {
    if (!conversationId || !call.channelId) return;
    onActionClick?.();
    if (ticketId) {
      standaloneNavigate(
        navigate,
        `${baseRoute}/${call.channelId}/${conversationId}/${ticketId}?selectedTab=thread`,
        { event: e },
      );
    } else {
      standaloneNavigate(navigate, `${baseRoute}/${call.channelId}/${conversationId}`, {
        event: e,
      });
    }
  };

  // ── Confirmation modal for switching calls ──
  const { showConfirmModal, modalContent, handleCallAction, handleConfirmCall, closeModal } =
    useCallConfirmation({
      scopeType: channel?.scopeType,
      channelName: channel?.name,
      participantCount,
      hasActiveCallInChannel: false,
      isUserInCurrentChannelCall: false,
      isInCall,
      onlyShowSwitchModal: true,
    });

  const handleLeaveCall = (): void => {
    roomActor.send({ type: 'DISCONNECT' });
    onActionClick?.();
  };

  const handleJoinCallDirect = (): void => {
    if (!call.externalId) return;
    joinCall({
      callId: call.externalId,
      ...(onActionClick ? { onComplete: onActionClick } : {}),
    });
  };

  const handleJoinCall = (): void => {
    handleCallAction(handleJoinCallDirect);
  };

  // ── Participants ──
  const participantUserIds = useMemo(
    () => getPreviewParticipantUserIds(call.participantPreviewUserIds, user?.id).slice(0, 3),
    [call.participantPreviewUserIds, user?.id],
  );

  const initiatorName = useMemo(() => {
    const initiator = allUsers.find(u => u.id === call.createdByUserId);
    return getUserDisplayName(initiator);
  }, [call.createdByUserId, allUsers]);

  const callTitle = useFetchCallTitle(call.externalId);
  const callDuration = useCallDuration(
    call.startedAt,
    !!call.startedAt,
    isCurrentCall ? 'detailed' : 'simple',
  );

  // ── Request-to-join + auto-join ──
  useAutoJoinOnAccept({
    callId: call.externalId || '',
    userId: user?.id,
    isUserInCall: isCurrentCall,
  });

  const { action, requestToJoin, cancelJoinRequest, isRequesting, isCancellingRequest } =
    useCallJoinState(call.externalId || '', user?.id);

  // Check if user is active in this call on another device/tab (for "Switch" label)
  const userIsActiveInCall = isUserActiveInCall(call.participants || [], user?.id ?? '');

  return (
    <Fragment>
      <div
        className={cn(
          'flex items-center gap-3 px-6 py-4',
          isCurrentCall ? 'rounded-tl-lg rounded-tr-lg border-b border-border' : '!bg-background',
          isMobileLiveCall ? 'flex-col !pb-8 !pt-6 !border-none' : 'bg-[#F3FEF1]',
        )}
      >
        {/* Avatars */}
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
            {conversationId ? (
              <button
                type='button'
                onClick={e => {
                  e.stopPropagation();
                  handleOpenThread(e);
                }}
                title='Open conversation'
                data-track-category='CALLS'
                data-track-name='OpenThreadFromCallCard'
                className={cn(
                  'text-sm font-semibold text-foreground text-left bg-transparent border-0 p-0 cursor-pointer hover:underline focus-visible:underline focus:outline-none',
                  isMobileLiveCall ? 'text-md mb-1' : '',
                )}
              >
                {callTitle}
              </button>
            ) : (
              <div
                className={cn(
                  'text-sm font-semibold text-foreground',
                  isMobileLiveCall ? 'text-md mb-1' : '',
                )}
              >
                {callTitle}
              </div>
            )}
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
              {participantCount}
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

        {/* Action button */}
        <div className='flex-shrink-0 flex items-center gap-4'>
          {isCurrentCall ? (
            <>
              {!isMobileLiveCall && callDuration && (
                <div className='text-xs text-muted-foreground'>{callDuration}</div>
              )}
              <Button
                variant='ghost'
                className='p-0 h-auto hover:bg-transparent'
                onClick={handleLeaveCall}
                data-track-category='CALLS'
                trackId='leave_call'
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
              </Button>
            </>
          ) : (
            <CallJoinButton
              action={action}
              onJoin={handleJoinCall}
              onRequest={requestToJoin}
              onCancelRequest={cancelJoinRequest}
              isRequesting={isRequesting}
              isCancellingRequest={isCancellingRequest}
              variant='text'
              joinLabel={userIsActiveInCall ? 'Switch' : 'Join'}
              testId={
                action === 'canJoin'
                  ? userIsActiveInCall
                    ? 'switch-call-button'
                    : 'join-button'
                  : action === 'requested'
                    ? 'waiting-to-join-button'
                    : 'request-to-join-button'
              }
              trackCategory='CALLS'
              trackJoinName={userIsActiveInCall ? 'SwitchCall' : 'JoinCall'}
              trackRequestName='RequestToJoinCall'
              trackMetadata={{ callId: call.externalId, channelId: call.channelId }}
            />
          )}
        </div>
      </div>

      <CallConfirmationModal
        isOpen={showConfirmModal}
        onClose={closeModal}
        onConfirm={() => handleConfirmCall(handleJoinCallDirect)}
        title={modalContent.title}
        subtitle={modalContent.subtitle}
        description={modalContent.description}
      />
    </Fragment>
  );
};
