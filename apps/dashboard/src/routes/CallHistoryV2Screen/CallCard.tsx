import { CallStatus, ChannelScopeType, InvitationResponse } from '@xyne/shared';
import {
  Hashtag,
  RepeatSquare,
  ThreeDotsMenuHorizontal,
  PhoneDefault,
  PhoneCancel,
} from '@xyne/icons';
import { format } from 'date-fns';
import Avatar from '../../components/ui/Avatar/Avatar';
import { AvatarStackItem } from '../../components/ui/Avatar/AvatarGroup';
import Button from '../../components/ui/Button';
import { formatDuration } from '../../utils/dateUtils';
import { isDMChannel } from '../../components/Chat/ChatDirectory/ChatDirectory.utils';
import { normalizeRecordingTags } from '../../utils/recordingUtils';
import { LabelChip } from '../../components/Labels/LabelPicker';
import {
  Call,
  buildParticipantSummary,
  getParticipantDisplayData,
  getCallParticipantCount,
  getCallStatus,
  getOtherParticipants,
  getPreviewParticipantUsers,
  hasAnyoneJoined,
  hasPreviewParticipantJoined,
  canJoinCall,
} from '../CallHistoryScreen/callHistoryItem.utils';
import { cn } from '../../utils/classNames';
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
  onDetailClick?: (() => void) | undefined;
  /** Confirmed labels on this call, shown as chips under the meta line. */
  labels?: string[];
  /** Resolves a label value (Tag id) to its display text. Defaults to identity. */
  resolveLabel?: (label: string) => string;
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
  onDetailClick,
  labels = [],
  resolveLabel = (label: string): string => label,
}: CallHistoryItemProps) => {
  const allChannels = useAllChannels();
  const visibleChannels = useAllVisibleChannels();
  const { isMobile } = usePlatform();
  const visibleLabels = normalizeRecordingTags(labels);
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

  // "Prerna, Samit & 2 others" — shared by the title fallback and the recents meta line.
  const participantSummary = buildParticipantSummary(
    participantDisplayNames,
    otherParticipantCount,
  );

  const getCallTitle = () => {
    if (call.title) {
      return call.title;
    }

    if (call.title === null && isChannelCall) {
      return (
        <span className='flex items-center gap-1'>
          <Hashtag size={14} className='flex-shrink-0' />
          {channel.name}
        </span>
      );
    }

    return participantSummary;
  };

  const isHighlighted = isActiveState;
  const isRecurring = Boolean(call.recurringSeriesId);
  const CallIcon = isMissedCall ? PhoneCancel : PhoneDefault;
  const recurrenceOccurrenceLabel = isRecurring ? 'Recurring' : null;

  const durationMs = call.endedAt ? call.endedAt - call.startedAt : 0;
  const formattedDuration = !isMissedCall && durationMs > 0 ? formatDuration(durationMs) : null;
  const formattedTime = format(new Date(call.startsAt || call.startedAt), 'h:mm a');
  // DM/GROUP_DM channel rows store `name` as a comma-joined list of participant
  // user ids (not a display name) — never surface it. Also suppress the tag when
  // the title itself already fell back to showing "#channel" (no custom title,
  // default-scope channel call).
  const recentsChannelName =
    channel && !isDMChannel(channel.scopeType) && !(call.title === null && isChannelCall)
      ? channel.name
      : undefined;

  return (
    <div
      onClick={onDetailClick}
      role={onDetailClick ? 'button' : undefined}
      tabIndex={onDetailClick ? 0 : -1}
      onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
        if (onDetailClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onDetailClick();
        }
      }}
      data-track-category='CALLS'
      data-track-name='view-call-detail'
      className={cn(
        'group relative flex items-center justify-between px-3 py-2.5',
        onDetailClick && 'cursor-pointer',
        'rounded-xl border border-transparent hover:bg-accent',
      )}
    >
      {/* Huddle Icon with Indication */}
      <div className='flex items-start justify-start gap-3 w-full'>
        {/* Left icon */}
        <div className='relative shrink-0'>
          <div
            className={cn(
              'size-9 flex items-center justify-center rounded-lg',
              isHighlighted ? 'bg-background' : isMissedCall ? 'bg-status-failure/10' : 'bg-border',
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
          {call.createdByUserId && (
            <Avatar
              userId={call.createdByUserId}
              size='xs'
              showActiveStatus={false}
              className='absolute -bottom-1 -right-1 size-4 rounded-full ring-2 ring-background group-hover:ring-accent'
            />
          )}
        </div>
        <div className='flex flex-1 min-w-0 items-start justify-between gap-3'>
          <div className='flex flex-col min-w-0 flex-1 overflow-hidden gap-0.5'>
            <p
              className={cn(
                'font-medium text-sm truncate',
                isActiveState
                  ? 'text-status-success'
                  : isMissedCall
                    ? 'text-status-failure'
                    : 'text-foreground',
              )}
            >
              {call.title ? (
                <Tooltip content={call.title} delayDuration={500}>
                  <span>{getCallTitle()}</span>
                </Tooltip>
              ) : (
                getCallTitle()
              )}
            </p>
            <div
              className={cn(
                'flex items-center gap-1 text-xs truncate',
                isMissedCall ? 'text-status-failure' : 'text-muted-foreground',
              )}
            >
              <span className='truncate'>{participantSummary}</span>
              <span className='shrink-0'>·</span>
              <span className='shrink-0'>{formattedTime}</span>
              {recentsChannelName && (
                <>
                  <span className='shrink-0'>·</span>
                  <span className='truncate'>#{recentsChannelName}</span>
                </>
              )}
            </div>
            {(recurrenceOccurrenceLabel || visibleLabels.length > 0) && (
              <div className='flex flex-wrap items-center gap-1.5 pt-1'>
                {recurrenceOccurrenceLabel && (
                  <span className='inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border pl-2 pr-2.5 text-xs font-medium text-muted-foreground'>
                    <RepeatSquare className='size-3' />
                    {recurrenceOccurrenceLabel}
                  </span>
                )}
                {visibleLabels.map(label => (
                  <LabelChip key={label} label={resolveLabel(label)} />
                ))}
              </div>
            )}
          </div>
          <div className={cn('flex items-center shrink-0', isMobile ? 'gap-1.5' : 'gap-2.5')}>
            {isActiveState ? (
              <span className='shrink-0 text-xs font-medium text-status-success'>Ongoing</span>
            ) : (
              formattedDuration && (
                <span className='shrink-0 font-mono text-xs text-muted-foreground'>
                  {formattedDuration}
                </span>
              )
            )}
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
                      className='rounded-full flex items-center justify-center ring-2 ring-background group-hover:ring-accent z-10'
                      data-slot='avatar-stack-item'
                      data-index={index}
                    >
                      <Avatar userId={userId} size='rg' showActiveStatus={false} />
                    </AvatarStackItem>
                  ))}
              </div>
              {otherParticipantCount > MAX_AVATARS_TO_SHOW && (
                <span className='text-xs font-medium text-muted-foreground tabular-nums rounded-full bg-border px-1.5 -ml-2 py-1 z-10 ring-2 ring-background group-hover:ring-accent'>
                  +{otherParticipantCount - MAX_AVATARS_TO_SHOW}
                </span>
              )}
            </div>
            {!isActiveState && !isCallJoinable && (
              <div className='flex items-center'>
                {isMissedCall && (
                  <Button
                    onClick={e => {
                      e.stopPropagation();
                      onCallClick();
                    }}
                    data-track-category='CALLS'
                    data-track-name='call-back'
                    className='flex h-7 max-w-0 shrink-0 items-center justify-center overflow-hidden whitespace-nowrap rounded-lg border border-primary !bg-primary/70 hover:!bg-primary px-0 text-sm font-medium text-background opacity-0 transition-all duration-200 group-hover:mr-1.5 group-hover:max-w-40 group-hover:px-3 group-hover:opacity-100'
                  >
                    Call back
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant='outline'
                      size='icon'
                      className='size-7 text-muted-foreground hover:text-foreground hover:bg-border rounded-lg'
                      onClick={e => e.stopPropagation()}
                      data-track-category='CALLS'
                      data-track-name='call-more-options'
                    >
                      <ThreeDotsMenuHorizontal className='size-4' />
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
                      className='text-sm rounded-lg'
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
                        className='text-sm rounded-lg'
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
                      className='text-sm rounded-lg'
                    >
                      Download Transcript
                    </DropdownMenuItem>
                    {!isMissedCall && (
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
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
            {isUserInvited && !isUserInThisDevice && (isActiveState || isCallJoinable) && (
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
