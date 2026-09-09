import { ReactElement } from 'react';
import {
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Captions,
  Calendar,
  Hash,
  Download,
} from 'lucide-react';
import AvatarGroup from '../../components/ui/Avatar/AvatarGroup';
import { CallStatus, ChannelScopeType, InvitationResponse } from '@xyne/shared';
import { formatRelativeTimestamp } from '../../utils/dateUtils';
import Tooltip from '../../components/ui/Tooltip/Tooltip';
import {
  type Call,
  getCallParticipantCount,
  getParticipantDisplayData,
  getPreviewParticipantUsers,
  getOtherParticipants,
  hasAnyoneJoined,
  hasPreviewParticipantJoined,
  getCallStatus,
  getStatusText as getStatusTextUtil,
} from './callHistoryItem.utils';
import { useUsers } from '../../hooks/useUsers';
import { useAllChannels } from '../../hooks/useChannels';

interface CallHistoryItemProps {
  call: Call;
  currentUserId: string | undefined;
  onCallClick: () => void;
  onParticipantsClick: () => void;
  handleGotoTranscript?: (() => void) | undefined;
  handleDownloadTranscript?: (() => void) | undefined;
}

const ICON_SIZE = 20;
const MAX_AVATARS_TO_SHOW = 3;

export function CallHistoryItem({
  call,
  currentUserId,
  onCallClick,
  onParticipantsClick,
  handleGotoTranscript,
  handleDownloadTranscript,
}: CallHistoryItemProps): ReactElement {
  // Check if call is scheduled
  const isScheduled = call.status === CallStatus.SCHEDULED;

  // Basic call info
  const isOutgoingCall = call.createdByUserId === currentUserId;
  const currentUserParticipant = call.participants?.find(p => p.userId === currentUserId);
  const isUserInvited = !!currentUserParticipant;
  const hasCurrentUserJoined = currentUserParticipant?.response === InvitationResponse.ACCEPTED;
  const userJoinedandLeft = currentUserParticipant?.response === InvitationResponse.LEFT;

  // Get channel information
  const allChannels = useAllChannels();
  const channel = allChannels.find(c => c.id === call.channelId);
  const isChannelCall = channel?.scopeType === ChannelScopeType.DEFAULT;

  // Check if current user is a member of the channel
  const isUserChannelMember = !!channel;

  // Get other participants (excluding current user)
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
  // userIds only contains internal users (for avatar lookup); external users have no profile avatar
  const userIds =
    participantUsers.length > 0 ? participantUsers.map(u => u.id) : fallbackParticipantData.userIds;

  const participantDisplayNames =
    participantUsers.length > 0
      ? participantUsers.map(user => user.name || user.email || 'Unknown')
      : fallbackParticipantData.displayNames;

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

  // Check if transcript is available
  const hasTranscript = Boolean(call.transcript);

  return renderCallItem({
    call,
    channel,
    isChannelCall,
    userIds,
    participantDisplayNames,
    otherParticipantCount,
    isOutgoingCall,
    isMissedCall,
    didNotAnswer,
    hasTranscript,
    isUserChannelMember,
    isScheduled,
    onCallClick,
    handleGotoTranscript,
    handleDownloadTranscript,
    onParticipantsClick,
  });
}

interface RenderCallItemProps {
  call: Call;
  channel: { id: string; name: string; scopeType: ChannelScopeType } | undefined;
  isChannelCall: boolean;
  userIds: string[];
  /** Resolved display names for all other participants (handles both internal and external users) */
  participantDisplayNames: string[];
  otherParticipantCount: number;
  isOutgoingCall: boolean;
  isMissedCall: boolean;
  didNotAnswer: boolean;
  hasTranscript: boolean;
  isUserChannelMember: boolean;
  isScheduled: boolean;
  onCallClick: () => void;
  onParticipantsClick: () => void;
  handleGotoTranscript?: (() => void) | undefined;
  handleDownloadTranscript?: (() => void) | undefined;
}

function renderCallItem({
  call,
  channel,
  isChannelCall,
  userIds,
  participantDisplayNames,
  otherParticipantCount,
  isOutgoingCall,
  isMissedCall,
  didNotAnswer,
  hasTranscript,
  isUserChannelMember,
  isScheduled,
  onCallClick,
  onParticipantsClick,
  handleGotoTranscript,
  handleDownloadTranscript,
}: RenderCallItemProps): ReactElement {
  // Get call icon
  const getCallIcon = (): ReactElement => {
    if (isScheduled) {
      return <Calendar size={ICON_SIZE} />;
    }
    if (isMissedCall) {
      return <PhoneMissed size={ICON_SIZE} />;
    }
    if (isOutgoingCall) {
      return <PhoneOutgoing size={ICON_SIZE} />;
    }
    return <PhoneIncoming size={ICON_SIZE} />;
  };

  // Get icon color
  const iconColorClass = isScheduled
    ? 'text-status-scheduled'
    : call.status === CallStatus.ACTIVE
      ? 'text-status-success'
      : isMissedCall
        ? 'text-status-failure'
        : 'text-muted-foreground';

  // Get status text and color
  const statusText = isScheduled
    ? 'Upcoming'
    : getStatusTextUtil(
        isMissedCall,
        didNotAnswer,
        call.status === CallStatus.ACTIVE,
        call.endedAt ? call.endedAt - call.startedAt : 0,
      );

  const statusColorClass = isScheduled
    ? 'text-status-scheduled font-medium'
    : call.status === CallStatus.ACTIVE
      ? 'text-status-success font-medium'
      : isMissedCall || didNotAnswer
        ? 'text-status-failure'
        : 'text-muted-foreground';

  return (
    <div
      role='button'
      tabIndex={0}
      className='px-6 py-3 hover:bg-muted transition-colors cursor-pointer group'
      onClick={onCallClick}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onCallClick();
        }
      }}
      data-testid={`${statusText}`}
      data-track-category='CALLS'
      data-track-name='OpenCallHistory'
      data-track-metadata={JSON.stringify({ callId: call.id })}
    >
      <div className='flex items-center justify-between gap-4'>
        {/* Left: Icon + Name + Info */}
        <div className='flex items-center gap-3 flex-1 min-w-0'>
          {/* Call Type Icon */}
          <div className={`flex-shrink-0 ${iconColorClass}`}>{getCallIcon()}</div>

          {/* Name and Details */}
          <div className='flex-1 min-w-0'>
            <h3 className='text-sm font-medium text-foreground break-words'>
              {call.title ? (
                // If title exists, show title
                <span className='text-foreground font-medium'>{call.title}</span>
              ) : isChannelCall ? (
                // If channel call, show channel name
                <span className='flex items-center gap-1 visual-regression-hide'>
                  <Hash size={14} className='flex-shrink-0' />
                  {channel?.name || 'Unknown Channel'}
                </span>
              ) : (
                // Otherwise show participant names (handles both internal and external users)
                <>
                  {participantDisplayNames[0] || 'Unknown'}
                  {otherParticipantCount > 1 && (
                    <span className='text-foreground font-medium'>
                      {', '}
                      {participantDisplayNames.slice(1, 2).join(', ')}
                      {otherParticipantCount > 2 && (
                        <span className='text-xs ml-1 whitespace-nowrap'>
                          +{otherParticipantCount - 2} other
                          {otherParticipantCount - 2 > 1 ? 's' : ''}
                        </span>
                      )}
                    </span>
                  )}
                </>
              )}
            </h3>
            <div className='flex items-center gap-2 mt-0.5 flex-wrap visual-regression-hide'>
              <span
                className={`text-xs ${isMissedCall ? 'text-status-failure' : 'text-muted-foreground'}`}
              >
                {isScheduled && call.startsAt
                  ? formatRelativeTimestamp(call.startsAt)
                  : formatRelativeTimestamp(call.startedAt)}
              </span>
              <span className='text-xs text-muted-foreground'>•</span>
              <span className={`text-xs ${statusColorClass}`}>{statusText}</span>
            </div>
          </div>
        </div>

        {/* Right: Participant Avatars */}
        <div className='flex items-center gap-3 flex-shrink-0'>
          <div
            role='button'
            tabIndex={0}
            className='cursor-pointer'
            onClick={e => {
              e.stopPropagation();
              onParticipantsClick();
            }}
            data-track-category='CALLS'
            data-track-name='ViewParticipants'
            data-track-metadata={JSON.stringify({ callId: call.id })}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onParticipantsClick();
              }
            }}
          >
            <AvatarGroup userIds={userIds} size='sm' count={MAX_AVATARS_TO_SHOW} />
          </div>
          <Tooltip
            content={
              !isUserChannelMember ? 'You are not a member of this channel' : 'Go to Call message'
            }
            delayDuration={300}
          >
            <div
              role='button'
              tabIndex={isUserChannelMember ? 0 : -1}
              onClick={e => {
                e.stopPropagation();
                if (isUserChannelMember) {
                  handleGotoTranscript?.();
                }
              }}
              data-track-category='CALLS'
              data-track-name='GoToTranscript'
              data-track-metadata={JSON.stringify({ callId: call.id })}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  if (isUserChannelMember) {
                    handleGotoTranscript?.();
                  }
                }
              }}
              className={`p-2 rounded-full ${
                isUserChannelMember
                  ? 'hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer transition-colors'
                  : 'text-muted-foreground/50 cursor-not-allowed'
              }`}
            >
              <Captions size={16} />
            </div>
          </Tooltip>
          <Tooltip
            content={hasTranscript ? 'Download Transcript' : 'Transcript not available'}
            delayDuration={300}
          >
            <div
              role='button'
              tabIndex={hasTranscript ? 0 : -1}
              onClick={e => {
                e.stopPropagation();
                if (hasTranscript) {
                  handleDownloadTranscript?.();
                }
              }}
              data-track-category='CALL_HISTORY'
              data-track-name='DownloadTranscript'
              data-track-metadata={JSON.stringify({ callId: call.id })}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  if (hasTranscript) {
                    handleDownloadTranscript?.();
                  }
                }
              }}
              className={`p-2 rounded-full ${
                hasTranscript
                  ? 'hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer transition-colors'
                  : 'text-muted-foreground/50 cursor-not-allowed'
              }`}
            >
              <Download size={16} />
            </div>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
