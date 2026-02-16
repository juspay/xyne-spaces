import React, { useMemo } from 'react';
import { AvatarSize, Tooltip, TooltipSide } from '@juspay/blend-design-system';
import { MessageType, parseForwardedMessageXml, isForwardedMessageXml } from '@xyne/shared';
import {
  formatFullTimestamp,
  formatTimeAmPm,
  formatRelativeTimestamp,
} from '../../../utils/dateUtils';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../../zero/queries';
import MessageAttachment from '../../Chat/MessageAttachment/MessageAttachment';
import { useReactions } from '../../../hooks/useReaction';
import { Bookmark } from 'lucide-react';
import { BotBubble } from '../../Chat/BotBubble';
import { getEmojiFontSizeClass } from '../../../utils/emojiUtils';
import { ExpandableMessage } from '../../Chat/ExpandableMessage/ExpandableMessage';
import { MessageMetadata } from './MessageBubble.utils';
import { CallMessageOverlay } from '../../Chat/CallMessageOverlay/CallMessageOverlay';
import { WorkflowBubble } from '../../Chat/WorkflowBubble/WorkflowBubble';
import { PinnedIcon } from '../../../assets/icons/PinnedIcon';
import { ReactionView } from './MessageBubble';
import { ConversationWithTicket } from './MessageBubble.types';
import { ThreadInfoIndicator, AlsoSentToChannelIndicator } from './ThreadMessageIndicators';
import { ChannelScopeType } from '@xyne/shared';
import UserAvatar from '../../UserAvatar/UserAvatar';
import { PostedInLink } from './PostedInLink';
import { hasMessageContent } from '../../../utils/chatUtils';

type MessageWithRelations = QueryResultType<typeof queries.conversationMessages>[number];

export interface MobileMessageMyBubbleProps {
  message: MessageWithRelations;
  showAvatar?: boolean | undefined;
  isPinned?: boolean | undefined;
  isBookmarked?: boolean | undefined;
  isHighlighted?: boolean | undefined;
  channelId?: string | undefined;
  conversation?: ConversationWithTicket;
  context?: 'channel' | 'thread' | undefined;
  threadInfo?:
    | {
        conversationId: string;
        preview: string;
      }
    | undefined;
  channelScopeType?: ChannelScopeType | undefined;
  isFirstInThread?: boolean;
}

/**
 * MobileMessageMyBubble - A mobile-optimized message bubble for "my" messages.
 * - Right-aligned with accent background bubble
 * - Timestamp shown above the bubble
 * - No avatar (since it's the current user's message)
 *
 * This component is only rendered for the current user's messages on mobile.
 * Other users' messages use the standard MessageBubble component.
 */
export const MobileMessageMyBubble: React.FC<MobileMessageMyBubbleProps> = ({
  message,
  isPinned,
  isBookmarked,
  isHighlighted,
  channelId,
  conversation,
  context,
  threadInfo,
  channelScopeType,
  isFirstInThread = false,
}) => {
  const { toggleReaction } = useReactions();
  const reactions = message.reactions || [];
  const attachments = message.attachments || [];

  const isSystemMessage = message.msgType === MessageType.SYSTEM;
  const isBotMessage = message.msgType === MessageType.BOT;
  const isForwardedMessage = message.msgType === MessageType.FORWARDED;
  const metadata = message.metadata as MessageMetadata | null;
  const isWorkflowMessage =
    (isSystemMessage && metadata?.workflowId && metadata?.ticketId) ||
    (isBotMessage && metadata?.xyneId && metadata?.ticketId);
  const isCallMessage = metadata?.isCallMessage === true;
  const isActiveCall = isCallMessage && metadata?.operation === 'call_active';

  // Parse forwarded message XML content
  const forwardedMessageData = useMemo(() => {
    if (isForwardedMessage && isForwardedMessageXml(message.content)) {
      return parseForwardedMessageXml(message.content);
    }
    return null;
  }, [isForwardedMessage, message.content]);

  if (!message) {
    return null;
  }

  const systemMessageStyles: React.CSSProperties = {
    color: 'hsl(var(--muted-foreground))',
  };

  return (
    <>
      {isPinned && (context === 'channel' || (context === 'thread' && isFirstInThread)) && (
        <div className='flex items-center gap-1 text-xs text-amber-600 font-medium mb-1 justify-end pr-2'>
          <PinnedIcon className='w-4 h-4' />
          <span>Pinned</span>
        </div>
      )}

      {isBookmarked && (
        <div className='flex items-center gap-1 text-[11px] text-blue-600 font-normal mb-1 justify-end pr-2'>
          <Bookmark className='w-3 h-3 fill-current' />
          <span>Reminder Set</span>
        </div>
      )}

      {/* ================== THREAD INFO (replied to a thread) ================== */}
      {threadInfo && channelId && (
        <div className='flex justify-end mb-1'>
          <ThreadInfoIndicator
            threadInfo={threadInfo}
            channelId={channelId}
            messageId={message.messageId}
          />
        </div>
      )}

      {/* Show "Also sent to channel/DM" indicator in thread view */}
      {context === 'thread' &&
        message.showInChannel &&
        channelId &&
        message.childConversationId && (
          <div className='flex justify-end mb-1'>
            <AlsoSentToChannelIndicator
              channelId={channelId}
              childConversationId={message.childConversationId}
              {...(channelScopeType && { channelScopeType })}
            />
          </div>
        )}

      <div
        data-component='MobileMessageMyBubble'
        className={`
          group flex gap-2 relative px-3 py-0.5 justify-end items-end mb-3
          ${isHighlighted ? 'bg-blue-50/30' : ''}
        `}
      >
        {/* ================== CONTENT ================== */}
        <div className='flex flex-col min-w-0 max-w-[85%] items-end'>
          {/* Timestamp - Above bubble */}
          <Tooltip content={formatFullTimestamp(message.createdAt)} side={TooltipSide.TOP}>
            <div className='flex items-center justify-end mb-1 w-full'>
              <span className='text-[12px] text-muted-foreground leading-[1.2]'>
                {formatTimeAmPm(message.createdAt)}
              </span>
            </div>
          </Tooltip>

          {/* Bubble / Message Content */}
          <div className='relative p-3 mobile-my-bubble rounded-tl-2xl rounded-bl-2xl rounded-br-2xl rounded-tr-[4px] text-foreground'>
            {isActiveCall && channelId && metadata?.callId ? (
              <CallMessageOverlay callId={metadata.callId} channelId={channelId} />
            ) : isForwardedMessage && forwardedMessageData ? (
              // Forwarded message display (parsed from XML)
              <div className='flex flex-col gap-2'>
                {/* Optional message from forwarder */}
                {forwardedMessageData.optionalText && (
                  <div
                    className={`jp-message-html whitespace-pre-wrap break-all-words inline-block text-[16px] leading-[1.5] ${getEmojiFontSizeClass(forwardedMessageData.optionalText)}`}
                  >
                    <ExpandableMessage
                      message={forwardedMessageData.optionalText}
                      showEdited={message.edited}
                      maxHeight={500}
                    />
                  </div>
                )}
                {/* Forwarded message content with left border */}
                <div className='border-l-4 border-gray-300 pl-3'>
                  <div className='flex items-center gap-2 mb-1'>
                    {forwardedMessageData.originalSenderId && (
                      <UserAvatar
                        userId={forwardedMessageData.originalSenderId}
                        size={AvatarSize.SM}
                        showActiveStatus={false}
                      />
                    )}
                    <span className='text-xs font-medium text-gray-700'>
                      {forwardedMessageData.originalSenderName || 'Unknown User'}
                    </span>
                    {forwardedMessageData.originalCreatedAt && (
                      <span className='text-xs text-gray-500'>
                        {formatRelativeTimestamp(forwardedMessageData.originalCreatedAt)}
                      </span>
                    )}
                  </div>
                  <div
                    className={`jp-message-html whitespace-pre-wrap break-all-words inline-block text-gray-600 ${getEmojiFontSizeClass(forwardedMessageData.content)}`}
                  >
                    <ExpandableMessage
                      message={forwardedMessageData.content}
                      showEdited={false}
                      maxHeight={500}
                    />
                  </div>
                  {/* Attachments inside the forwarded message border - vertical layout same as normal messages */}
                  {attachments.length > 0 && (
                    <div className='mt-2'>
                      {attachments.map(attachment => {
                        const isImageVideoOrText =
                          attachment.mimetype.startsWith('image/') ||
                          attachment.mimetype.startsWith('video/') ||
                          attachment.mimetype === 'text/plain';

                        return (
                          <div
                            key={attachment.id}
                            className={`flex items-center gap-2 py-1 text-sm ${!isImageVideoOrText ? 'w-[256px] aspect-square' : ''}`}
                          >
                            <MessageAttachment attachment={attachment} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {/* Posted in link for forwarded messages */}
                  {forwardedMessageData?.originalChannelId &&
                    forwardedMessageData?.originalConversationId && (
                      <PostedInLink
                        originalChannelId={forwardedMessageData.originalChannelId}
                        originalConversationId={forwardedMessageData.originalConversationId}
                        originalMessageId={forwardedMessageData.originalMessageId}
                      />
                    )}
                </div>
              </div>
            ) : (
              hasMessageContent(message.content) && (
                <div
                  className={`jp-message-html whitespace-pre-wrap break-all-words inline-block text-[16px] leading-[1.5] text-foreground ${getEmojiFontSizeClass(message.content)} ${isSystemMessage ? 'text-muted-foreground italic' : ''}`}
                  style={isSystemMessage ? systemMessageStyles : undefined}
                >
                  <ExpandableMessage
                    message={isWorkflowMessage ? 'Workflow created' : message.content}
                    showEdited={message.edited}
                    maxHeight={500}
                  />
                </div>
              )
            )}

            {conversation?.ticket && !isWorkflowMessage && (
              <BotBubble
                ticket={conversation.ticket}
                context={context}
                messageId={message.messageId}
                {...(channelId && { channelId: channelId })}
                {...(conversation && { conversation: conversation })}
              />
            )}

            {isWorkflowMessage && metadata?.workflowId && (
              <WorkflowBubble
                workflowName={metadata.workflowName}
                workflowStatus={metadata.workflowStatus}
                createdAt={message.createdAt}
                ticketId={metadata.ticketId}
                metadata={metadata}
              />
            )}

            {/* Attachments (only for non-forwarded messages) */}
            {!isForwardedMessage && attachments.length > 0 && (
              <div className='mt-2 pt-2 border-t border-border/50'>
                {attachments.map(attachment => {
                  const isImageVideoOrText =
                    attachment.mimetype.startsWith('image/') ||
                    attachment.mimetype.startsWith('video/') ||
                    attachment.mimetype === 'text/plain';

                  return (
                    <div
                      key={attachment.id}
                      className={`flex items-center gap-2 py-1 text-sm ${!isImageVideoOrText ? 'w-[256px] aspect-square' : ''}`}
                    >
                      <MessageAttachment attachment={attachment} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Reaction View - Outside Bubble */}
          <div className='mt-1 self-end'>
            <ReactionView
              reactions={reactions}
              toggleReaction={toggleReaction}
              messageId={message.messageId}
            />
          </div>
        </div>
      </div>
    </>
  );
};

export default MobileMessageMyBubble;
