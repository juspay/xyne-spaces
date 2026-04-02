import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useZero } from '../../../hooks/useZero';
import { useSummaryCache } from '../../../hooks/useSummaryQuery';
import { MessageBubble } from '../../ui/MessageBubble/MessageBubble';
import { BotBubble } from '../BotBubble';
import { LinkPreview } from '../LinkPreview/LinkPreview';
import { InternalMessagePreview } from '../LinkPreview/InternalMessagePreview';
import { CanvasPreview } from '../../Canvas/CanvasPreview';
import { TicketActivityMessage } from '../TicketActivityMessage/TicketActivityMessage';
import { ConversationTabContext } from '../ConversationTabContext';

import { HoverActionsToolbar } from '../HoverActionsToolbar/HoverActionsToolbar';
import { useAuthContext } from '../../../providers/AuthProvider';
import { ChatInput } from '../ChatInput';
import { usePin } from '../../../hooks/usePin';
import { useEditContext } from '../../../providers/EditProvider';
import { toast } from 'sonner';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import {
  MessageType,
  BookmarkEntityType,
  ChannelScopeType,
  parseForwardedMessageXml,
  parsePreviewMd,
} from '@xyne/shared';
import { mutators } from '../../../zero/mutators';
// import { useIntersectionObserver } from '../../../hooks/useIntersectionObserver';
import { convertHtmlToBlocks } from './ChatBubble.utils';
import { sanitizeHtmlString } from '../../../utils/sanitizer';
import { cn } from '../../../utils/classNames';
import { copyHtmlToClipboard, markdownToHtml } from '../../../utils/clipboardUtils';
import { RenderMessageWithHTML } from '../RenderMessageWithHTML/RenderMessageWithHTML';
import { getEmojiFontSizeClass } from '../../../utils/emojiUtils';
import ReplyLayoutV2 from '../ReplyLayout/ReplyLayoutV2';
import { CallLayout } from '../CallLayout';
import { Dialog } from '../../ui/Dialog/Dialog';
import { Button } from '../../ui/Button/Button';
import { formatRelativeTimestamp } from '../../../utils/dateUtils';
import { isMessageEditable } from '../../../utils/chatUtils';
import { v4 as uuidv4 } from 'uuid';
import { X } from 'lucide-react';
import Avatar from '../../ui/Avatar/Avatar';
import {
  mixpanelService,
  EVENTS,
  EVENT_PROPERTIES,
} from '../../../services/Analytics/mixpanelService';
import {
  extractOriginFromHash,
  extractMessageIdFromHash,
  createMessagePreview,
} from '../ChatList/ChatListUtils';
import { useUserBookmarks } from '../../../hooks/useUserBookmarks';
import { useChannel } from '../../../hooks/useChannels';
import { usePlatform } from '../../../hooks/usePlatform';
import { useShortcutById } from '../../../shortcuts';
import { MessageActionsDrawer } from '../MessageActionsDrawer/MessageActionsDrawer';
import { useUser } from '../../../hooks/useUsers';
import { SHAREABLE_ORIGIN } from '../../../config';
import {
  ConversationWithTicket,
  MessageWithOptionalNudgeCounts,
} from '../../ui/MessageBubble/MessageBubble.types';
import { SubTicketModal } from '../../Tickets/SubTicketModal/SubTicketModal';
import { ForwardMessageForm } from '../ForwardMessageModal/ForwardMessageModal';
import { xyneAIActor, type ThreadInfo } from '../../../machines/xyneAIMachine';
import DOMPurify from 'dompurify';
import { CallParticipantsSelectionModal } from '../../Call/CallParticipantsSelectionModal';
import { AttachmentRef } from '../../../machines/attachmentViewerMachine';
import {
  getInitialMessageFromConversation,
  getParentMessageFromConversation,
} from '../../../utils/conversationMessageHelpers';

export interface ThreadData {
  replyCount: number;
  lastActivityAt?: number;
  onOpenThread?: (e?: React.MouseEvent) => void;
  conversation?: ConversationWithTicket;
}

interface ChatBubbleProps {
  message: MessageWithOptionalNudgeCounts;
  channelId: string;
  projectId?: string | undefined;
  channelScopeType?: ChannelScopeType | undefined;
  replies?: ThreadData;
  showAvatar?: boolean;
  draft?: string | undefined;
  hasDraftAttachments?: boolean;
  conversation?: ConversationWithTicket;
  variant?: 'default' | 'pinned';
  context?: 'channel' | 'thread';
  isFirstInThread?: boolean;
  isTicketThread?: boolean;
  onEmojiPickerOpenChange?: (isOpen: boolean) => void;
  allThreadAttachments?: AttachmentRef[];
  workflowNumber?: number | undefined;
}

export const ChatBubble: React.FC<ChatBubbleProps> = ({
  message,
  channelId,
  projectId,
  channelScopeType,
  replies,
  showAvatar,
  conversation,
  draft,
  hasDraftAttachments,
  variant = 'default',
  context = 'channel',
  isFirstInThread = false,
  isTicketThread = false,
  onEmojiPickerOpenChange,
  allThreadAttachments,
  workflowNumber,
}) => {
  const { user } = useAuthContext();
  const [isCreateTicketModalOpen, setIsCreateTicketModalOpen] = useState(false);
  const [isSubTicketModalOpen, setIsSubTicketModalOpen] = useState(false);
  const [isActionsDrawerOpen, setIsActionsDrawerOpen] = useState(false);
  const [showParticipantsModal, setShowParticipantsModal] = useState(false);
  const zero = useZero();
  const { onMessageChange } = useSummaryCache();
  const { togglePin } = usePin();
  const navigate = useNavigate();
  const location = useLocation();
  const { conversationId } = useParams<{ conversationId?: string }>();
  const { editingMessageId, requestEdit, stopEditing } = useEditContext();
  const { setSkipMarkAsRead } = React.useContext(ConversationTabContext);
  const { isMobile } = usePlatform();
  const channel = useChannel(channelId);
  // Get sender info from useUser hook
  const sender = useUser(message.senderId);

  const messageConversationId = message.conversationId;

  const hasActiveCallForConversation = useMemo(() => {
    return !!conversation?.callId;
  }, [conversation?.callId]);

  const isMessageDeleted = message.isDeleted;

  const [isHighlighted, setIsHighlighted] = useState(false);

  useEffect(() => {
    const highlightedConversationId = extractOriginFromHash(location.hash);
    const highlightedMessageId = extractMessageIdFromHash(location.hash);

    let shouldHighlight = false;
    if (context === 'thread' && highlightedMessageId) {
      shouldHighlight =
        message.conversationId === highlightedConversationId &&
        message.messageId === highlightedMessageId;
    } else if (context === 'channel' && highlightedConversationId && conversation !== undefined) {
      shouldHighlight = conversation.conversationId === highlightedConversationId;
    }

    if (shouldHighlight) {
      setIsHighlighted(false);
      requestAnimationFrame(() => setIsHighlighted(true));
    } else {
      setIsHighlighted(false);
    }
  }, [
    location.key,
    location.hash,
    context,
    message.conversationId,
    message.messageId,
    conversation?.conversationId,
  ]);
  const [showHoverActions, setShowHoverActions] = useState(false);
  const [showLinkPreview, setShowLinkPreview] = useState(true);
  const [showCanvasPreview, setShowCanvasPreview] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isForwardModalOpen, setIsForwardModalOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isScrollingRef = useRef(false);
  const pressTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setIsEditing(editingMessageId === message.messageId);
  }, [editingMessageId, message.messageId]);

  const { isEntityBookmarked } = useUserBookmarks();

  // Check if message is bookmarked
  const bookmarkData = isEntityBookmarked(message.messageId, BookmarkEntityType.MESSAGE);
  const isBookmarked = !!bookmarkData;

  const metadata = message?.metadata as Record<string, unknown> | null;

  // Both internal and external link previews are stored in link_preview_md
  const previewResult = parsePreviewMd(message.link_preview_md);
  const isThreadOpen = conversation?.conversationId === conversationId;

  const isMentionUserAddition = metadata && metadata['messageSubtype'] === 'user_not_in_channel';

  // Check if message has a ticket associated with it
  const hasTicket = metadata && metadata['ticketId'] !== undefined;

  // Mark activities as read when message becomes visible
  // const observerRef = useIntersectionObserver(() => {
  //   void zero.mutate(mutators.activities.markActivitiesSeenByMessageId({
  //     messageId: message.messageId,
  //   });
  // });

  useEffect(() => {
    onEmojiPickerOpenChange?.(isEmojiPickerOpen);
  }, [isEmojiPickerOpen, onEmojiPickerOpenChange]);

  const handleActionsDrawerOpenChange = (open: boolean): void => {
    setIsActionsDrawerOpen(open);
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }

    // Dismiss keyboard when opening the drawer on mobile
    if (open && isMobile) {
      // Blur any active input/textarea to dismiss keyboard
      const activeElement = document.activeElement as HTMLElement;
      if (
        activeElement &&
        (activeElement.tagName === 'INPUT' ||
          activeElement.tagName === 'TEXTAREA' ||
          activeElement.isContentEditable)
      ) {
        activeElement.blur();
      }
    }
  };

  const handleCreateTicket = (): void => {
    setIsCreateTicketModalOpen(true);
  };

  const handleTicketCreated = (_ticket: unknown): void => {
    toast.success('Success', {
      description: 'Ticket created successfully',
      duration: 3000,
    });
  };

  const handleCreateSubTicket = (): void => {
    setIsSubTicketModalOpen(true);
  };

  const handleAskAI = (): void => {
    // Get conversation ID from message context
    const conversationId = conversation?.conversationId || message.conversationId;
    if (!conversationId) return;

    // Extract plain text from message content
    let previewText = '';
    const content = message.content;

    if (content && typeof content === 'string') {
      const parser = new DOMParser();
      const doc = parser.parseFromString(content, 'text/html');
      const textContent = doc.body.textContent || '';
      previewText = textContent.trim().substring(0, 100);
    }

    // Get attachment IDs from the message (if any)
    const attachmentIds = message.attachments?.map((att: { id: string }) => att.id) || [];

    // If no text content but has attachments, show "Attachment"
    if (!previewText && attachmentIds.length > 0) {
      previewText =
        attachmentIds.length === 1 ? 'Attachment' : `${attachmentIds.length} Attachments`;
    }

    const threadInfo: ThreadInfo = {
      conversationId,
      senderName: sender?.name || 'Unknown',
      previewText,
      ...(attachmentIds.length > 0 && { attachmentIds }),
    };

    // Open XyneAI with thread context but always start a fresh chat
    // This shows the thread header but doesn't load old conversation
    xyneAIActor.send({
      type: 'OPEN',
      channelId,
      threadInfo,
      startFreshChat: true,
    });
  };

  const handleEditInCanvas = (): void => {
    try {
      const sanitizedContent = sanitizeHtmlString(message.content);
      const blocks = convertHtmlToBlocks(sanitizedContent);
      // Navigate to new canvas route with state for editing message
      void navigate('/chat/canvas/new', {
        state: {
          mode: 'edit-message',
          messageId: message.messageId,
          initialContent: blocks,
          channelId: channelId,
        },
      });
    } catch {
      toast.error('Error', {
        description:
          'Failed to convert message to canvas format. The message may contain invalid formatting.',
        duration: 3000,
      });
    }
  };

  const handlePinMessage = (): void => {
    if (!conversation) return;
    togglePin(conversation.conversationId);
  };

  const handleEditMessage = (): void => {
    requestEdit(message.messageId, () => {
      setIsEditing(true);
      // Scroll the message into view when editing starts
      setTimeout(() => {
        if (containerRef.current) {
          containerRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100); // Small delay to ensure the editor is rendered
    });
  };

  const handleDeleteMessage = (): void => {
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = async (): Promise<void> => {
    setIsDeleting(true);

    try {
      const result = zero.mutate(mutators.messages.delete({ messageId: message.messageId }));
      await result.server;
      // Invalidate summary cache when message is deleted
      onMessageChange(message['conversationId'], channelId);
      mixpanelService.track(EVENTS.INITIATE_ACTION, {
        type: EVENT_PROPERTIES.ACTION_TYPES.DELETE_MESSAGE,
      });
      toast.success('Message deleted', {
        description: 'Your message has been deleted successfully',
        duration: 3000,
      });
      setShowDeleteConfirm(false);
    } catch {
      toast.error('Delete failed', {
        description: 'Could not delete the message',
        duration: 3000,
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleInitiateCall = (): void => {
    setShowParticipantsModal(true);
  };

  const handleToggleBookmark = (): void => {
    try {
      if (isBookmarked) {
        void zero.mutate(
          mutators.bookmark.remove({
            entityId: message.messageId,
            entityType: BookmarkEntityType.MESSAGE,
          }),
        );
      } else {
        void zero.mutate(
          mutators.bookmark.add({
            entityId: message.messageId,
            entityType: BookmarkEntityType.MESSAGE,
            bookmarkId: uuidv4(),
            timestamp: Date.now(),
          }),
        );
      }
      // Track bookmark action (using existing action types for now)
      mixpanelService.track(EVENTS.INITIATE_ACTION, {
        type: isBookmarked ? 'removeBookmark' : 'addBookmark',
      });
    } catch {
      toast.error('Action failed', {
        description: `Could not ${isBookmarked ? 'remove' : 'add'} bookmark`,
        duration: 3000,
      });
    }
  };

  const onCopyLink = (): void => {
    // Get conversation ID from conversation object or fallback to message
    const conversationId = conversation?.conversationId || message.conversationId;
    let messageLink = '';
    if (conversationId) {
      if (context === 'thread') {
        // Thread message: include full path with conversation + messageId in hash
        messageLink = `${SHAREABLE_ORIGIN}/chat/dir/${channelId}/${conversationId}#origin=${conversationId}&messageId=${message.messageId}`;
      } else {
        // Channel message: only channel in path, conversation in hash
        messageLink = `${SHAREABLE_ORIGIN}/chat/dir/${channelId}#origin=${conversationId}`;
      }
    }

    navigator.clipboard
      .writeText(messageLink)
      .then(() => {
        toast.success('Link copied', {
          description: 'Message link copied to clipboard',
          duration: 3000,
        });
      })
      .catch(() => {
        toast.error('Failed to copy', {
          description: 'Could not copy link to clipboard',
          duration: 3000,
        });
      });
  };

  const handleCopyMessage = (): void => {
    if (message?.content) {
      // Check if this is markdown content (e.g., call summaries)
      const isMarkdownContent = metadata?.['contentFormat'] === 'markdown';

      // For forwarded messages, extract the actual content from the XML structure
      const contentToCopy =
        message.msgType === MessageType.FORWARDED
          ? parseForwardedMessageXml(message.content)?.content || message.content
          : message.content;

      // Convert markdown to HTML if needed, then normalize headings to bold paragraphs
      const copyPromise = isMarkdownContent
        ? markdownToHtml(contentToCopy)
            .then(html => copyHtmlToClipboard(html))
            .catch(error => {
              console.warn('Markdown processing failed, falling back to raw content:', error);
              return copyHtmlToClipboard(contentToCopy);
            })
        : copyHtmlToClipboard(contentToCopy);

      copyPromise
        .then(() => {
          toast.success('Message copied to clipboard');
        })
        .catch(() => {
          toast.error('Could not copy message to clipboard');
        });

      // Also copy plain text with emoji replacement (only if there are emoji images)
      if (contentToCopy.includes('data-emoji="true"')) {
        const sanitizedContent = DOMPurify.sanitize(contentToCopy);
        const parser = new DOMParser();
        const doc = parser.parseFromString(sanitizedContent, 'text/html');

        // Replace custom emoji <img> with :emoji_name:
        doc.querySelectorAll('img[data-emoji="true"]').forEach(img => {
          const alt = img.getAttribute('alt') || '';
          img.replaceWith(document.createTextNode(alt));
        });

        const plainText = doc.body.textContent || '';

        navigator.clipboard
          .writeText(plainText)
          .then(() => toast.success('Message copied to clipboard'))
          .catch(() => toast.error('Could not copy message'));
      }
    }
  };

  const handleSendToChannel = (): void => {
    try {
      void zero.mutate(
        mutators.messages.updateShowInChannel({
          messageId: message.messageId,
          showInChannel: true,
          childConversationId: uuidv4(),
          timestamp: Date.now(),
        }),
      );
    } catch {
      toast.error('Failed to send message to channel', {
        description: 'Please try again.',
        duration: 3000,
      });
      // console.error('Failed to send message to channel:', error);
    }
  };

  const handleForwardMessage = (): void => {
    setIsForwardModalOpen(true);
  };

  const handleMarkAsUnread = (): void => {
    // Prevent parent component from marking as read on unmount
    setSkipMarkAsRead(true);
    // Prevent scroll position from resetting when lastViewedAt changes
    // setSkipScrollReset(true);

    try {
      void zero.mutate(
        mutators.channel.markChannelUnreadFrom({
          channelId,
          messageId: message.messageId,
          conversationId: message.conversationId,
        }),
      );
      toast.success('Marked as unread');
    } catch (error) {
      console.error('Failed to mark as unread:', error);
      toast.error('Failed to mark as unread. Please try again.');
      // Reset the skip flags since the operation failed
      setSkipMarkAsRead(false);
      // setSkipScrollReset(false);
    }
  };

  const finishEditing = (): void => {
    setIsEditing(false);
    stopEditing(); // release global lock
  };

  const canEditMessage = user?.id ? isMessageEditable(message, user.id) : false;

  // Check if message has meaningful text content (not just attachments)
  const hasTextContent = (() => {
    if (!message?.content) return false;

    // Parse HTML and get text content
    const parser = new DOMParser();
    const doc = parser.parseFromString(message.content, 'text/html');
    const textContent = (doc.body.textContent || '').trim();

    const hasEmoji = doc.querySelectorAll('img[data-emoji="true"]').length > 0;

    // Consider it text content only if there's actual text
    return textContent.length > 0 || hasEmoji;
  })();

  // Only show copy button if there's text content to copy
  const shouldShowCopyButton = hasTextContent;

  // Keyboard shortcuts for message actions - only enabled when message is hovered/focused
  useShortcutById('message.edit', handleEditMessage, {
    enabled: showHoverActions && canEditMessage,
  });

  useShortcutById('message.delete', handleDeleteMessage, {
    enabled: showHoverActions && canEditMessage,
  });

  useShortcutById('message.pin', handlePinMessage, {
    enabled: showHoverActions && !!conversation && !isMessageDeleted,
  });

  useShortcutById('message.bookmark', handleToggleBookmark, {
    enabled: showHoverActions && !isMessageDeleted,
  });

  useShortcutById('message.copyLink', onCopyLink, {
    enabled: showHoverActions,
  });

  useShortcutById(
    'message.copyContent',
    () => {
      if (message?.content) {
        copyHtmlToClipboard(message.content)
          .then(() => {
            toast.success('Message content copied to clipboard');
          })
          .catch(() => {
            toast.error('Could not copy content to clipboard');
          });
      }
    },
    {
      enabled: showHoverActions && !isMessageDeleted,
    },
  );

  if (!message) return <></>;

  const isCurrentEditing = editingMessageId === message.messageId;

  // Check for canvas link
  const msgContent = message?.content as string | undefined;
  const canvasIdMatch = msgContent?.match(/\/chat\/canvas\/([a-zA-Z0-9-]+)/);
  const canvasId = canvasIdMatch ? canvasIdMatch[1] : null;

  const shouldShowSendToChannel =
    context === 'thread' &&
    !message.showInChannel &&
    !isFirstInThread &&
    message.senderId === user?.id;

  // Check if this is a ticket activity message
  const isTicketActivity =
    message.msgType === MessageType.SYSTEM && metadata?.['isTicketActivity'] === true;
  // Check if this is a ticket creation message (system message with ticketId)
  const isTicketCreationMessage =
    message.msgType === MessageType.SYSTEM &&
    metadata?.['ticketId'] !== undefined &&
    !isTicketActivity;
  // Check if this is a system message (channel join, etc.) - not ticket activities or ticket creation
  const isSystemMessage =
    message.msgType === MessageType.SYSTEM && !isTicketActivity && !isTicketCreationMessage;

  // Check if this is a showInChannel message (thread reply shown in main channel)
  const isShowInChannel = message.showInChannel === true;

  // Check if this is a call message (system message with isCallMessage metadata)
  const isCallMessage = isSystemMessage && metadata?.['isCallMessage'] === true;

  const SHOW_IN_CHANNEL_REPLY_COUNT_CHECK = 1;

  // Access parent message through denormalized parent_message_md
  const parentMessage = conversation
    ? (getParentMessageFromConversation(conversation) ??
      (conversation as { parentMessage?: { content: string; conversationId?: string } })
        ?.parentMessage)
    : undefined;

  const threadPreviewText =
    isShowInChannel && parentMessage?.content ? createMessagePreview(parentMessage.content) : null;

  // For showInChannel messages, check if there are newer replies in the original thread
  // by checking if replyCount meets the minimum threshold
  const showViewNewerReplies =
    isShowInChannel && conversation?.replyCount === SHOW_IN_CHANNEL_REPLY_COUNT_CHECK;

  // Check if mark as unread should be shown
  const shouldShowMarkAsUnread =
    context === 'channel' && !isSystemMessage && !isMessageDeleted && !isTicketCreationMessage;

  // Render ticket activity message with special styling
  if (isTicketActivity) {
    return <TicketActivityMessage message={message} />;
  }

  return (
    <div
      ref={el => {
        // Assign to both refs
        containerRef.current = el;
        // (observerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      }}
      data-testid={`chat-message-${message.messageId}`}
      data-show-avatar={showAvatar}
      className='no-select-mobile relative transition-all duration-200 ease-in-out'
      style={{ touchAction: 'pan-y' }}
      onTouchStart={e => {
        if (isMobile) {
          // Skip long-press when touch is inside a modal/preview overlay
          const target = e.target;
          if (
            target instanceof HTMLElement &&
            (target.closest('[data-prevent-drawer="true"]') ||
              !containerRef.current?.contains(target))
          ) {
            return;
          }

          isScrollingRef.current = false;

          pressTimerRef.current = setTimeout(() => {
            if (!isScrollingRef.current) {
              handleActionsDrawerOpenChange(true);
              isScrollingRef.current = false;
            }
          }, 600);
        }
      }}
      onTouchMove={() => {
        if (isMobile) {
          isScrollingRef.current = true;
          if (pressTimerRef.current) {
            clearTimeout(pressTimerRef.current);
            pressTimerRef.current = null;
          }
        }
      }}
      onTouchEnd={() => {
        if (pressTimerRef.current) {
          clearTimeout(pressTimerRef.current);
          pressTimerRef.current = null;
        }
      }}
      onTouchCancel={() => {
        if (pressTimerRef.current) {
          clearTimeout(pressTimerRef.current);
          pressTimerRef.current = null;
        }
      }}
      onMouseEnter={() => {
        if (!isMobile) {
          setShowHoverActions(true);
        }
      }}
      onMouseLeave={() => {
        if (!isEmojiPickerOpen && !isDropdownOpen) {
          setShowHoverActions(false);
        }
      }}
    >
      {isEditing && isCurrentEditing ? (
        <ChatInput
          autoFocus='end' // eslint-disable-line jsx-a11y/no-autofocus
          channelId={channelId}
          conversation={conversation}
          messageId={message.messageId}
          initialContent={
            message.msgType === MessageType.FORWARDED
              ? (parseForwardedMessageXml(message.content)?.optionalText ?? '')
              : message.content
          }
          placeholder='Edit message…'
          className='ml-12'
          showTypingIndicator={false}
          onEditComplete={finishEditing}
          onCancel={finishEditing}
          isForwardedContent={message.msgType === MessageType.FORWARDED}
        />
      ) : (
        <>
          <MessageBubble
            isHovered={showHoverActions}
            message={message}
            showAvatar={showAvatar}
            isPinned={conversation?.pinned || false}
            isBookmarked={isBookmarked}
            variant={variant}
            isHighlighted={isHighlighted}
            channelId={channelId}
            context={context}
            channelScopeType={channelScopeType}
            isFirstInThread={isFirstInThread}
            {...(allThreadAttachments && { allThreadAttachments })}
            workflowNumber={workflowNumber}
            {...(conversation && { conversation: conversation })}
            {...(isShowInChannel &&
              parentMessage &&
              threadPreviewText &&
              parentMessage.conversationId && {
                threadInfo: {
                  preview: threadPreviewText,
                  conversationId: parentMessage.conversationId,
                },
              })}
          />

          {!isMobile && (
            <HoverActionsToolbar
              isVisible={showHoverActions && variant !== 'pinned' && !isMentionUserAddition}
              showEditAction={canEditMessage}
              messageId={message.messageId}
              conversationId={conversation?.conversationId || message.conversationId}
              {...(conversation && { conversation })}
              {...(conversation?.initialMessageId && {
                initialMessageId: conversation.initialMessageId,
              })}
              reactionsMd={message.reactions_md}
              onCopyLink={onCopyLink}
              {...(!isMessageDeleted &&
                shouldShowCopyButton && { onCopyMessage: handleCopyMessage })}
              {...(!isMessageDeleted && { onEmojiPickerOpenChange: setIsEmojiPickerOpen })}
              {...(!isMessageDeleted && !hasTicket && { onEditInCanvas: handleEditInCanvas })}
              onDropdownOpenChange={setIsDropdownOpen}
              isChannelArchived={channel?.isArchived ?? false}
              {...(context === 'channel' &&
                !isSystemMessage &&
                !isMessageDeleted &&
                !hasTicket &&
                channelScopeType === ChannelScopeType.DEFAULT && {
                  onCreateTicket: handleCreateTicket,
                })}
              {...(context === 'thread' &&
                !isMessageDeleted &&
                isTicketThread &&
                !isFirstInThread && {
                  onCreateSubTicket: handleCreateSubTicket,
                })}
              {...((!isSystemMessage || isTicketCreationMessage) &&
                !isMessageDeleted && { onBookmark: handleToggleBookmark })}
              {...(!isMessageDeleted &&
                (isCallMessage || !isSystemMessage) && { onForwardMessage: handleForwardMessage })}
              isBookmarked={isBookmarked}
              isPinned={conversation?.pinned || false}
              {...(shouldShowSendToChannel &&
                !isMessageDeleted && { onSendToChannel: handleSendToChannel })}
              {...(canEditMessage && !hasTicket && { onEditMessage: handleEditMessage })}
              {...(canEditMessage && !hasTicket && { onDeleteMessage: handleDeleteMessage })}
              {...(replies &&
                (!isSystemMessage || isTicketCreationMessage || isCallMessage) &&
                !isShowInChannel &&
                (!isMessageDeleted || context === 'channel') && {
                  onReplyInThread: replies?.onOpenThread,
                })}
              {...(!isSystemMessage &&
                !isMessageDeleted && {
                  onInitiateCall: handleInitiateCall,
                  isCallDisabled: hasActiveCallForConversation,
                })}
              {...(conversation &&
                (!isSystemMessage || isTicketCreationMessage) &&
                !isMessageDeleted &&
                (context === 'channel' || (context === 'thread' && isFirstInThread)) && {
                  onPinMessage: handlePinMessage,
                })}
              {...(((conversation && (context === 'channel' || isFirstInThread)) ||
                isCallMessage) &&
                (!isSystemMessage || isCallMessage) &&
                !isMessageDeleted && { onAskAI: handleAskAI })}
              {...(shouldShowMarkAsUnread ? { onMarkAsUnread: handleMarkAsUnread } : {})}
            />
          )}
          {/* Mobile Actions Drawer */}
          {isMobile && (
            <MessageActionsDrawer
              open={isActionsDrawerOpen}
              onOpenChange={handleActionsDrawerOpenChange}
              messageId={message.messageId}
              conversationId={conversation?.conversationId || message.conversationId}
              {...(conversation?.initialMessageId && {
                initialMessageId: conversation.initialMessageId,
              })}
              {...(conversation && { conversation })}
              reactionsMd={message.reactions_md}
              showEditAction={canEditMessage}
              isBookmarked={isBookmarked}
              isPinned={conversation?.pinned || false}
              onCopyLink={onCopyLink}
              {...(!isMessageDeleted &&
                shouldShowCopyButton && { onCopyMessage: handleCopyMessage })}
              {...(context === 'channel' &&
                !isSystemMessage &&
                !isMessageDeleted &&
                !hasTicket &&
                channelScopeType === ChannelScopeType.DEFAULT && {
                  onCreateTicket: handleCreateTicket,
                })}
              {...((!isSystemMessage || isTicketCreationMessage) &&
                !isMessageDeleted && { onBookmark: handleToggleBookmark })}
              {...(!isMessageDeleted &&
                (isCallMessage || !isSystemMessage) && { onForwardMessage: handleForwardMessage })}
              {...(shouldShowSendToChannel &&
                !isMessageDeleted && { onSendToChannel: handleSendToChannel })}
              {...(canEditMessage && !hasTicket && { onEditMessage: handleEditMessage })}
              {...(canEditMessage && !hasTicket && { onDeleteMessage: handleDeleteMessage })}
              {...(canEditMessage && !hasTicket && { onEditInCanvas: handleEditInCanvas })}
              {...(replies &&
                (!isSystemMessage || isTicketCreationMessage || isCallMessage) &&
                !isShowInChannel &&
                (!isMessageDeleted || context === 'channel') && {
                  onReplyInThread: (e?: React.MouseEvent) => {
                    if (pressTimerRef.current) {
                      clearTimeout(pressTimerRef.current);
                      pressTimerRef.current = null;
                    }
                    replies?.onOpenThread?.(e);
                  },
                })}
              {...(!isSystemMessage &&
                !isMessageDeleted && {
                  onInitiateCall: handleInitiateCall,
                  isCallDisabled: hasActiveCallForConversation,
                })}
              {...(conversation &&
                (!isSystemMessage || isTicketCreationMessage) &&
                !isMessageDeleted &&
                (context === 'channel' || (context === 'thread' && isFirstInThread)) && {
                  onPinMessage: handlePinMessage,
                })}
              {...(((conversation && (context === 'channel' || isFirstInThread)) ||
                isCallMessage) &&
                (!isSystemMessage || isCallMessage) &&
                !isMessageDeleted && { onAskAI: handleAskAI })}
              {...(shouldShowMarkAsUnread ? { onMarkAsUnread: handleMarkAsUnread } : {})}
              isChannelArchived={channel?.isArchived ?? false}
            />
          )}
        </>
      )}

      {variant !== 'pinned' && showLinkPreview && previewResult && !canvasId && (
        <div
          className={cn(
            'pr-3 max-w-full pl-4 ml-14 transition-colors rounded-r border-l-4 border-l-gray-300 dark:border-l-gray-600',
            message.senderId === user?.id && 'max-[500px]:mb-5',
            showHoverActions && 'bg-accent/50',
          )}
        >
          {previewResult.type === 'message_preview' ? (
            <InternalMessagePreview
              metadata={{
                type: 'internal_message',
                ...previewResult.data,
              }}
              onClose={() => setShowLinkPreview(false)}
            />
          ) : (
            <LinkPreview metadata={previewResult.data} onClose={() => setShowLinkPreview(false)} />
          )}
        </div>
      )}
      {variant !== 'pinned' && canvasId && showCanvasPreview && (
        <div className='mt-2 ml-12 max-w-lg flex-1'>
          <CanvasPreview canvasId={canvasId} onClose={() => setShowCanvasPreview(false)} />
        </div>
      )}
      {replies && (
        <ReplyLayoutV2
          replies={
            conversation
              ? {
                  ...replies,
                  conversation,
                }
              : replies
          }
          draft={draft}
          {...(!!hasDraftAttachments && { hasDraftAttachments })}
          isThreadOpen={isThreadOpen}
          isMe={message.senderId === user?.id}
          showInChannel={message.showInChannel}
          isCallMessage={isCallMessage}
          showViewNewerReplies={showViewNewerReplies}
          {...(parentMessage?.conversationId && {
            parentConversationId: parentMessage.conversationId,
          })}
          messageId={message.messageId}
        />
      )}

      {conversation?.callId && context === 'channel' && <CallLayout callId={conversation.callId} />}

      {projectId && conversation && (
        <BotBubble
          messageId={message.messageId}
          messageContent={message.content}
          channelId={channelId}
          context={context}
          conversation={conversation}
          isModalOpen={isCreateTicketModalOpen}
          renderTicketCard={false}
          onModalOpenChange={setIsCreateTicketModalOpen}
          onTicketCreated={handleTicketCreated}
        />
      )}

      {/* SubTicket Modal for ticket threads */}
      {conversation && context === 'thread' && isTicketThread && (
        <SubTicketModal
          isOpen={isSubTicketModalOpen}
          onClose={() => setIsSubTicketModalOpen(false)}
          ticketId={(() => {
            const initMsg =
              getInitialMessageFromConversation(conversation) ?? conversation.initialMessage;
            return ((initMsg?.metadata as Record<string, unknown>)?.['ticketId'] as string) || '';
          })()}
          conversationId={conversation.conversationId}
        />
      )}

      <Dialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title='Delete message'
        description='Are you sure you want to delete this message?'
      >
        <div>
          {/* Header with title and close button */}
          <div className='flex items-center justify-between px-6 pt-6 pb-4 border-b border-border'>
            <h2 className='text-lg font-semibold text-foreground'>Delete message</h2>
            <button
              className='rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:ring-offset-2 disabled:pointer-events-none'
              onClick={() => setShowDeleteConfirm(false)}
              data-track-category='CHAT_BUBBLE'
              data-track-name='CLOSE_DELETE_CONFIRM_DIALOG'
              data-track-metadata={JSON.stringify({ messageId: message?.messageId })}
            >
              <X className='h-4 w-4' />
              <span className='sr-only'>Close</span>
            </button>
          </div>

          <div className='px-6 py-4 space-y-4'>
            <p className='text-sm text-foreground'>
              Are you sure you want to delete this message? This cannot be undone.
            </p>

            {/* Message Preview */}
            <div className='bg-muted rounded-md p-3 border border-border'>
              <div className='flex gap-3'>
                <div className='flex-shrink-0'>
                  <Avatar userId={message.senderId} size='md' />
                </div>

                <div className='flex-1 min-w-0'>
                  <div className='flex items-baseline gap-2 mb-1'>
                    <h4 className='text-sm font-semibold text-foreground'>
                      {sender?.name || 'User'}
                    </h4>
                    <span className='text-xs text-muted-foreground'>
                      {formatRelativeTimestamp(message.createdAt)}
                    </span>
                  </div>
                  {/* Handle forwarded message preview */}
                  {message.msgType === MessageType.FORWARDED ? (
                    (() => {
                      const forwardedData = parseForwardedMessageXml(message.content);
                      return forwardedData ? (
                        <div className='flex flex-col gap-2 overflow-auto max-h-[350px]'>
                          {forwardedData.optionalText && (
                            <div
                              className={`text-foreground ${getEmojiFontSizeClass(forwardedData.optionalText)}`}
                            >
                              <RenderMessageWithHTML message={forwardedData.optionalText} />
                            </div>
                          )}
                          <div className='border-l-4 border-border pl-3'>
                            <div className='flex items-center gap-2 mb-1'>
                              <span className='text-xs font-medium text-foreground'>
                                {forwardedData.originalSenderName}
                              </span>
                              {forwardedData.originalCreatedAt && (
                                <span className='text-xs text-muted-foreground'>
                                  {formatRelativeTimestamp(forwardedData.originalCreatedAt)}
                                </span>
                              )}
                            </div>
                            <div
                              className={`text-muted-foreground ${getEmojiFontSizeClass(forwardedData.content)}`}
                            >
                              <RenderMessageWithHTML message={forwardedData.content} />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div
                          className={`text-foreground overflow-auto max-h-[350px] ${getEmojiFontSizeClass(message.content)}`}
                        >
                          <RenderMessageWithHTML message={message.content} />
                        </div>
                      );
                    })()
                  ) : (
                    <div
                      className={`text-foreground overflow-auto max-h-[350px] ${getEmojiFontSizeClass(message.content)}`}
                    >
                      <RenderMessageWithHTML message={message.content} />
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className='flex justify-end gap-3 pt-2'>
              <Button
                variant='secondary'
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
                data-track-category='CHAT_BUBBLE'
                data-track-name='CANCEL_DELETE_CONFIRM_DIALOG'
                data-track-metadata={JSON.stringify({ messageId: message?.messageId })}
              >
                Cancel
              </Button>
              <Button
                variant='destructive'
                onClick={() => {
                  void handleConfirmDelete();
                }}
                loading={isDeleting}
                disabled={isDeleting}
                data-track-category='CHAT_BUBBLE'
                data-track-name='CONFIRM_DELETE_MESSAGE'
                data-track-metadata={JSON.stringify({ messageId: message?.messageId })}
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      </Dialog>

      <Dialog open={isForwardModalOpen} onOpenChange={setIsForwardModalOpen}>
        <ForwardMessageForm
          message={message}
          channelId={channelId}
          onCancel={() => setIsForwardModalOpen(false)}
          onSuccess={() => setIsForwardModalOpen(false)}
        />
      </Dialog>

      <CallParticipantsSelectionModal
        isOpen={showParticipantsModal}
        onClose={() => setShowParticipantsModal(false)}
        channelId={channelId}
        conversationId={messageConversationId}
      />
    </div>
  );
};
