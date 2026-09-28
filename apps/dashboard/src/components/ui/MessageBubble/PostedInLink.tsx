import React, { useRef } from 'react';
import { ChannelScopeType, ChannelType, ChannelVisibility, isDeskChannelType } from '@xyne/shared';
import { buildSdlcPath, parseSdlcNavTarget } from '@xyne/shared/sdlc';
import { Hash, Lock, MessageSquare, CornerUpRight } from 'lucide-react';
import { useChannel, useGetChannelUserStatus } from '../../../hooks/useChannels';
import { queries } from '../../../zero/queries';
import { Tooltip } from '../Tooltip';
import { useQuery } from '../../../hooks/useQuery';
import { useNavigate } from '../../../hooks/useWorkspaceNavigate';
import { apiInstance } from '../../../services/clients/apiClient';
import { logger, Event } from '../../../utils/logger';

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
  // handleClick awaits a round trip; without this a double-click pushes two history entries.
  const navigatingRef = useRef(false);
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
  const handleClick = async (): Promise<void> => {
    if (!hasAccess || navigatingRef.current) return;

    // An SDLC hub is a channel, but it is hidden from chat and rendered under /sdlc.
    // Which page a conversation opens on lives in sdlc_entity_links, so the server resolves it.
    if (channel?.type === ChannelType.SDLC) {
      navigatingRef.current = true;
      const target = await apiInstance
        .get<{ target: unknown }>(
          `/sdlc/channels/${encodeURIComponent(originalChannelId)}/nav-target`,
          { params: { conversationId: originalConversationId, messageId: originalMessageId } },
        )
        .then(response => parseSdlcNavTarget(response.data.target))
        .catch((error: unknown) => {
          // 403 for a non-member, or the request simply failed — the hub root is the fallback.
          logger.error(Event.FRONTEND_ERROR, {
            type: 'sdlc_nav_target_failed',
            channelId: originalChannelId,
            conversationId: originalConversationId,
            message: error instanceof Error ? error.message : 'Unknown error',
          });
          return null;
        })
        .finally(() => {
          navigatingRef.current = false;
        });
      // A bare ?conversation= with no owner is stripped by the hub, so fall back to the hub root.
      void navigate(
        target ? buildSdlcPath(target) : `/sdlc/${encodeURIComponent(originalChannelId)}`,
      );
      return;
    }

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
      void navigate(path, { state: { trackSource: 'chat_link' } });
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
      onClick={() => void handleClick()}
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
