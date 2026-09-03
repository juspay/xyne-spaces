import { ChannelScopeType, ChannelVisibility, Channel } from '@xyne/shared';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { Hashtag, UserTwo } from '@xyne/icons';
import ChatLock from '../../icons/ChatLock';
import Avatar, { type AvatarSize } from '../../ui/Avatar/Avatar';
import { getDMParticipantIdsToFetch, isGroupDMChannel } from '../ChatDirectory/ChatDirectory.utils';

interface ChannelIconProps {
  // The channel to render an icon for. Undefined (e.g. not yet resolved) falls back to a hashtag.
  channel: Channel | undefined;
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

  if (!channel) return <Hashtag size={16} className={glyphClassName} />;

  // Group DM → participant glyph with an "others" count badge (cmd+K's original design).
  if (isGroupDMChannel(channel.scopeType)) {
    const otherCount = getDMParticipantIdsToFetch(channel, context.userID).length;
    return (
      <div className='relative flex h-5 w-5 items-center justify-center'>
        <UserTwo size={16} className={glyphClassName} />
        {otherCount > 0 && (
          <span className='absolute -bottom-0.5 -right-0.5 min-w-3 rounded-full bg-muted px-0.5 text-xs font-semibold leading-none text-muted-foreground'>
            {otherCount}
          </span>
        )}
      </div>
    );
  }

  if (channel.scopeType === ChannelScopeType.DM) {
    const participantIds = getDMParticipantIdsToFetch(channel, context.userID);
    const otherUserId = participantIds.find(id => id !== context.userID);
    return (
      <Avatar userId={otherUserId || context.userID} size={avatarSize} showActiveStatus={true} />
    );
  }

  if (channel.scopeType === ChannelScopeType.DEFAULT) {
    return channel.visibility === ChannelVisibility.PUBLIC ? (
      <Hashtag size={16} className={glyphClassName} />
    ) : (
      <span className={glyphClassName}>
        <ChatLock />
      </span>
    );
  }

  return <Hashtag size={16} className={glyphClassName} />;
};

export default ChannelIcon;
