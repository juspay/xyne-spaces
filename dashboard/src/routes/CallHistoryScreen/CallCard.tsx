import { CallStatus, ChannelScopeType, InvitationResponse, User } from '@xyne/shared';
import {
  CalendarDays,
  Copy,
  Download,
  Hash,
  MessageSquare,
  MoveDownLeft,
  MoveUpRight,
  Pencil,
  ScrollText,
  MoreVertical,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import HuddleIcon from '../../components/icons/HuddleIcon';
import Avatar from '../../components/ui/Avatar/Avatar';
import { AvatarStackItem } from '../../components/ui/Avatar/AvatarGroup';
import Button from '../../components/ui/Button';
import { formatRelativeTimestamp } from '../../utils/dateUtils';
import {
  Call,
  getCallStatus,
  getOtherParticipants,
  getParticipantUsers,
  getStatusText,
  hasAnyoneJoined,
  isScheduledCallJoinable,
} from './callHistoryItem.utils';
import { cn } from '../../utils/classNames';
import { useAllChannels } from '../../hooks/useChannels';
import { ReactElement } from 'react';
import { useUsers } from '../../hooks/useUsers';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { usePlatform } from '../../hooks/usePlatform';
import Tooltip from '../../components/ui/Tooltip/Tooltip';
import { useSelector } from '@xstate/react';
import { roomActor } from '../../machines/roomMachine';

interface UpcomingCallCardProps {
  call: Call;
  channel?: { id: string; name: string };
  allUsers: User[];
  onCallClick: () => void;
  onParticipantsClick: () => void;
  isLastItem: boolean;
  currentUserId?: string;
  onCancelClick?: (e: React.MouseEvent) => void;
  onEditClick?: (e: React.MouseEvent) => void;
}

/**
 * Small "Repeat" badge for recurring upcoming calls.
 * Placed at the top-left corner of the call card.
 */
const RepeatBadge: React.FC = () => (
  <span
    className={cn(
      'absolute top-2.5 left-2.5 z-10 flex items-center gap-1 rounded-full px-2 py-0.5',
      'text-[10px] font-semibold uppercase tracking-wide',
      'bg-primary/10 text-primary',
    )}
  >
    Repeat
  </span>
);

interface CallHistoryItemProps {
  call: Call;
  currentUserId: string | undefined;
  isLastItem?: boolean;
  onCallClick: () => void;
  onParticipantsClick: () => void;
  handleGotoTranscript?: (() => void) | undefined;
  handleDownloadTranscript?: (() => void) | undefined;
  onViewExternalChat?: (() => void) | undefined;
}

const MAX_AVATARS_TO_SHOW = 3;

/** Checks if a call belongs to a recurring series. */
const isRecurringCall = (call: Call): boolean => Boolean(call.recurringSeriesId);

export const UpcomingCallCard = ({
  call,
  channel,
  onCallClick,
  onParticipantsClick,
  isLastItem,
  currentUserId,
  onCancelClick,
  onEditClick,
}: UpcomingCallCardProps) => {
  // Extract user IDs from call participants
  const { isMobile } = usePlatform();
  const userIds = call.participants?.map(p => p.userId) ?? [];
  const avatarsToShow = userIds.slice(0, MAX_AVATARS_TO_SHOW);

  const isCallJoinable = isScheduledCallJoinable(call);
  const isUserInvited = !!call.participants?.some(p => p.userId === currentUserId);

  const handleCopyLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!call.roomLink) {
      toast.error('Failed to copy link');
      return;
    }

    try {
      void navigator.clipboard.writeText(call.roomLink);
      toast.success('Link copied to clipboard');
    } catch {
      toast.error('Failed to copy link');
    }
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEditClick?.(e);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onCancelClick?.(e);
  };

  return (
    <div
      className={cn(
        'relative md:border border-border md:rounded-lg md:shadow-sm p-4 md:p-0',
        !isLastItem && 'border-b ',
      )}
    >
      {isRecurringCall(call) && <RepeatBadge />}
      <div className='relative md:py-8 flex md:flex-col gap-4 items-center justify-start md:justify-center md:bg-card rounded-lg '>
        <div className='hidden md:block absolute top-3 right-3'>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                className='h-6 w-6 p-0.5 text-muted-foreground hover:text-foreground focus:outline-none border border-transparent hover:border-border'
              >
                <MoreVertical className='size-4' strokeWidth={2.2} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start' className='rounded-xl p-1.5 w-44 shadow-sm'>
              <DropdownMenuItem
                onClick={handleCopyLink}
                className='flex items-center gap-2  text-sm leading-5 font-medium rounded-lg'
              >
                <Copy className='size-4' />
                Copy Link
              </DropdownMenuItem>
              {currentUserId === call.createdByUserId && (
                <DropdownMenuItem
                  onClick={handleEdit}
                  className='flex items-center gap-2 text-sm leading-5 font-medium rounded-lg'
                >
                  <Pencil className='size-4' strokeWidth={2.2} />
                  Edit Call
                </DropdownMenuItem>
              )}
              {currentUserId === call.createdByUserId && (
                <DropdownMenuItem
                  onClick={handleDelete}
                  className='flex items-start gap-2 text-destructive focus:text-destructive text-sm leading-5 font-medium rounded-lg'
                >
                  <Trash2 className='size-4' strokeWidth={2.2} />
                  Delete Call
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {/* Headphones Icon */}
        <div className='w-10 h-10 flex flex-shrink-0 items-center justify-center rounded-[10px] border border-border relative'>
          <HuddleIcon size={20} />
          <span className='bg-card rounded-full w-[18px] h-[18px] flex items-center justify-center absolute bottom-0 right-0 translate-x-1/4 translate-y-1/4 border border-border'>
            <CalendarDays className='size-2.5' />
          </span>
        </div>
        <div className='flex items-start justify-center w-full gap-2 overflow-hidden'>
          <div className='block md:hidden flex-1 min-w-0 overflow-hidden'>
            <p className='text-foreground font-medium text-sm truncate'>
              {call.title ?? channel?.name ?? 'Scheduled Call'}
            </p>
            {call.startsAt && (
              <p className={cn('text-muted-foreground truncate', isMobile ? 'text-xs' : 'text-sm')}>
                {formatRelativeTimestamp(call.startsAt)}
              </p>
            )}
          </div>

          <div className='flex items-center gap-1.5 flex-shrink-0'>
            <p className='text-muted-foreground text-sm font-medium leading-5 hidden md:block'>
              {userIds.length} Participants
            </p>
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
              className='flex items-center -space-x-1.5'
              data-track-category='calls'
              data-track-name='view-scheduled-participants'
            >
              {avatarsToShow.length > 0 &&
                avatarsToShow.map((userId, index) => (
                  <AvatarStackItem
                    key={`${userId}-${index}`}
                    size={isMobile ? 24 : 22}
                    className={cn(
                      'flex items-center justify-center ring-[2px] ring-background z-10',
                      isMobile ? 'rounded-md' : 'rounded-full',
                    )}
                    data-slot='avatar-stack-item'
                    data-index={index}
                  >
                    <Avatar size={'rg'} userId={userId} showActiveStatus={false} />
                  </AvatarStackItem>
                ))}
            </div>
            {isUserInvited && (
              <Button
                onClick={onCallClick}
                variant='outline'
                className={cn(
                  ' text-sm font-medium leading-5 rounded-lg h-8 w-20',
                  isCallJoinable
                    ? 'border-status-success text-status-success hover:bg-accent'
                    : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
                  'flex md:hidden',
                )}
              >
                Join Call
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon'
                  className='md:hidden h-5 w-5 p-0.5 text-muted-foreground hover:text-foreground'
                >
                  <MoreVertical className='size-3.5' />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                <DropdownMenuItem onClick={handleCopyLink} className='flex items-center gap-2'>
                  <Copy className='size-4' />
                  Copy Link
                </DropdownMenuItem>
                {currentUserId === call.createdByUserId && (
                  <DropdownMenuItem onClick={handleEdit} className='flex items-center gap-2'>
                    <Pencil className='size-4' />
                    Edit
                  </DropdownMenuItem>
                )}
                {currentUserId === call.createdByUserId && (
                  <DropdownMenuItem
                    onClick={handleDelete}
                    className='flex items-center gap-2 text-destructive focus:text-destructive'
                  >
                    <Trash2 className='size-4' />
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
      <div className='space-y-1 px-4 pt-4 pb-5 border-t border-border text-start hidden md:flex gap-2 items-center justify-between'>
        <div className='overflow-hidden'>
          <p className='text-foreground font-medium text-sm text-nowrap truncate'>
            {call.title ?? channel?.name ?? 'Scheduled Call'}
          </p>
          {call.startsAt && (
            <p className='text-muted-foreground text-sm'>
              {formatRelativeTimestamp(call.startsAt)}
            </p>
          )}
        </div>
        <div className='flex gap-2 items-center'>
          {isUserInvited && (
            <Button
              onClick={onCallClick}
              variant='outline'
              className={cn(
                ' text-sm font-medium leading-5 rounded-lg h-8 w-20',
                isCallJoinable
                  ? 'border-status-success text-status-success hover:bg-accent'
                  : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              Join Call
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export const CallCard = ({
  call,
  currentUserId,
  onCallClick,
  onParticipantsClick,
  handleGotoTranscript,
  handleDownloadTranscript,
  onViewExternalChat,
  isLastItem,
}: CallHistoryItemProps) => {
  // Get channel information
  const allChannels = useAllChannels();
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
  const allUsersData = useUsers();

  const participantUsers = getParticipantUsers(otherParticipants, allUsersData);
  const userIds = participantUsers.map(u => u.id);
  const primaryUser = participantUsers[0];

  const isCallJoinable = isScheduledCallJoinable(call);
  const isActiveState = call.status === CallStatus.ACTIVE;

  const currentCallId = useSelector(roomActor, state => state.context.externalId);
  const isUserInThisDevice = currentCallId === call.externalId;

  const isUserChannelMember = !!channel;
  const hasTranscript = Boolean(call.transcript);

  // Determine call status
  const anyoneJoined = hasAnyoneJoined(otherParticipants);
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

    const primaryUserDisplay = primaryUser?.name || primaryUser?.email || 'Unknown';

    return (
      <>
        {primaryUserDisplay}
        {participantUsers.length > 1 && (
          <span>
            {', '}
            {participantUsers
              .slice(1, 2)
              .map(u => u?.name || u?.email || 'Unknown')
              .join(', ')}
            {participantUsers.length > 2 && (
              <span className='ml-1 whitespace-nowrap'>
                + {participantUsers.length - 2} other{participantUsers.length - 2 > 1 ? 's' : ''}
              </span>
            )}
          </span>
        )}
      </>
    );
  };

  return (
    <div
      className={cn(
        'relative flex items-center justify-between p-4 hover:bg-card',
        !isLastItem && 'border-b border-border',
        isActiveState && 'bg-primary/10 hover:bg-primary/20',
        hasCurrentUserJoined && 'bg-muted',
      )}
    >
      {isRecurringCall(call) && <RepeatBadge />}
      {/* Huddle Icon with Indication */}
      <div className='flex items-center justify-start gap-4 w-full'>
        {/* Headphones Icon */}
        <div className='w-10 h-10 flex items-center justify-center rounded-[10px] border border-border relative bg-background'>
          <HuddleIcon
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
        <div className='flex flex-1 min-w-0 items-start justify-between gap-3'>
          <div className='flex flex-col min-w-0 flex-1 overflow-hidden'>
            <span
              className={cn(
                'text-foreground font-medium text-sm truncate max-w-full',
                isActiveState
                  ? 'text-status-success'
                  : isMissedCall
                    ? 'text-status-failure'
                    : 'text-foreground',
              )}
            >
              {getCallTitle()}
            </span>
            {call.status === CallStatus.ACTIVE ? (
              <p className={cn('text-xs', iconColorClass)}>Ongoing</p>
            ) : (
              <div className='flex flex-col md:flex-row items-start md:items-center gap-0.5 md:gap-1'>
                {(call.startsAt || call.startedAt) && (
                  <p className={cn('text-xs', iconColorClass)}>
                    {formatRelativeTimestamp(call.startsAt || call.startedAt)}
                  </p>
                )}
                <span className={cn('text-xs hidden md:block', iconColorClass)}>•</span>
                <span className={cn('text-xs', iconColorClass)}>{statusText}</span>
              </div>
            )}
          </div>
          <div className={cn('flex items-center', isMobile ? 'gap-1.5' : 'gap-2.5')}>
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
              className='flex items-center -space-x-1.5'
              data-track-category='calls'
              data-track-name='view-past-participants'
            >
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
            {!isActiveState && !isCallJoinable && (
              <>
                <Tooltip
                  content={
                    !isUserChannelMember
                      ? 'You are not a member of this channel'
                      : !handleGotoTranscript
                        ? 'No conversation exists for this call'
                        : 'Go to Call message'
                  }
                  delayDuration={300}
                >
                  <span
                    className={
                      !isUserChannelMember || !handleGotoTranscript ? 'cursor-not-allowed' : ''
                    }
                  >
                    <Button
                      onClick={handleGotoTranscript}
                      variant='outline'
                      size='icon'
                      disabled={!isUserChannelMember || !handleGotoTranscript}
                      className='size-7'
                    >
                      <ScrollText className='size-3.5 text-muted-foreground' />
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
                      variant='outline'
                      size='icon'
                      disabled={!hasTranscript}
                      className='size-7'
                    >
                      <Download className='size-3.5 text-muted-foreground' />
                    </Button>
                  </span>
                </Tooltip>
                <Tooltip content='View External Chat' delayDuration={300}>
                  <Button
                    onClick={onViewExternalChat}
                    variant='outline'
                    size='icon'
                    className='size-7'
                    data-track-category='calls'
                    data-track-name='view-external-chat'
                  >
                    <MessageSquare className='size-3.5 text-muted-foreground' />
                  </Button>
                </Tooltip>
              </>
            )}
            {isUserInvited && !isUserInThisDevice && (
              <Button
                onClick={onCallClick}
                variant='outline'
                data-testid='call-join-button'
                className={cn(
                  isActiveState
                    ? 'ring-1 ring-border border-status-success hover:bg-card rounded-lg h-8'
                    : isCallJoinable
                      ? 'border-border hover:bg-card rounded-lg h-8'
                      : 'size-7',
                  'gap-1.5 items-center',
                )}
              >
                <HuddleIcon
                  className={cn(isActiveState ? 'text-status-success' : 'text-muted-foreground')}
                  size={12}
                />
                {(isActiveState || isCallJoinable) && (
                  <span
                    className={cn(
                      'font-medium text-sm',
                      isActiveState
                        ? 'text-status-success hover:text-status-success'
                        : 'text-foreground',
                    )}
                  >
                    {hasCurrentUserJoined ? 'Switch' : 'Join Call'}
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
