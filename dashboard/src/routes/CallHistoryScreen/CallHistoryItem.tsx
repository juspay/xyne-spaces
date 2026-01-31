import { ReactElement } from 'react';
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, Captions, Hash } from 'lucide-react';
import AvatarGroup from '../../components/ui/Avatar/AvatarGroup';
import { type User, ChannelScopeType } from '@xyne/shared';
import { formatRelativeTimestamp } from '../../utils/dateUtils';
import Tooltip from '../../components/ui/Tooltip/Tooltip';
import {
  type Call,
  getParticipantUsers,
  getOtherParticipants,
  hasAnyoneJoined,
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
}

const ICON_SIZE = 20;
const MAX_AVATARS_TO_SHOW = 3;

export function CallHistoryItem({
  call,
  currentUserId,
  onCallClick,
  onParticipantsClick,
  handleGotoTranscript,
}: CallHistoryItemProps): ReactElement {
  // Basic call info
  const isOutgoingCall = call.createdByUserId === currentUserId;
  const currentUserParticipant = call.participants?.find(p => p.userId === currentUserId);
  const hasCurrentUserJoined = currentUserParticipant?.joinedAt !== null;

  // Get channel information
  const allChannels = useAllChannels();
  const channel = allChannels.find(c => c.id === call.channelId);
  const isChannelCall = channel?.scopeType === ChannelScopeType.DEFAULT;

  // Get other participants (excluding current user)
  const otherParticipants = getOtherParticipants(call.participants, currentUserId);
  const allUsersData = useUsers();
  const participantUsers = getParticipantUsers(otherParticipants, allUsersData);
  const userIds = participantUsers.map(u => u.id);
  const primaryUser = participantUsers[0];

  // Determine call status
  const anyoneJoined = hasAnyoneJoined(otherParticipants);
  const { isMissedCall, didNotAnswer } = getCallStatus(
    call,
    isOutgoingCall,
    hasCurrentUserJoined,
    anyoneJoined,
  );

  return renderCallItem({
    call,
    channel,
    isChannelCall,
    primaryUser,
    allUsers: participantUsers,
    userIds,
    isOutgoingCall,
    isMissedCall,
    didNotAnswer,
    onCallClick,
    handleGotoTranscript,
    onParticipantsClick,
  });
}

interface RenderCallItemProps {
  call: Call;
  channel: { id: string; name: string; scopeType: ChannelScopeType } | undefined;
  isChannelCall: boolean;
  primaryUser: User | undefined;
  allUsers: User[];
  userIds: string[];
  isOutgoingCall: boolean;
  isMissedCall: boolean;
  didNotAnswer: boolean;
  onCallClick: () => void;
  onParticipantsClick: () => void;
  handleGotoTranscript?: (() => void) | undefined;
}

function renderCallItem({
  call,
  channel,
  isChannelCall,
  primaryUser,
  allUsers,
  userIds,
  isOutgoingCall,
  isMissedCall,
  didNotAnswer,
  onCallClick,
  onParticipantsClick,
  handleGotoTranscript,
}: RenderCallItemProps): ReactElement {
  // Get call icon
  const getCallIcon = (): ReactElement => {
    if (isMissedCall) {
      return <PhoneMissed size={ICON_SIZE} />;
    }
    if (isOutgoingCall) {
      return <PhoneOutgoing size={ICON_SIZE} />;
    }
    return <PhoneIncoming size={ICON_SIZE} />;
  };

  // Get icon color
  const iconColorClass =
    call.endedAt === null
      ? 'text-green-600 dark:text-green-500'
      : isMissedCall
        ? 'text-red-500 dark:text-red-400'
        : 'text-gray-400 dark:text-gray-500';

  // Get status text and color
  const statusText = getStatusTextUtil(
    isMissedCall,
    didNotAnswer,
    call.endedAt === null,
    call.endedAt ? call.endedAt - call.startedAt : 0,
  );

  const statusColorClass =
    call.endedAt === null
      ? 'text-green-600 dark:text-green-500 font-medium'
      : isMissedCall || didNotAnswer
        ? 'text-red-600 dark:text-red-400'
        : 'text-gray-500 dark:text-gray-400';

  return (
    <div
      role='button'
      tabIndex={0}
      className='px-6 py-3 hover:bg-gray-50 dark:hover:bg-[#2A2A2A] transition-colors cursor-pointer group'
      onClick={onCallClick}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onCallClick();
        }
      }}
    >
      <div className='flex items-center justify-between gap-4'>
        {/* Left: Icon + Name + Info */}
        <div className='flex items-center gap-3 flex-1 min-w-0'>
          {/* Call Type Icon */}
          <div className={`flex-shrink-0 ${iconColorClass}`}>{getCallIcon()}</div>

          {/* Name and Details */}
          <div className='flex-1 min-w-0'>
            <h3 className='text-sm font-medium text-[#384049] dark:text-[#F1F3F4] break-words'>
              {isChannelCall ? (
                <span className='flex items-center gap-1'>
                  <Hash size={14} className='flex-shrink-0' />
                  {channel?.name || 'Unknown Channel'}
                </span>
              ) : (
                <>
                  {primaryUser?.name || 'Unknown'}
                  {allUsers.length > 1 && (
                    <span className='text-[#384049] dark:text-[#F1F3F4] font-medium'>
                      {', '}
                      {allUsers
                        .slice(1, 2)
                        .map(u => u?.name)
                        .join(', ')}
                      {allUsers.length > 2 && (
                        <span className='text-xs ml-1 whitespace-nowrap'>
                          +{allUsers.length - 2} other{allUsers.length - 2 > 1 ? 's' : ''}
                        </span>
                      )}
                    </span>
                  )}
                </>
              )}
            </h3>
            <div className='flex items-center gap-2 mt-0.5 flex-wrap'>
              <span
                className={`text-xs ${isMissedCall ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}
              >
                {formatRelativeTimestamp(call.startedAt)}
              </span>
              <span className='text-xs text-gray-400'>•</span>
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
          <Tooltip content='Go to Transcripts' delayDuration={300}>
            <div
              role='button'
              tabIndex={0}
              onClick={e => {
                e.stopPropagation();
                handleGotoTranscript?.();
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  handleGotoTranscript?.();
                }
              }}
              className='p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'
            >
              <Captions size={16} />
            </div>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
