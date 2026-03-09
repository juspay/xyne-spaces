import React, { useMemo } from 'react';
import { ChannelScopeType, Channel } from '@xyne/shared';
import { useAllChannels } from '../../hooks/useChannels';
import { useUser } from '../../hooks/useUsers';
import { useChannelDisplayName } from '../../hooks/useChannelDisplayName';
import Avatar from '../ui/Avatar/Avatar';
import { cn } from '../../utils/classNames';
import { getCommonChannels } from '../../utils/commonChannels';
import { getDMParticipantIdsToFetch } from '../Chat/ChatDirectory/ChatDirectory.utils';

interface CommonChannelsSectionProps {
  profileUserId: string;
  currentUserId: string;
  className?: string;
}

interface CommonChannelItemProps {
  channel: Channel;
  currentUserId: string;
}

const CommonChannelItem: React.FC<CommonChannelItemProps> = ({ channel, currentUserId }) => {
  const { displayName, avatarUserId } = useChannelDisplayName(channel, currentUserId);

  const firstParticipantId = useMemo(() => {
    if (channel.scopeType === ChannelScopeType.GROUP_DM) {
      const userIds = getDMParticipantIdsToFetch(channel, currentUserId);
      return userIds[0];
    }
    return undefined;
  }, [channel, currentUserId]);

  const firstParticipant = useUser(firstParticipantId ?? '');

  const finalAvatarUserId = avatarUserId || firstParticipant?.id || null;

  const isDM = channel.scopeType === ChannelScopeType.DM;
  const memberCount = channel.participantCount || 0;

  return (
    <a
      className='flex items-center gap-3 p-2 rounded-lg group'
      href={`/chat/dir/${channel.id}`}
      aria-label={`Open ${isDM ? 'direct message' : 'group chat'} with ${displayName}`}
    >
      <div className='relative flex-shrink-0'>
        <Avatar userId={finalAvatarUserId} size='rg' showActiveStatus={false} />
        {!isDM && memberCount > 0 && (
          <span className='absolute -bottom-1 -right-1 flex items-center justify-center size-4 text-[10px] font-medium bg-gray-600 text-white rounded-full'>
            {memberCount}
          </span>
        )}
      </div>

      <span className='text-sm text-foreground truncate flex-1 group-hover:underline'>
        {displayName}
      </span>
    </a>
  );
};

/**
 * Displays common DM/GROUP_DM channels between the current user and profile user.
 * Hidden when there are no common channels.
 */
export const CommonChannelsSection: React.FC<CommonChannelsSectionProps> = ({
  profileUserId,
  currentUserId,
  className,
}) => {
  const allChannels = useAllChannels();

  const { group_dm: groupDm } = useMemo(
    () => getCommonChannels(allChannels, currentUserId, profileUserId, ['GROUP_DM']),
    [allChannels, currentUserId, profileUserId],
  );

  const commonChannels = useMemo(() => {
    if (!profileUserId || !currentUserId || profileUserId === currentUserId) {
      return [];
    }

    const sortedChannels = [...groupDm].sort((a, b) => {
      const aActivity = a.lastActivityAt || 0;
      const bActivity = b.lastActivityAt || 0;
      return bActivity - aActivity;
    });

    return sortedChannels.slice(0, 3);
  }, [groupDm, profileUserId, currentUserId]);

  if (commonChannels.length === 0) {
    return null;
  }

  return (
    <div className={cn('pt-4', className)}>
      <h3 className='text-sm font-semibold text-foreground mb-3'>Common Groups</h3>
      <div className='space-y-2'>
        {commonChannels.map(channel => (
          <CommonChannelItem key={channel.id} channel={channel} currentUserId={currentUserId} />
        ))}
      </div>
    </div>
  );
};

export default CommonChannelsSection;
