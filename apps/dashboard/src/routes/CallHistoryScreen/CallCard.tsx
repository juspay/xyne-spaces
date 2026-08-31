import { CallStatus, ChannelScopeType, InvitationResponse } from '@xyne/shared';
import {
  ArrowUpRight,
  Repeat,
  Download,
  Hash,
  MessageSquare,
  MoveDownLeft,
  MoveUpRight,
  ScrollText,
  MoreVertical,
} from 'lucide-react';
import HuddleIcon from '../../components/icons/HuddleIcon';
import Avatar from '../../components/ui/Avatar/Avatar';
import { AvatarStackItem } from '../../components/ui/Avatar/AvatarGroup';
import Button from '../../components/ui/Button';
import { formatRelativeTimestamp } from '../../utils/dateUtils';
import {
  Call,
  getParticipantDisplayData,
  getCallParticipantCount,
  getCallStatus,
  getOtherParticipants,
  getPreviewParticipantUsers,
  getStatusText,
  hasAnyoneJoined,
  hasPreviewParticipantJoined,
  canJoinCall,
} from './callHistoryItem.utils';
import { cn } from '../../utils/classNames';
import { ReactElement } from 'react';
import { useUsers } from '../../hooks/useUsers';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { useAllChannels, useAllVisibleChannels } from '../../hooks/useChannels';
import { usePlatform } from '../../hooks/usePlatform';
import Tooltip from '../../components/ui/Tooltip/Tooltip';
import { useSelector } from '@xstate/react';
import { roomActor } from '../../machines/roomMachine';

interface CallHistoryItemProps {
  call: Call;
  currentUserId: string | undefined;
  isLastItem?: boolean;
  onCallClick: () => void;
  onParticipantsClick: () => void;
  handleGotoTranscript?: (() => void) | undefined;
  handleDownloadTranscript?: (() => void) | undefined;
  onViewExternalChat?: (() => void) | undefined;
  isRecentCall?: boolean;
  onDetailClick?: (() => void) | undefined;
}

const MAX_AVATARS_TO_SHOW = 3;

export const CallCard = ({
  call,
  currentUserId,
  onCallClick,
  onParticipantsClick,
  handleGotoTranscript,
  handleDownloadTranscript,
  onViewExternalChat,
  isRecentCall = false,
  onDetailClick,
}: CallHistoryItemProps) => {
  const allChannels = useAllChannels();
  const visibleChannels = useAllVisibleChannels();
  const { isMobile } = usePlatform();
  const channel = allChannels.find(c => c.id === call.channelId);
  const isChannelCall = channel?.scopeType === ChannelScopeType.DEFAULT;

  // Basic call info
  const isOutgoingCall = call.createdByUserId === currentUserId;
  const currentUserParticipant = call.participants?.find(p => p.userId === currentUserId);
  const isUserInvited = !!currentUserParticipant;

  const hasCurrentUserJoined = currentUserParticipant?.response === InvitationResponse.ACCEPTED;
  const userJoinedandLeft = currentUserParticipant?.response === InvitationResponse.LEFT;

  const otherParticipants = getOtherParticipants(call.participants, currentUserId);
  const participantCount = getCallParticipantCount(call);
  const otherParticipantCount = Math.max(
    participantCount - (currentUserParticipant ? 1 : 0),
    otherParticipants.length,
  );
  const allUsersData = useUsers();

  const participantUsers = getPreviewParticipantUsers(
    call.participantPreviewUserIds,
    allUsersData,
    currentUserId,
  );
  const fallbackParticipantData = getParticipantDisplayData(
    call.participants,
    allUsersData,
    currentUserId,
  );
  const userIds =
    participantUsers.length > 0 ? participantUsers.map(u => u.id) : fallbackParticipantData.userIds;
  const participantDisplayNames =
    participantUsers.length > 0
      ? participantUsers.map(user => user.name || user.email || 'Unknown')
      : fallbackParticipantData.displayNames;

  const isCallJoinable = canJoinCall(call);
  const isActiveState = call.status === CallStatus.ACTIVE;

  const currentCallId = useSelector(roomActor, state => state.context.externalId);
  const isUserInThisDevice = currentCallId === call.externalId;

  const isUserChannelMember = visibleChannels.some(c => c.id === call.channelId);
  const hasTranscript = Boolean(call.transcript);
  const gotoMessageTooltip = !isUserChannelMember
    ? 'You are not a member of this channel'
    : !handleGotoTranscript
      ? 'No conversation exists for this call'
      : 'Go to Call message';

  // Determine call status
  const anyoneJoined =
    hasPreviewParticipantJoined(call.participantPreviewUserIds, currentUserId) ||
    hasAnyoneJoined(otherParticipants);
  const callStatus = getCallStatus(
    call,
    isOutgoingCall,
    hasCurrentUserJoined,
    userJoinedandLeft,
    anyoneJoined,
  );
  const isMissedCall = isUserInvited ? callStatus.isMissedCall : false;
  const didNotAnswer = callStatus.didNotAnswer;

  const getCallIcon = (): ReactElement => {
    if (isMissedCall) {
      return <MoveDownLeft className='size-2.5 text-status-failure' strokeWidth={2.3} />;
    }
    if (isOutgoingCall) {
      return <MoveUpRight className='size-2.5 text-status-success' strokeWidth={2.3} />;
    }
    return <MoveDownLeft className='size-2.5 text-status-success' strokeWidth={2.3} />;
  };

  // Get icon color
  const iconColorClass = isActiveState
    ? 'text-status-success'
    : isMissedCall
      ? 'text-status-failure'
      : 'text-muted-foreground';

  // Get status text and color
  const statusText = getStatusText(
    isMissedCall,
    didNotAnswer,
    call.endedAt === null,
    call.endedAt ? call.endedAt - call.startedAt : 0,
  );

  const getCallTitle = () => {
    if (call.title) {
      return call.title;
    }

    if (call.title === null && isChannelCall) {
      return (
        <span className='flex items-center gap-1'>
          <Hash size={14} className='flex-shrink-0' />
          {channel.name}
        </span>
      );
    }

    const primaryUserDisplay = participantDisplayNames[0] || 'Unknown';

    return (
      <>
        {primaryUserDisplay}
        {otherParticipantCount > 1 && (
          <span>
            {', '}
            {participantDisplayNames.slice(1, 2).join(', ')}
            {otherParticipantCount > 2 && (
              <span className='ml-1 whitespace-nowrap'>
                + {otherParticipantCount - 2} other{otherParticipantCount - 2 > 1 ? 's' : ''}
              </span>
            )}
          </span>
        )}
      </>
    );
  };

  const isHighlighted = isRecentCall && isActiveState;
  const isRecurring = Boolean(call.recurringSeriesId);
  const CallIcon = isRecurring ? Repeat : HuddleIcon;

  return (
    <div
      onClick={isRecentCall && onDetailClick ? onDetailClick : undefined}
      role={isRecentCall && onDetailClick ? 'button' : undefined}
      tabIndex={isRecentCall && onDetailClick ? 0 : -1}
      onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
        if (isRecentCall && onDetailClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onDetailClick();
        }
      }}
      data-track-category='CALLS'
      data-track-name='view-call-detail'
      className={cn(
        'relative flex items-center justify-between p-1.5',
        isRecentCall && onDetailClick && 'cursor-pointer',
        'rounded-xl border border-transparent hover:bg-accent',
        hasCurrentUserJoined && !isRecentCall && 'bg-muted',
      )}
    >
      {/* Huddle Icon with Indication */}
      <div className='flex items-start justify-start gap-3 w-full'>
        {/* Left icon */}
        {isRecentCall ? (
          <div
            className={cn(
              'size-9 flex items-center justify-center rounded-lg shrink-0 border',
              isHighlighted ? 'bg-background border-border' : 'bg-muted border-transparent',
            )}
          >
            <CallIcon
              className={cn(
                isHighlighted
                  ? 'text-status-success'
                  : isMissedCall
                    ? 'text-status-failure'
                    : 'text-muted-foreground',
              )}
              size={16}
            />
          </div>
        ) : (
          <div className='w-10 h-10 flex items-center justify-center rounded-[10px] border border-border relative bg-background'>
            <CallIcon
              className={cn(
                isActiveState
                  ? 'text-status-success'
                  : isMissedCall
                    ? 'text-status-failure'
                    : 'text-muted-foreground',
              )}
              size={20}
            />
            <span className='bg-card rounded-full w-[18px] h-[18px] flex items-center justify-center absolute bottom-0 right-0 translate-x-1/4 translate-y-1/4 border border-border'>
              {getCallIcon()}
            </span>
          </div>
        )}
        <div className='flex flex-1 min-w-0 items-start justify-between gap-3'>
          <div className='flex flex-col min-w-0 flex-1 overflow-hidden gap-0.5'>
            {call.title ? (
              <p
                className={cn(
                  'text-foreground font-medium text-sm truncate',
                  isActiveState
                    ? 'text-status-success'
                    : isMissedCall
                      ? 'text-status-failure'
                      : 'text-foreground',
                )}
              >
                <Tooltip content={call.title} delayDuration={500}>
                  <span>{getCallTitle()}</span>
                </Tooltip>
              </p>
            ) : (
              <p
                className={cn(
                  'text-foreground font-medium text-sm truncate w-full',
                  isActiveState
                    ? 'text-status-success'
                    : isMissedCall
                      ? 'text-status-failure'
                      : 'text-foreground',
                )}
              >
                {getCallTitle()}
              </p>
            )}
            {call.status === CallStatus.ACTIVE ? (
              <p className={cn('text-xs', iconColorClass)}>Ongoing</p>
            ) : (
              <div
                className={cn(
                  'flex md:flex-row items-start md:items-center gap-0.5 md:gap-1',
                  isMobile ? ' gap-1.5  flex-row' : 'gap-0.5 ',
                )}
              >
                {(call.startsAt || call.startedAt) && (
                  <p className={cn('text-xs', iconColorClass)}>
                    {formatRelativeTimestamp(call.startsAt || call.startedAt)}
                  </p>
                )}
                <span className={cn('text-xs', iconColorClass)}>•</span>
                <span className={cn('text-xs', iconColorClass)}>{statusText}</span>
              </div>
            )}
          </div>
          <div className={cn('flex items-center shrink-0', isMobile ? 'gap-1.5' : 'gap-2.5')}>
            <div
              role='button'
              tabIndex={0}
              onClick={e => {
                e.stopPropagation();
                onParticipantsClick();
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onParticipantsClick();
                }
              }}
              className='flex items-center gap-1'
              data-track-category='CALLS'
              data-track-name='view-past-participants'
            >
              <div className='flex items-center -space-x-1.5'>
                {userIds.length > 0 &&
                  userIds.slice(0, MAX_AVATARS_TO_SHOW).map((userId, index) => (
                    <AvatarStackItem
                      key={`${userId}-${index}`}
                      size={24}
                      className='rounded-md flex items-center justify-center ring-[1px] ring-background z-10'
                      data-slot='avatar-stack-item'
                      data-index={index}
                    >
                      <Avatar userId={userId} size='rg' showActiveStatus={false} />
                    </AvatarStackItem>
                  ))}
              </div>
              {otherParticipantCount > MAX_AVATARS_TO_SHOW && (
                <span className='text-xs text-muted-foreground tabular-nums'>
                  +{otherParticipantCount - MAX_AVATARS_TO_SHOW}
                </span>
              )}
            </div>
            {!isActiveState &&
              !isCallJoinable &&
              (isRecentCall ? (
                isMobile ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className='size-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent'
                        onClick={e => e.stopPropagation()}
                        data-track-category='CALLS'
                        data-track-name='call-more-options'
                      >
                        <MoreVertical className='size-4' />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end' className='rounded-xl p-1.5 w-48 shadow-sm'>
                      <DropdownMenuItem
                        onClick={e => {
                          e.stopPropagation();
                          handleGotoTranscript?.();
                        }}
                        data-track-category='CALLS'
                        data-track-name='GOTO_TRANSCRIPT'
                        disabled={!isUserChannelMember || !handleGotoTranscript}
                        className='text-sm font-medium rounded-lg'
                      >
                        Go to Message
                      </DropdownMenuItem>
                      {onViewExternalChat && (
                        <DropdownMenuItem
                          onClick={e => {
                            e.stopPropagation();
                            onViewExternalChat();
                          }}
                          data-track-category='CALLS'
                          data-track-name='VIEW_EXTERNAL_CHAT'
                          className='text-sm font-medium rounded-lg'
                        >
                          View External Chat
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onClick={e => {
                          e.stopPropagation();
                          handleDownloadTranscript?.();
                        }}
                        data-track-category='CALLS'
                        data-track-name='DOWNLOAD_TRANSCRIPT'
                        disabled={!hasTranscript}
                        className='text-sm font-medium rounded-lg'
                      >
                        Download Transcript
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={e => {
                          e.stopPropagation();
                          onCallClick();
                        }}
                        data-track-category='CALLS'
                        data-track-name='OPEN_CALL'
                        className='text-sm font-medium rounded-lg'
                      >
                        Start Call
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <div className='flex items-center gap-1.5'>
                    <Tooltip content={gotoMessageTooltip} delayDuration={300}>
                      <span
                        className={
                          !isUserChannelMember || !handleGotoTranscript ? 'cursor-not-allowed' : ''
                        }
                      >
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            handleGotoTranscript?.();
                          }}
                          disabled={!isUserChannelMember || !handleGotoTranscript}
                          data-track-category='CALLS'
                          data-track-name='goto-call-message'
                          className='size-7 flex items-center justify-center border border-border rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 disabled:pointer-events-none'
                        >
                          <MessageSquare className='size-4' />
                        </button>
                      </span>
                    </Tooltip>
                    <Tooltip
                      content={!hasTranscript ? 'Transcript not available' : 'Download Transcript'}
                      delayDuration={300}
                    >
                      <span className={!hasTranscript ? 'cursor-not-allowed' : ''}>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            handleDownloadTranscript?.();
                          }}
                          disabled={!hasTranscript}
                          data-track-category='CALLS'
                          data-track-name='download-transcript'
                          className='size-7 flex items-center justify-center border border-border rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 disabled:pointer-events-none'
                        >
                          <Download className='size-4' />
                        </button>
                      </span>
                    </Tooltip>
                    {onViewExternalChat && (
                      <Tooltip content='View External Chat' delayDuration={300}>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            onViewExternalChat();
                          }}
                          data-track-category='CALLS'
                          data-track-name='view-external-chat'
                          className='size-7 flex items-center justify-center border border-border rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent'
                        >
                          <ArrowUpRight className='size-4' />
                        </button>
                      </Tooltip>
                    )}
                    <Tooltip content='Start Call' delayDuration={300}>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          onCallClick();
                        }}
                        data-track-category='CALLS'
                        data-track-name='join-call'
                        className='size-7 flex items-center justify-center border border-border rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent'
                      >
                        <HuddleIcon size={16} />
                      </button>
                    </Tooltip>
                  </div>
                )
              ) : isMobile ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant='ghost'
                      size='icon'
                      className='size-7 text-muted-foreground hover:text-foreground'
                      onClick={e => e.stopPropagation()}
                      data-track-category='CALLS'
                      data-track-name='call-more-options'
                    >
                      <MoreVertical className='size-4' />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end' className='rounded-xl p-1.5 w-48 shadow-sm'>
                    <DropdownMenuItem
                      onClick={e => {
                        e.stopPropagation();
                        handleGotoTranscript?.();
                      }}
                      data-track-category='CALLS'
                      data-track-name='GOTO_TRANSCRIPT'
                      disabled={!isUserChannelMember || !handleGotoTranscript}
                      className='text-sm font-medium rounded-lg'
                    >
                      Go to Message
                    </DropdownMenuItem>
                    {onViewExternalChat && (
                      <DropdownMenuItem
                        onClick={e => {
                          e.stopPropagation();
                          onViewExternalChat();
                        }}
                        data-track-category='CALLS'
                        data-track-name='VIEW_EXTERNAL_CHAT'
                        className='text-sm font-medium rounded-lg'
                      >
                        External Huddle
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onClick={e => {
                        e.stopPropagation();
                        handleDownloadTranscript?.();
                      }}
                      data-track-category='CALLS'
                      data-track-name='DOWNLOAD_TRANSCRIPT'
                      disabled={!hasTranscript}
                      className='text-sm font-medium rounded-lg'
                    >
                      Transcript
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <>
                  <Tooltip content={gotoMessageTooltip} delayDuration={300}>
                    <span
                      className={
                        !isUserChannelMember || !handleGotoTranscript ? 'cursor-not-allowed' : ''
                      }
                    >
                      <Button
                        onClick={handleGotoTranscript}
                        data-track-category='CALLS'
                        data-track-name='GOTO_TRANSCRIPT'
                        variant='outline'
                        size='icon'
                        disabled={!isUserChannelMember || !handleGotoTranscript}
                        className='size-7'
                      >
                        <MessageSquare className='size-3.5 text-muted-foreground' />
                      </Button>
                    </span>
                  </Tooltip>
                  <Tooltip
                    content={!hasTranscript ? 'Transcript not available' : 'Download Transcript'}
                    delayDuration={300}
                  >
                    <span className={!hasTranscript ? 'cursor-not-allowed' : ''}>
                      <Button
                        onClick={handleDownloadTranscript}
                        data-track-category='CALLS'
                        data-track-name='DOWNLOAD_TRANSCRIPT'
                        variant='outline'
                        size='icon'
                        disabled={!hasTranscript}
                        className='size-7'
                      >
                        <Download className='size-3.5 text-muted-foreground' />
                      </Button>
                    </span>
                  </Tooltip>
                  {onViewExternalChat && (
                    <Tooltip content='View External Chat' delayDuration={300}>
                      <Button
                        onClick={onViewExternalChat}
                        variant='outline'
                        size='icon'
                        className='size-7'
                        data-track-category='CALLS'
                        data-track-name='view-external-chat'
                      >
                        <ScrollText className='size-3.5 text-muted-foreground' />
                      </Button>
                    </Tooltip>
                  )}
                </>
              ))}
            {isUserInvited &&
              !isUserInThisDevice &&
              (!isRecentCall || isActiveState || isCallJoinable) && (
                <Button
                  onClick={e => {
                    e.stopPropagation();
                    onCallClick();
                  }}
                  data-track-category='CALLS'
                  data-track-name='OPEN_CALL'
                  variant='outline'
                  data-testid='call-join-button'
                  className={cn(
                    isActiveState
                      ? 'bg-background ring-1 ring-border border-status-success hover:bg-card rounded-lg h-8'
                      : isCallJoinable
                        ? 'bg-background border-border hover:bg-card rounded-lg h-8'
                        : 'size-7',
                    'gap-1.5 items-center',
                  )}
                >
                  {(isActiveState || isCallJoinable) && (
                    <span
                      className={cn(
                        'font-medium text-sm',
                        isActiveState
                          ? 'text-status-success hover:text-status-success'
                          : 'text-foreground',
                      )}
                    >
                      {hasCurrentUserJoined ? 'Switch' : 'Join Now'}
                    </span>
                  )}
                </Button>
              )}
          </div>
        </div>
      </div>
    </div>
  );
};
