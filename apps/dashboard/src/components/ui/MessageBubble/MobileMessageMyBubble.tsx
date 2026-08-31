import React, { useMemo } from 'react';
import { AvatarSize } from '../../UserAvatar/UserAvatar';
import { MessageType, parseForwardedMessageXml, isForwardedMessageXml } from '@xyne/shared';
import { formatTimeAmPm, formatRelativeTimestamp } from '../../../utils/dateUtils';
import { useReactions } from '../../../hooks/useReaction';
import { Bookmark } from 'lucide-react';
import { BotBubble } from '../../Chat/BotBubble';
import { getEmojiFontSizeClass } from '../../../utils/emojiUtils';
import { ExpandableMessage } from '../../Chat/ExpandableMessage/ExpandableMessage';
import { MessageMetadata } from './MessageBubble.utils';
import { CallMessageOverlay } from '../../Chat/CallMessageOverlay/CallMessageOverlay';
import { useIsCallActive } from '../../../hooks/useCalls';
import { PinnedIcon } from '../../../assets/icons/PinnedIcon';
import { ReactionView } from './MessageBubble';
import { ConversationWithTicket, MessageWithOptionalNudgeCounts } from './MessageBubble.types';
import { ThreadInfoIndicator, AlsoSentToChannelIndicator } from './ThreadMessageIndicators';
import { ChannelScopeType } from '@xyne/shared';
import UserAvatar from '../../UserAvatar/UserAvatar';
import { PostedInLink } from './PostedInLink';
import { hasMessageContent } from '../../../utils/chatUtils';
import { SurfaceNudgeList } from '../../Chat/Nudges/SurfaceNudgeList';
import { MobileAttachmentsGrid } from './MobileAttachmentsGrid';
import { usePlatform } from '../../../hooks/usePlatform';
import { cn } from '../../../utils/classNames';
import MessageAttachment from '../../Chat/MessageAttachment/MessageAttachment';
import { RecordingShareContent } from './RecordingShareContent';
import type { ResolvedRecordingShareMessage } from './recordingShareMessage';

export interface MobileMessageMyBubbleProps {
  message: MessageWithOptionalNudgeCounts;
  showAvatar?: boolean | undefined;
  isPinned?: boolean | undefined;
  isBookmarked?: boolean | undefined;
  isReminderSet?: boolean | undefined;
  reminderDueInLabel?: string | undefined;
  isHighlighted?: boolean | undefined;
  channelId?: string | undefined;
  conversation?: ConversationWithTicket;
  context?: 'channel' | 'thread' | undefined;
  contentOnly?: boolean;
  threadInfo?:
    | {
        conversationId: string;
        preview: string;
      }
    | undefined;
  channelScopeType?: ChannelScopeType | undefined;
  isFirstInThread?: boolean;
  workflowNumber?: number | undefined;
  recordingShare?: ResolvedRecordingShareMessage | null;
  onClick?: ((e: React.MouseEvent<HTMLDivElement>) => void) | undefined;
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
  isReminderSet,
  reminderDueInLabel,
  isHighlighted,
  channelId,
  conversation,
  context,
  contentOnly,
  threadInfo,
  channelScopeType,
  isFirstInThread = false,
  recordingShare,
  onClick,
}) => {
  const { toggleReaction } = useReactions();
  const attachments = message.attachments || [];

  const isSystemMessage = message.msgType === MessageType.SYSTEM;
  const isBotMessage = message.msgType === MessageType.BOT;
  const isForwardedMessage = message.msgType === MessageType.FORWARDED;
  const metadata = message.metadata as MessageMetadata | null;
  const isWorkflowMessage =
    (isSystemMessage && metadata?.workflowId && metadata?.ticketId) ||
    (isBotMessage && metadata?.xyneId && metadata?.ticketId);
  const isTicketCardMessage =
    !!conversation?.ticket_md &&
    conversation?.initialMessageId === message.messageId &&
    !isWorkflowMessage;
  const ticketAttachments = isTicketCardMessage ? (conversation?.ticket?.attachments ?? []) : [];
  const isActiveCall = useIsCallActive(metadata?.callId);
  const { isMobile } = usePlatform();
  const actionableCount = useMemo(
    () => (message.nudgeCounts ?? []).reduce((sum, row) => sum + row.nudgeCount, 0),
    [message.nudgeCounts],
  );
  const countRowIds = useMemo(
    () => Array.from(new Set((message.nudgeCounts ?? []).map(row => row.id))),
    [message.nudgeCounts],
  );

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
        <div className='flex items-center gap-1 text-xs text-status-pending font-medium mb-1 justify-end pr-2'>
          <PinnedIcon className='w-4 h-4' />
          <span>Pinned</span>
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
        className={cn(
          'group flex gap-2 relative px-3 py-0.5 justify-end items-end',
          isHighlighted && 'highlight-message',
        )}
      >
        {/* ================== CONTENT ================== */}
        <div className='flex flex-col min-w-0 max-w-[85%] items-end'>
          {isBookmarked && (
            <div className='inline-flex items-center gap-1 text-blue-700 dark:text-blue-200 text-[11px] font-medium mb-1'>
              <Bookmark className='w-3 h-3 fill-current' />
              <span>
                {isReminderSet
                  ? `Reminder Set${reminderDueInLabel ? ` • ${reminderDueInLabel}` : ''}`
                  : 'Bookmark'}
              </span>
            </div>
          )}

          {/* Bubble / Message Content */}
          <div
            className={cn(
              'relative p-2 mobile-my-bubble rounded-tl-2xl rounded-bl-2xl rounded-br-2xl rounded-tr-[4px] text-foreground flex',
              isMobile ? 'flex-col-reverse gap-1' : 'flex-col',
            )}
            onClick={onClick}
            {...(onClick
              ? {
                  'data-track-category': 'MESSAGE',
                  'data-track-name': 'OPEN_MY_MESSAGE_BUBBLE_MOBILE',
                  // Static label: the auto-label would capture message content.
                  'data-track-label': 'message_bubble',
                }
              : {})}
            onKeyDown={
              onClick
                ? e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onClick(e as unknown as React.MouseEvent<HTMLDivElement>);
                    }
                  }
                : undefined
            }
            role={onClick ? 'button' : undefined}
            tabIndex={onClick ? 0 : undefined}
            style={{ cursor: onClick ? 'pointer' : undefined }}
          >
            {/* Timestamp - Above bubble */}
            <div className='flex items-center justify-end w-full'>
              <span className='text-[10px] pr-1 pt-1 text-muted-foreground leading-[1.2]'>
                {formatTimeAmPm(message.createdAt)}
              </span>
            </div>
            {recordingShare && !isForwardedMessage ? (
              <RecordingShareContent
                recordingShare={recordingShare}
                showPill={false}
                renderNote={noteHtml => (
                  <div
                    className={cn(
                      'jp-message-html whitespace-pre-wrap break-all-words inline-block text-[16px] leading-[1.5] text-foreground',
                      getEmojiFontSizeClass(noteHtml),
                    )}
                  >
                    <ExpandableMessage
                      message={noteHtml}
                      showEdited={message.edited}
                      maxHeight={500}
                    />
                  </div>
                )}
              />
            ) : isActiveCall && channelId && metadata?.callId ? (
              <CallMessageOverlay callId={metadata.callId} channelId={channelId} />
            ) : isForwardedMessage && forwardedMessageData ? (
              // Forwarded message display (parsed from XML)
              <div className='flex flex-col gap-2'>
                {/* Optional message from forwarder */}
                {forwardedMessageData.optionalText && (
                  <div
                    className={cn(
                      'jp-message-html whitespace-pre-wrap break-all-words inline-block text-[16px] leading-[1.5]',
                      getEmojiFontSizeClass(forwardedMessageData.optionalText),
                    )}
                  >
                    <ExpandableMessage
                      message={forwardedMessageData.optionalText}
                      showEdited={message.edited}
                      maxHeight={500}
                    />
                  </div>
                )}
                {/* Forwarded message content with left border */}
                <div className='border-l-4 border-border pl-3'>
                  <div className='flex items-center gap-2 mb-1'>
                    {forwardedMessageData.originalSenderId && (
                      <UserAvatar
                        userId={forwardedMessageData.originalSenderId}
                        size={AvatarSize.SM}
                        showActiveStatus={false}
                      />
                    )}
                    <span className='text-xs font-medium text-muted-foreground'>
                      {forwardedMessageData.originalSenderName || 'Unknown User'}
                    </span>
                    {forwardedMessageData.originalCreatedAt && (
                      <span className='text-xs text-muted-foreground'>
                        {formatRelativeTimestamp(forwardedMessageData.originalCreatedAt)}
                      </span>
                    )}
                  </div>
                  {recordingShare ? (
                    <RecordingShareContent
                      recordingShare={recordingShare}
                      showPill={false}
                      renderNote={noteHtml => (
                        <div
                          className={cn(
                            'jp-message-html whitespace-pre-wrap break-all-words inline-block text-muted-foreground',
                            getEmojiFontSizeClass(noteHtml),
                          )}
                        >
                          <ExpandableMessage
                            message={noteHtml}
                            showEdited={false}
                            maxHeight={500}
                          />
                        </div>
                      )}
                    />
                  ) : (
                    <div
                      className={cn(
                        'jp-message-html whitespace-pre-wrap break-all-words inline-block text-muted-foreground',
                        getEmojiFontSizeClass(forwardedMessageData.content),
                      )}
                    >
                      <ExpandableMessage
                        message={forwardedMessageData.content}
                        showEdited={false}
                        maxHeight={500}
                      />
                    </div>
                  )}
                  {/* Attachments inside the forwarded message border - vertical layout same as normal messages */}
                  {attachments.length > 0 && (
                    <div className='mt-2 min-w-[256px]'>
                      <MobileAttachmentsGrid attachments={attachments} />
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
                  className={cn(
                    'jp-message-html whitespace-pre-wrap break-all-words inline-block text-[16px] leading-[1.5] text-foreground',
                    getEmojiFontSizeClass(message.content),
                    isSystemMessage ? 'text-muted-foreground italic' : '',
                  )}
                  style={isSystemMessage ? systemMessageStyles : undefined}
                >
                  <ExpandableMessage
                    message={isWorkflowMessage ? 'Workflow created' : message.content}
                    showEdited={message.edited}
                    maxHeight={500}
                    messageId={message.messageId}
                    conversationId={message.conversationId}
                    slashCommandArtifactContext={{
                      ...(channelId && { channelId }),
                      senderId: message.senderId,
                      createdAt: message.createdAt,
                      surface: context === 'thread' ? 'thread' : 'channel',
                    }}
                  />
                </div>
              )
            )}

            {/* Attachments (only for non-forwarded messages) */}
            {!isForwardedMessage && attachments.length > 0 && (
              <div className='border-t border-border/50 w-[min(75vw,360px)]'>
                <MobileAttachmentsGrid attachments={attachments} />
              </div>
            )}
          </div>

          {recordingShare && (
            <RecordingShareContent recordingShare={recordingShare} className='w-full mt-2' />
          )}

          {isTicketCardMessage && ticketAttachments && ticketAttachments.length > 0 && (
            <div className='mt-2 flex flex-wrap gap-2 self-stretch'>
              {ticketAttachments.map(attachment => (
                <MessageAttachment
                  key={attachment.id}
                  attachment={attachment}
                  allAttachments={ticketAttachments}
                  compact
                />
              ))}
            </div>
          )}

          {conversation && conversation.ticket_md && !isWorkflowMessage && (
            <div className='w-full'>
              <BotBubble
                context={context}
                messageId={message.messageId}
                {...(channelId && { channelId: channelId })}
                {...(conversation && { conversation: conversation })}
              />
            </div>
          )}

          {!contentOnly && (
            <SurfaceNudgeList
              messageId={message.messageId}
              actionableCount={actionableCount}
              countRowIds={countRowIds}
              channelId={channelId}
              contentOnly={contentOnly}
              isMobile={true}
              messageType={message.msgType}
              isDeleted={message.isDeleted}
              className='mt-2 w-full'
            />
          )}

          {/* Reaction View - Outside Bubble */}
          <div className='mt-1 self-end'>
            <ReactionView
              reactionsMd={message.reactions_md}
              toggleReaction={toggleReaction}
              messageId={message.messageId}
            />
          </div>
        </div>
      </div>
    </>
  );
};
