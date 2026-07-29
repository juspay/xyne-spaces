import { ChannelScopeType, ChannelVisibility, Channel } from '@xyne/shared';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { Hashtag, LockClose } from '@xyne/icons';
import Avatar, { type AvatarSize } from '../../ui/Avatar/Avatar';
import { getDMParticipantIdsToFetch } from '../ChatDirectory/ChatDirectory.utils';

interface ChannelIconProps {
  channel: Channel;
  /**
   * Color class for the hashtag / lock glyphs. Defaults to `text-foreground`
   * (the header/info surfaces). The Cmd+K palette passes `text-muted-foreground`
   * so its slash-command channel rows match every other palette row.
   */
  glyphClassName?: string;
  /**
   * Avatar size used for 1:1 DM channels. Defaults to 'sm' (20px). The Cmd+K
   * palette passes 'xs' (16px) to match its 16px row-icon convention.
   */
  avatarSize?: AvatarSize;
}

const ChannelIcon = ({
  channel,
  glyphClassName = 'text-foreground',
  avatarSize = 'sm',
}: ChannelIconProps): React.ReactNode | null => {
  const context = useAuthContextValues();

  if (
    channel.scopeType === ChannelScopeType.DEFAULT ||
    channel.scopeType === ChannelScopeType.GROUP_DM
  ) {
    if (channel.visibility === ChannelVisibility.PUBLIC) {
      return <Hashtag size={16} className={glyphClassName} />;
    }
    return <LockClose size={16} className={glyphClassName} />;
  }

  if (channel.scopeType === ChannelScopeType.DM) {
    const participantIds = getDMParticipantIdsToFetch(channel, context.userID);
    const otherUserId = participantIds.find(id => id !== context.userID);
    return (
      <Avatar userId={otherUserId || context.userID} size={avatarSize} showActiveStatus={true} />
    );
  }

  return <Hashtag size={16} className={glyphClassName} />;
};

export default ChannelIcon;
