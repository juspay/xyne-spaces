import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@rocicorp/zero/react';
import { ChannelScopeType, ChannelVisibility } from '@xyne/shared';
import { Hash, Lock, MessageSquare, CornerUpRight } from 'lucide-react';
import { useChannel } from '../../../hooks/useChannels';
import { queries } from '../../../zero/queries';
import { Tooltip } from '../Tooltip';

interface PostedInLinkProps {
  originalChannelId: string;
  originalConversationId: string;
  originalMessageId?: string | undefined;
}

/**
 * PostedInLink Component
 *
 * Displays a "Posted in <channel-name>" link below forwarded messages.
 * Shows appropriate icon based on channel type and visibility.
 * Handles access control - only clickable if user has access to the channel.
 */
export const PostedInLink: React.FC<PostedInLinkProps> = ({
  originalChannelId,
  originalConversationId,
  originalMessageId,
}) => {
  const navigate = useNavigate();
  const channel = useChannel(originalChannelId);

  // Get the original conversation to check if the message is a thread reply
  const [originalConversation] = useQuery(
    queries.getConversationById({ conversationId: originalConversationId }),
  );

  // Determine if the original message is a thread reply (not the initial message)
  const isThreadReply =
    originalMessageId &&
    originalConversation?.initialMessageId &&
    originalConversation.initialMessageId !== originalMessageId;

  // For public channels, anyone can access. For private channels, navigation will handle access control.
  const isPublicChannel = channel?.visibility === ChannelVisibility.PUBLIC;
  // If channel exists in user's context, they likely have access
  const hasAccess = isPublicChannel || !!channel;

  // Determine channel type for display
  const isDM = channel?.scopeType === ChannelScopeType.DM;
  const isGroupDM = channel?.scopeType === ChannelScopeType.GROUP_DM;

  // Get display name
  const getDisplayName = (): string => {
    if (isDM) {
      return 'Direct Message';
    }
    if (isGroupDM) {
      return 'Group Message';
    }
    return channel?.name || 'Unknown Channel';
  };

  // Get appropriate icon
  const getIcon = (): React.ReactNode => {
    if (isDM || isGroupDM) {
      return <MessageSquare className='w-3 h-3' />;
    }
    if (channel?.visibility === ChannelVisibility.PRIVATE) {
      return <Lock className='w-3 h-3' />;
    }
    return <Hash className='w-3 h-3' />;
  };

  // Handle click navigation
  const handleClick = (): void => {
    if (!hasAccess) return;

    if (isThreadReply && originalMessageId) {
      // Thread reply: navigate with conversation in path and messageId in hash to open thread panel
      void navigate(
        `/chat/dir/${originalChannelId}/${originalConversationId}#origin=${originalConversationId}&messageId=${originalMessageId}`,
      );
    } else {
      // Initial message or no thread: just navigate to channel with conversation in hash
      void navigate(`/chat/dir/${originalChannelId}#origin=${originalConversationId}`);
    }
  };

  // Don't render if channel not found
  if (!channel) {
    return null;
  }

  const linkContent = (
    <button
      type='button'
      onClick={handleClick}
      disabled={!hasAccess}
      className={`flex items-center gap-1.5 text-xs mt-2 ${
        hasAccess
          ? 'text-blue-600 hover:text-blue-700 hover:underline cursor-pointer'
          : 'text-gray-400 cursor-not-allowed'
      }`}
    >
      <CornerUpRight className='w-3 h-3' />
      <span>Posted in</span>
      {getIcon()}
      <span className={isDM || isGroupDM ? '' : 'font-medium'}>{getDisplayName()}</span>
    </button>
  );

  // Wrap with tooltip if user doesn't have access
  if (!hasAccess) {
    return (
      <Tooltip content="You don't have access to this channel" side='top' delayDuration={300}>
        {linkContent}
      </Tooltip>
    );
  }

  return linkContent;
};

export default PostedInLink;
