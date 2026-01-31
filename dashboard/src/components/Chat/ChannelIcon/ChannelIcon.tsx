import { ChannelScopeType, ChannelVisibility, Channel } from '@xyne/shared';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { Hash, Lock } from 'lucide-react';
import Avatar from '../../ui/Avatar/Avatar';
import { getDMParticipantIdsToFetch } from '../ChatDirectory/ChatDirectory.utils';

interface ChannelIconProps {
  channel: Channel;
}

const ChannelIcon = ({ channel }: ChannelIconProps): React.ReactNode | null => {
  const context = useAuthContextValues();

  if (
    channel.scopeType === ChannelScopeType.DEFAULT ||
    channel.scopeType === ChannelScopeType.GROUP_DM
  ) {
    if (channel.visibility === ChannelVisibility.PUBLIC) {
      return <Hash className='w-4 h-4 text-gray-900' />;
    }
    return <Lock className='w-4 h-4 text-gray-900' />;
  }

  if (channel.scopeType === ChannelScopeType.DM) {
    const participantIds = getDMParticipantIdsToFetch(channel, context.userID);
    const otherUserId = participantIds.find(id => id !== context.userID);
    if (!otherUserId) return null;
    return <Avatar userId={otherUserId} size='sm' />;
  }

  return <Hash className='w-4 h-4 text-gray-900' />;
};

export default ChannelIcon;
