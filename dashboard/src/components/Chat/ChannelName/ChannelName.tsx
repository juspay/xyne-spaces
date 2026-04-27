import React from 'react';
import { Hash, Lock } from 'lucide-react';
import { AvatarSize } from '../../UserAvatar/UserAvatar';
import { ChannelScopeType, ChannelVisibility, Channel } from '@xyne/shared';
import { useAuthContextValues } from '../../../hooks/useAuth';
import UserAvatar from '../../UserAvatar/UserAvatar';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';

interface ChannelNameProps {
  channel: Channel;
  showIcon?: boolean;
  iconSize?: 'sm' | 'md' | 'lg';
  textSize?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  onClick?: () => void;
}

const iconSizeClasses = {
  sm: 'w-3 h-3',
  md: 'w-4 h-4',
  lg: 'w-5 h-5',
};

const textSizeClasses = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
  xl: 'text-xl',
};

export const ChannelName: React.FC<ChannelNameProps> = ({
  channel,
  showIcon = true,
  iconSize = 'md',
  textSize = 'md',
  className = '',
  onClick,
}) => {
  const context = useAuthContextValues();
  const { displayName } = useChannelDisplayName(channel, context.userID);
  // Helper function to render channel icon
  const renderChannelIcon = (): React.ReactNode => {
    if (
      channel.scopeType === ChannelScopeType.DEFAULT ||
      channel.scopeType === ChannelScopeType.GROUP_DM
    ) {
      if (channel.visibility === ChannelVisibility.PUBLIC) {
        return <Hash className={`${iconSizeClasses[iconSize]} text-muted-foreground`} />;
      }
      return <Lock className={`${iconSizeClasses[iconSize]} text-muted-foreground`} />;
    }

    if (channel.scopeType === ChannelScopeType.DM) {
      const participantIds = channel.name.split(',');
      const otherUserId = participantIds.find(id => id !== context.userID);
      if (!otherUserId) return null;
      return (
        <UserAvatar
          size={
            iconSize === 'sm' ? AvatarSize.SM : iconSize === 'md' ? AvatarSize.SM : AvatarSize.MD
          }
          userId={otherUserId || null}
        />
      );
    }

    return <Hash className={`${iconSizeClasses[iconSize]} text-muted-foreground`} />;
  };

  return (
    <button
      className={`flex items-center space-x-3 ${onClick ? 'cursor-pointer' : ''} ${className}`}
      onClick={onClick}
      data-track-category='CHANNEL_NAME'
      data-track-name='OPEN_CHANNEL_DETAILS'
      data-track-metadata={JSON.stringify({ channelId: channel.id })}
    >
      {showIcon && renderChannelIcon()}
      <span
        className={`font-semibold text-foreground ${textSizeClasses[textSize]} ${onClick ? 'hover:underline' : ''}`}
      >
        {displayName}
      </span>
    </button>
  );
};

export default ChannelName;
