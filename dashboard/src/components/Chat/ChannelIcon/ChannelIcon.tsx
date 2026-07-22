import { ChannelScopeType, ChannelVisibility, Channel } from '@xyne/shared';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { Hashtag, LockClose } from '@xyne/icons';
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
      return <Hashtag size={16} className='text-foreground' />;
    }
    return <LockClose size={16} className='text-foreground' />;
  }

  if (channel.scopeType === ChannelScopeType.DM) {
    const participantIds = getDMParticipantIdsToFetch(channel, context.userID);
    const otherUserId = participantIds.find(id => id !== context.userID);
    return <Avatar userId={otherUserId || context.userID} size='sm' showActiveStatus={true} />;
  }

  return <Hashtag size={16} className='text-foreground' />;
};

export default ChannelIcon;
