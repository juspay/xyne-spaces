import React from 'react';
import { ChannelScopeType, ChannelVisibility, isDeskChannelType } from '@xyne/shared';
import { Hash, Lock, MessageSquare, CornerUpRight } from 'lucide-react';
import { useChannel, useGetChannelUserStatus } from '../../../hooks/useChannels';
import { queries } from '../../../zero/queries';
import { Tooltip } from '../Tooltip';
import { useQuery } from '../../../hooks/useQuery';
import { useNavigate } from '../../../hooks/useWorkspaceNavigate';

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
  const participationStatus = useGetChannelUserStatus(originalChannelId);

  // Get the original conversation to check if the message is a thread reply
  const [originalConversation] = useQuery(
    queries.getConversationByIdWithChannel({
      conversationId: originalConversationId,
      channelId: originalChannelId,
      isMember: !!participationStatus,
    }),
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

    // EMAIL channels live in the support screen, not the chat view.
    // Navigate directly to /support/:channelId/:xyneId to avoid the
    // ChatView → <Navigate to="/support/:channelId"> redirect which loses
    // the workspace prefix.
    // SupportScreen expects :ticketId to be the xyneId (e.g. XYNE-123),
    // not the internal CUID — use conversation.ticket.xyneId.
    if (isDeskChannelType(channel?.type)) {
      const xyneId = originalConversation?.ticket?.xyneId;
      const path = xyneId
        ? `/support/${originalChannelId}/${xyneId}`
        : `/support/${originalChannelId}`;
      void navigate(path);
      return;
    }

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
      data-track-category='MESSAGE'
      data-track-name='OPEN_POSTED_IN_CHANNEL'
      disabled={!hasAccess}
      className={`flex items-center gap-1.5 text-xs mt-2 ${
        hasAccess
          ? 'text-primary hover:text-primary/80 hover:underline cursor-pointer'
          : 'text-muted-foreground cursor-not-allowed'
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
