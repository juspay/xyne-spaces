import React, { useState, useRef, useEffect, useId, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useZero } from '../../../hooks/useZero';
import { useSummaryCache } from '../../../hooks/useSummaryQuery';
import { MessageBubble } from '../../ui/MessageBubble/MessageBubble';
import { BotBubble } from '../BotBubble';
import { LinkPreview } from '../LinkPreview/LinkPreview';
import { InternalMessagePreview } from '../LinkPreview/InternalMessagePreview';
import { CanvasPreview } from '../../Canvas/CanvasPreview';
import { TicketActivityMessage } from '../TicketActivityMessage/TicketActivityMessage';
import { ConversationTabContext } from '../ConversationTabContext';

import { hoveredMessage } from './hoveredMessageRef';
import {
  registerMessageHoverActions,
  unregisterMessageHoverActions,
  type MessageHoverToolbarActions,
} from '../HoverActionsToolbar/messageHoverActionsRegistry';
import { useAuthContext } from '../../../providers/AuthProvider';
import { ChatInput } from '../ChatInput';
import { usePin } from '../../../hooks/usePin';
import { useEditContext } from '../../../providers/EditProvider';
import { toast } from 'sonner';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import {
  MessageType,
  BookmarkEntityType,
  ChannelType,
  ChannelScopeType,
  parseForwardedMessageXml,
  parsePreviewMd,
  isDeskChannelType,
} from '@xyne/shared';
import { mutators } from '../../../zero/mutators';
// import { useIntersectionObserver } from '../../../hooks/useIntersectionObserver';
import { convertHtmlToBlocks } from './ChatBubble.utils';
import { sanitizeHtmlString } from '../../../utils/sanitizer';
import { isSlashCommandArtifactMessage } from '../SlashCommandArtifacts';
import { cn } from '../../../utils/classNames';
import { copyHtmlToClipboard, markdownToHtml } from '../../../utils/clipboardUtils';
import { RenderMessageWithHTML } from '../RenderMessageWithHTML/RenderMessageWithHTML';
import { getEmojiFontSizeClass } from '../../../utils/emojiUtils';
import ReplyLayoutV2 from '../ReplyLayout/ReplyLayoutV2';
import { ThreadTags, parseThreadTypes, useSetThreadTypes } from '../../tags/ThreadTags';
import { useShowThreadTags } from '../../../hooks/useShowThreadTags';
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
import { logger, Event } from '../../../utils/logger';
import { MessageActionsDrawer } from '../MessageActionsDrawer/MessageActionsDrawer';
import { useUser } from '../../../hooks/useUsers';
import { fetchFile } from '../../../services/clients/fileFetchService';
import { isImageFile } from '../MessageAttachment/utils';
import { useClipboard } from '../../../hooks/useClipboard';
import {
  ConversationWithTicket,
  MessageWithOptionalNudgeCounts,
} from '../../ui/MessageBubble/MessageBubble.types';
import { useShareableOrigin } from '../../../hooks/useShareableOrigin';
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
import {
  MESSAGE_REMINDER_MENU_OPTIONS,
  REMINDER_TIME_OPTIONS,
  calculateCustomReminderTime,
  calculateReminderTime,
  createReminderMessagePreview,
  formatReminderDueIn,
  getReminderFromMetadata,
  upsertReminderMetadataWithContext,
} from '../utils/bookmarkUtils';
import type { ReminderMenuOption, ReminderTimeOption } from '../utils/bookmarkUtils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/Select';
import { DatePicker } from '../../ui/DatePicker/DatePicker';
import { appsService, type AppShortcutWithApp } from '../../../services/Apps/appsService';
import { ShortcutPickerModal } from '../../Apps/ShortcutPickerModal/ShortcutPickerModal';
import { sendRecordingEvent, useRecordingStore } from '../../../hooks/useRecordingStore';
import { getRecordingDefaultLayout } from '../../../hooks/useRecordingDefaultLayout';
import { parseRecordingShareMessage } from '../../ui/MessageBubble/recordingShareMessage';

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
  isFlowStep?: boolean;
  onEmojiPickerOpenChange?: (isOpen: boolean) => void;
  allThreadAttachments?: AttachmentRef[];
  workflowNumber?: number | undefined;
  disableAskAI?: boolean;
  searchItemView?: boolean;
  onUserClick?: (userId: string) => void;
  isPrevActivity?: boolean;
  isNextActivity?: boolean;
  linkedConversationId?: string | null;
  /** Message ID to highlight when this bubble is rendered in a thread context (e.g. search screen sidebar). */
  highlightMessageId?: string | null;
  afterTextContent?: React.ReactNode;
  isThreadTicketSubTicket?: boolean;
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
  isFlowStep = false,
  onEmojiPickerOpenChange,
  allThreadAttachments,
  workflowNumber,
  disableAskAI = false,
  searchItemView = false,
  onUserClick,
  isPrevActivity = false,
  isNextActivity = false,
  linkedConversationId,
  highlightMessageId,
  afterTextContent,
  isThreadTicketSubTicket = false,
}) => {
  const { user } = useAuthContext();
  const { copyImage } = useClipboard();
  const [isCreateTicketModalOpen, setIsCreateTicketModalOpen] = useState(false);
  const [isSubTicketModalOpen, setIsSubTicketModalOpen] = useState(false);
  const [isActionsDrawerOpen, setIsActionsDrawerOpen] = useState(false);
  const [isReminderOptionsOpen, setIsReminderOptionsOpen] = useState(false);
  const [isCustomReminderModalOpen, setIsCustomReminderModalOpen] = useState(false);
  const [customReminderDate, setCustomReminderDate] = useState<Date | null>(new Date());
  const [customReminderTime, setCustomReminderTime] = useState<ReminderTimeOption>('09:00');
  const [showParticipantsModal, setShowParticipantsModal] = useState(false);
  const zero = useZero();
  const { onMessageChange } = useSummaryCache();
  const { togglePin } = usePin();
  const navigate = useNavigate();
  const shareableOrigin = useShareableOrigin();
  const location = useLocation();
  const { conversationId } = useParams<{ conversationId?: string }>();
  const { editingMessageId, requestEdit, stopEditing } = useEditContext();
  const { setSkipMarkAsRead } = React.useContext(ConversationTabContext);
  const { isMobile } = usePlatform();
  const channel = useChannel(channelId);
  // Get sender info from useUser hook
  const sender = useUser(message.senderId);

  // Message shortcuts are channel-level data. React Query shares this request across every
  // mounted ChatBubble instead of issuing one request per visible message.
  const { data: messageShortcuts = [] } = useQuery({
    queryKey: ['channel-shortcuts', channelId, 'MESSAGE'],
    queryFn: () => appsService.getChannelShortcuts(channelId, { type: 'MESSAGE' }),
  });
  const [shortcutModalOpen, setShortcutModalOpen] = useState(false);

  const messageConversationId = message.conversationId;

  const hasActiveCallForConversation = useMemo(() => {
    return !!conversation?.callId;
  }, [conversation?.callId]);

  const isMessageDeleted = message.isDeleted;

  const [isHighlighted, setIsHighlighted] = useState(false);

  useEffect(() => {
    const highlightedConversationId = linkedConversationId ?? extractOriginFromHash(location.hash);
    const highlightedMessageId = extractMessageIdFromHash(location.hash);

    let shouldHighlight = false;
    if (context === 'thread') {
      if (highlightedMessageId) {
        // Standard URL-hash navigation (e.g. from popup modal)
        shouldHighlight =
          message.conversationId === highlightedConversationId &&
          message.messageId === highlightedMessageId;
      } else if (highlightMessageId) {
        // Prop-only path: search screen sidebar passes the matched message ID explicitly.
        shouldHighlight = message.messageId === highlightMessageId;
      }
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
    linkedConversationId,
    highlightMessageId,
    context,
    message.conversationId,
    message.messageId,
    conversation?.conversationId,
  ]);
  const [showLinkPreview, setShowLinkPreview] = useState(true);
  const [showCanvasPreview, setShowCanvasPreview] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [isForwardModalOpen, setIsForwardModalOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isScrollingRef = useRef(false);
  const pressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const touchEndedInsideRef = useRef(false);

  useEffect(() => {
    setIsEditing(editingMessageId === message.messageId);
  }, [editingMessageId, message.messageId]);

  const { isEntityBookmarked, getBookmarkByEntity } = useUserBookmarks();

  const messageBookmark = getBookmarkByEntity(message.messageId, BookmarkEntityType.MESSAGE);
  const isBookmarked =
    messageBookmark !== undefined ||
    isEntityBookmarked(message.messageId, BookmarkEntityType.MESSAGE);
  const activeReminder = getReminderFromMetadata(messageBookmark?.metadata);
  const isReminderSet = !!activeReminder;
  const reminderDueInLabel = activeReminder?.remindAt
    ? formatReminderDueIn(activeReminder.remindAt)
    : undefined;

  const metadata = message?.metadata as Record<string, unknown> | null;

  // Recording anchors use recording-specific actions.
  const isRecordingMessage = metadata?.['isRecordingMessage'] === true;

  // Both internal and external link previews are stored in link_preview_md.
  // Memoized: ChatBubble re-renders on every hover, and parsing per render
  // made cursor sweeps across messages spike CPU.
  const previewResult = useMemo(
    () => parsePreviewMd(message.link_preview_md),
    [message.link_preview_md],
  );
  const isThreadOpen = conversation?.conversationId === conversationId;

  const isMentionUserAddition = metadata && metadata['messageSubtype'] === 'user_not_in_channel';

  // Check if message has a ticket associated with it
  const hasTicket = metadata && metadata['ticketId'] !== undefined;

  // Ticket backing this thread (for ticket threads)
  const threadTicketId = useMemo(() => {
    if (context !== 'thread' || !isTicketThread || !conversation) return '';
    const initMsg = getInitialMessageFromConversation(conversation) ?? conversation.initialMessage;
    return ((initMsg?.metadata as Record<string, unknown>)?.['ticketId'] as string) || '';
  }, [context, isTicketThread, conversation]);

  const canNestSubTicket = !isThreadTicketSubTicket || isFlowStep;

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
      channelId,
      senderName: sender?.name || 'Unknown',
      previewText,
      ...(message.senderId && { senderId: message.senderId }),
      ...(message.messageId && { messageId: message.messageId }),
      isThreadMessage: context === 'thread',
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
      logger.info(Event.MESSAGE_DELETED, {
        messageId: message.messageId,
        channelId,
        conversationId: message['conversationId'],
      });
      mixpanelService.track(EVENTS.INITIATE_ACTION, {
        type: EVENT_PROPERTIES.ACTION_TYPES.DELETE_MESSAGE,
      });
      toast.success('Message deleted', {
        description: 'Your message has been deleted successfully',
        duration: 3000,
      });
      setShowDeleteConfirm(false);
    } catch (error) {
      logger.error(Event.MESSAGE_DELETE_FAILED, {
        messageId: message.messageId,
        channelId,
        error: error instanceof Error ? error.message : String(error),
      });
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

  // Starts a headless ("take notes") recording anchored to this message's
  // thread — directly via the recording store (no navigation), same as the
  // ThreadPannel "Take notes" button. Only rendered for the thread's root
  // message (see HoverActionsToolbar's messageId === initialMessageId gate).
  const recordingStatus = useRecordingStore(ctx => ctx.status);
  const handleStartRecordingFromMessage = (): void => {
    const targetConversationId = conversation?.conversationId || message.conversationId;
    if (!targetConversationId || !channelId) return;
    if (recordingStatus !== 'idle' && recordingStatus !== 'error') {
      toast.info('A recording is already in progress');
      return;
    }
    sendRecordingEvent({ type: 'clearTranscripts' });
    sendRecordingEvent({
      type: 'startRecording',
      defaultLayout: getRecordingDefaultLayout(),
      conversationId: targetConversationId,
      channelId,
    });
    toast.success('Recording started', {
      description: 'Taking notes in the background \u2014 open Recordings anytime to view it live.',
    });
  };

  const handleAddBookmark = (): void => {
    try {
      const addResult = zero.mutate(
        mutators.bookmark.add({
          entityId: message.messageId,
          entityType: BookmarkEntityType.MESSAGE,
          bookmarkId: uuidv4(),
          metadata: null,
          timestamp: Date.now(),
        }),
      );

      // Keep "Add bookmark" bookmark-only by force-clearing reminder metadata
      // after add/restore (handles stale runtimes and racey restore flows).
      void addResult.server
        .then(() => {
          void zero.mutate(
            mutators.bookmark.updateMetadata({
              entityId: message.messageId,
              entityType: BookmarkEntityType.MESSAGE,
              metadata: null,
              timestamp: Date.now(),
            }),
          );
        })
        .catch(() => undefined);

      mixpanelService.track(EVENTS.INITIATE_ACTION, {
        type: 'addBookmark',
      });
    } catch {
      toast.error('Action failed', {
        description: 'Could not add bookmark',
        duration: 3000,
      });
    }
  };

  const handleToggleBookmark = (): void => {
    if (isBookmarked) {
      try {
        void zero.mutate(
          mutators.bookmark.remove({
            entityId: message.messageId,
            entityType: BookmarkEntityType.MESSAGE,
            timestamp: Date.now(),
            markAsDone: false,
          }),
        );
        mixpanelService.track(EVENTS.INITIATE_ACTION, {
          type: 'removeBookmark',
        });
      } catch {
        toast.error('Action failed', {
          description: 'Could not remove bookmark',
          duration: 3000,
        });
      }
      return;
    }

    handleAddBookmark();
  };

  const applyReminderAt = (remindAt: Date): void => {
    const remindAtISO = remindAt.toISOString();
    const existingBookmark = getBookmarkByEntity(message.messageId, BookmarkEntityType.MESSAGE);
    const reminderMetadata = upsertReminderMetadataWithContext(
      existingBookmark?.metadata,
      remindAtISO,
      {
        messagePreview: createReminderMessagePreview(message.content),
        conversationId: message.conversationId,
        initialMessageId: conversation?.initialMessageId,
        ...(channel?.id && { channelId: channel.id }),
        ...(channel?.name && { channelName: channel.name }),
        ...(channel?.scopeType && { channelScopeType: String(channel.scopeType) }),
        ...(sender?.name && { senderName: sender.name }),
      },
    );

    if (existingBookmark) {
      void zero.mutate(
        mutators.bookmark.updateMetadata({
          entityId: message.messageId,
          entityType: BookmarkEntityType.MESSAGE,
          metadata: reminderMetadata,
          timestamp: Date.now(),
        }),
      );
      return;
    }

    const addResult = zero.mutate(
      mutators.bookmark.add({
        entityId: message.messageId,
        entityType: BookmarkEntityType.MESSAGE,
        bookmarkId: uuidv4(),
        metadata: reminderMetadata,
        timestamp: Date.now(),
      }),
    );

    // Keep reminder metadata consistent when bookmark creation and reminder updates happen quickly.
    void addResult.server
      .then(() => {
        void zero.mutate(
          mutators.bookmark.updateMetadata({
            entityId: message.messageId,
            entityType: BookmarkEntityType.MESSAGE,
            metadata: reminderMetadata,
            timestamp: Date.now(),
          }),
        );
      })
      .catch(() => undefined);
  };

  const ensureMessageBookmarked = (): void => {
    const existingBookmark = getBookmarkByEntity(message.messageId, BookmarkEntityType.MESSAGE);
    if (existingBookmark) {
      return;
    }

    handleAddBookmark();
  };

  const handleOpenReminderOptions = (): void => {
    ensureMessageBookmarked();
    setIsReminderOptionsOpen(true);
  };

  const handleReminderPresetSelect = (option: ReminderMenuOption, e?: React.MouseEvent): void => {
    e?.stopPropagation();

    if (option === 'custom') {
      setIsReminderOptionsOpen(false);
      setIsCustomReminderModalOpen(true);
      return;
    }

    const remindAt = calculateReminderTime(option);
    if (!remindAt) return;

    applyReminderAt(remindAt);
    setIsReminderOptionsOpen(false);
  };

  const handleSaveCustomReminder = (): void => {
    if (!customReminderDate) {
      return;
    }

    const remindAt = calculateCustomReminderTime(customReminderDate, customReminderTime);
    if (remindAt.getTime() <= Date.now()) {
      toast.error('Please choose a future time for reminder');
      return;
    }
    applyReminderAt(remindAt);
    setIsCustomReminderModalOpen(false);
  };

  const customReminderDatePickerId = `message-reminder-date-${message.messageId}`;
  const customReminderTimeSelectId = `message-reminder-time-${message.messageId}`;

  const onCopyLink = (): void => {
    // Get conversation ID from conversation object or fallback to message
    const conversationId = conversation?.conversationId || message.conversationId;
    let messageLink = '';
    if (conversationId) {
      if (context === 'thread') {
        // Thread message: include full path with conversation + messageId in hash
        messageLink = `${shareableOrigin}/chat/dir/${channelId}/${conversationId}#origin=${conversationId}&messageId=${message.messageId}`;
      } else {
        // Channel message: only channel in path, conversation in hash
        messageLink = `${shareableOrigin}/chat/dir/${channelId}#origin=${conversationId}`;
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
              logger.warn(Event.FRONTEND_ERROR, {
                type: 'migrated_console_warn',
                message: String('Markdown processing failed, falling back to raw content:'),
                context: [error],
              });
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
    try {
      if (context === 'thread') {
        // Prevent thread panel from marking as read on unmount
        setSkipMarkAsRead(true);
        void zero.mutate(
          mutators.conversation.markThreadUnreadFrom({
            conversationId: message.conversationId,
            messageId: message.messageId,
            participantId: crypto.randomUUID(),
            timestamp: Date.now(),
          }),
        );
      } else {
        // Prevent parent component from marking as read on unmount
        setSkipMarkAsRead(true);
        void zero.mutate(
          mutators.channel.markChannelUnreadFrom({
            channelId,
            messageId: message.messageId,
            conversationId: message.conversationId,
            timestamp: Date.now(),
          }),
        );
      }
      toast.success('Marked as unread');
    } catch (error) {
      logger.error(Event.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('Failed to mark as unread:'),
        error: error,
      });
      toast.error('Failed to mark as unread. Please try again.');
      setSkipMarkAsRead(false);
    }
  };

  const finishEditing = (): void => {
    setIsEditing(false);
    stopEditing(); // release global lock
  };

  // Image attachments for "Copy Image" action
  const imageAttachments = useMemo(
    () => (message.attachments ?? []).filter(att => isImageFile(att.mimetype)),
    [message.attachments],
  );

  const handleCopyImage = (): void => {
    const attachment = imageAttachments[0];
    if (!attachment) return;
    fetchFile(attachment.id, attachment.originalFilename, attachment.mimetype)
      .then(file => copyImage(file))
      .catch(() => {
        toast.error('Failed to copy image');
      });
  };

  const canModifyMessage = user?.id ? isMessageEditable(message, user.id) : false;
  // The slash command artifact wrapper is the persisted rendering contract. Keep deletion available,
  // but do not open this message in the generic editor, which would discard that wrapper.
  const canEditMessage =
    canModifyMessage && !isSlashCommandArtifactMessage(message.content) && !isRecordingMessage;
  const canDeleteMessage = canModifyMessage && !hasTicket && !isRecordingMessage;

  // Check if message has meaningful text content (not just attachments).
  // Memoized: this runs a full DOMParser parse — doing it per render meant
  // every hover re-render re-parsed the message (audit finding #7).
  const hasTextContent = useMemo(() => {
    if (!message?.content) return false;

    // Parse HTML and get text content
    const parser = new DOMParser();
    const doc = parser.parseFromString(message.content, 'text/html');
    const textContent = (doc.body.textContent || '').trim();

    const hasEmoji = doc.querySelectorAll('img[data-emoji="true"]').length > 0;

    // Consider it text content only if there's actual text
    return textContent.length > 0 || hasEmoji;
  }, [message?.content]);

  // Only show copy button if there's text content to copy
  const shouldShowCopyButton = hasTextContent;

  const isCurrentEditing = editingMessageId === message.messageId;

  // Check for canvas link
  const msgContent = message?.content as string | undefined;
  const canvasIdMatch = msgContent?.match(/\/chat\/canvas\/([a-zA-Z0-9-]+)/);
  const canvasId = canvasIdMatch ? canvasIdMatch[1] : null;
  const recordingShare = useMemo(() => {
    if (!msgContent) return null;
    const recordingContent =
      message.msgType === MessageType.FORWARDED
        ? parseForwardedMessageXml(msgContent)?.content
        : msgContent;
    return recordingContent ? parseRecordingShareMessage(recordingContent) : null;
  }, [message.msgType, msgContent]);
  const shouldShowStandaloneLinkPreview =
    variant !== 'pinned' &&
    showLinkPreview &&
    !!previewResult &&
    !canvasId &&
    !recordingShare &&
    !(isMobile && message.senderId === user?.id) &&
    !isMessageDeleted;

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
    !isSystemMessage &&
    !isMessageDeleted &&
    !isTicketCreationMessage &&
    !isDeskChannelType(channel?.type) &&
    channel?.type !== ChannelType.SUPPORT &&
    (context === 'channel' || context === 'thread');

  const shouldEnableMobileThreadOpen =
    isMobile &&
    (!isSystemMessage || isTicketCreationMessage || isCallMessage) &&
    !isShowInChannel &&
    (!isMessageDeleted || context === 'channel') &&
    !!replies?.onOpenThread;

  // Keyboard shortcuts for message actions are NOT registered here — they are
  // registered once per list by MessageHoverToolbar (useMessageHoverShortcuts)
  // and resolve this bubble's handlers via the hover-actions registry below.
  const handleCopyContent = (): void => {
    if (message?.content) {
      copyHtmlToClipboard(message.content)
        .then(() => {
          toast.success('Message content copied to clipboard');
        })
        .catch(() => {
          toast.error('Could not copy content to clipboard');
        });
    }
  };

  // ===== Shared hover-toolbar registration (Slack-style overlay) =====
  // The toolbar itself is mounted ONCE per list (MessageHoverToolbar). Each
  // bubble only keeps its current per-message capabilities/handlers registered
  // (keyed by a per-instance id stamped on the root node as data-hover-key) so
  // the overlay can derive them at show time. Hover never sets state here.

  const hoverToolbarKey = useId();
  const appliedThreadTypes = useMemo(
    () => parseThreadTypes(conversation?.threadType),
    [conversation?.threadType],
  );
  const setThreadTypes = useSetThreadTypes(conversation?.conversationId);
  const { showThreadTags } = useShowThreadTags();

  const canShowHoverToolbar =
    !isMobile &&
    !searchItemView &&
    variant !== 'pinned' &&
    !isMentionUserAddition &&
    !isTicketActivity &&
    !(isEditing && isCurrentEditing);

  // No dependency array on purpose: re-registering is a cheap Map.set and this
  // keeps the registered handlers/capabilities in sync with the latest render.
  useEffect(() => {
    if (!canShowHoverToolbar) {
      unregisterMessageHoverActions(hoverToolbarKey);
      return;
    }

    const actions: MessageHoverToolbarActions = {
      showEditAction: canEditMessage,
      // Capability flags + content-copy handler for the centralized hover
      // keyboard shortcuts (mirror the old per-bubble `enabled:` expressions).
      canEditMessage,
      isMessageDeleted,
      onCopyContent: handleCopyContent,
      messageId: message.messageId,
      conversationId: conversation?.conversationId || message.conversationId,
      ...(conversation && { conversation }),
      ...(conversation?.initialMessageId && {
        initialMessageId: conversation.initialMessageId,
      }),
      reactionsMd: message.reactions_md,
      onCopyLink,
      // Channel rows only: inside a thread the panel header already carries this, and the
      // tag is the thread's — one entry point per thread, not one per reply.
      ...(showThreadTags &&
        context === 'channel' &&
        !isSystemMessage &&
        !isMessageDeleted &&
        conversation?.conversationId && {
          threadTags: {
            applied: appliedThreadTypes,
            onToggle: (name: string) => {
              void setThreadTypes(
                appliedThreadTypes.includes(name)
                  ? appliedThreadTypes.filter(value => value !== name)
                  : [...appliedThreadTypes, name],
              );
            },
          },
        }),
      ...(!isMessageDeleted && shouldShowCopyButton && { onCopyMessage: handleCopyMessage }),
      ...(!isMessageDeleted && { onEmojiPickerOpenChange: setIsEmojiPickerOpen }),
      isChannelArchived: channel?.isArchived ?? false,
      // The thread parent sits flush under the thread header, so the default
      // lift above the row would render the toolbar on top of it.
      placement: context === 'thread' && isFirstInThread ? 'below' : 'above',
      ...(context === 'channel' &&
        !isSystemMessage &&
        !isMessageDeleted &&
        !hasTicket &&
        channelScopeType === ChannelScopeType.DEFAULT && {
          onCreateTicket: handleCreateTicket,
        }),
      ...(context === 'thread' &&
        !isMessageDeleted &&
        isTicketThread &&
        canNestSubTicket &&
        !isFirstInThread && {
          onCreateSubTicket: handleCreateSubTicket,
        }),
      ...((!isSystemMessage || isTicketCreationMessage) &&
        !isMessageDeleted && {
          onBookmark: handleToggleBookmark,
          isBookmarked,
        }),
      ...((!isSystemMessage || isTicketCreationMessage) &&
        !isMessageDeleted && {
          onRemindMeOption: handleReminderPresetSelect,
        }),
      ...(!isMessageDeleted &&
        (isCallMessage || !isSystemMessage) &&
        !isRecordingMessage && { onForwardMessage: handleForwardMessage }),
      isPinned: conversation?.pinned || false,
      ...(shouldShowSendToChannel && !isMessageDeleted && { onSendToChannel: handleSendToChannel }),
      ...(canEditMessage && { onEditMessage: handleEditMessage }),
      ...(canDeleteMessage && { onDeleteMessage: handleDeleteMessage }),
      ...(replies?.onOpenThread &&
        (!isSystemMessage || isTicketCreationMessage || isCallMessage) &&
        !isShowInChannel &&
        (!isMessageDeleted || context === 'channel') && {
          onReplyInThread: replies.onOpenThread,
        }),
      ...(!isSystemMessage &&
        !isMessageDeleted && {
          onInitiateCall: handleInitiateCall,
          isCallDisabled: hasActiveCallForConversation,
          onStartRecording: handleStartRecordingFromMessage,
          isRecordingDisabled: recordingStatus !== 'idle' && recordingStatus !== 'error',
        }),
      ...(conversation &&
        (!isSystemMessage || isTicketCreationMessage) &&
        !isMessageDeleted &&
        (context === 'channel' || (context === 'thread' && isFirstInThread)) && {
          onPinMessage: handlePinMessage,
        }),
      ...(!disableAskAI &&
        ((conversation && (context === 'channel' || isFirstInThread)) || isCallMessage) &&
        (!isSystemMessage || isCallMessage) &&
        !isMessageDeleted && { onAskAI: handleAskAI }),
      ...(shouldShowMarkAsUnread ? { onMarkAsUnread: handleMarkAsUnread } : {}),
      ...(messageShortcuts.length > 0 &&
        !isSystemMessage &&
        !isMessageDeleted && {
          messageShortcuts,
          onRunShortcut: (shortcut: AppShortcutWithApp) => {
            const plainText =
              new DOMParser().parseFromString(message.content ?? '', 'text/html').body
                .textContent ?? '';
            void appsService
              .executeShortcutAction(
                channelId,
                shortcut.commandName,
                conversation?.conversationId ?? null,
                plainText,
                message.messageId,
              )
              .catch(() => undefined);
          },
          onShowAllShortcuts: () => setShortcutModalOpen(true),
        }),
    };

    registerMessageHoverActions(hoverToolbarKey, actions);
  });

  useEffect(() => {
    return () => unregisterMessageHoverActions(hoverToolbarKey);
  }, [hoverToolbarKey]);

  if (!message) return <></>;

  const handleMobileBubbleThreadOpen = (e?: React.MouseEvent<HTMLDivElement>): void => {
    if (!shouldEnableMobileThreadOpen || !replies?.onOpenThread) return;

    // Guard against synthetic click after cancelled touch interactions.
    if (!touchEndedInsideRef.current) return;
    touchEndedInsideRef.current = false;

    if (e?.target instanceof HTMLElement) {
      // Do not open thread when tapping interactive controls inside the bubble.
      const interactiveTarget = e.target.closest(
        'a, button, input, textarea, [role="button"], [data-prevent-thread]',
      );
      if (interactiveTarget && interactiveTarget !== e.currentTarget) {
        return;
      }
    }

    replies.onOpenThread(e);
  };

  // Render ticket activity message with special styling
  if (isTicketActivity) {
    return (
      <TicketActivityMessage
        message={message}
        isPrevActivity={isPrevActivity}
        isNextActivity={isNextActivity}
      />
    );
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
      data-message-id={message.messageId}
      data-hover-key={hoverToolbarKey}
      className={cn(
        isMobile && 'no-select-mobile',
        'group/bubble relative transition-all duration-200 ease-in-out',
        // Row highlight driven by the shared MessageHoverToolbar, which stamps
        // `data-hovered` on the [data-message-id] root. Applied at the root so
        // every sub-layout (message, link/canvas previews, reply layout) is
        // covered uniformly and stays in sync with the toolbar.
        'data-[hovered]:bg-muted/50',
      )}
      style={
        isMobile
          ? {
              touchAction: 'pan-y',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
            }
          : { touchAction: 'pan-y' }
      }
      onContextMenu={e => {
        if (!isMobile) return;

        e.preventDefault();
        e.stopPropagation();

        if (pressTimerRef.current) {
          clearTimeout(pressTimerRef.current);
          pressTimerRef.current = null;
        }

        handleActionsDrawerOpenChange(true);
      }}
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
        if (isMobile) {
          touchEndedInsideRef.current = true;
        }
        if (pressTimerRef.current) {
          clearTimeout(pressTimerRef.current);
          pressTimerRef.current = null;
        }
      }}
      onTouchCancel={() => {
        // Cancelled touch (scroll/swipe) — reset so onClick won't open the thread
        touchEndedInsideRef.current = false;
        if (pressTimerRef.current) {
          clearTimeout(pressTimerRef.current);
          pressTimerRef.current = null;
        }
      }}
      onMouseEnter={() => {
        // Ref write only — no setState. Keeps the shortcut `when` predicates
        // working in containers that do not mount the shared overlay.
        if (!isMobile) {
          hoveredMessage.current = {
            messageId: message.messageId,
            conversationId: conversation?.conversationId || message.conversationId,
          };
        }
      }}
      onMouseLeave={() => {
        if (hoveredMessage.current?.messageId === message.messageId) {
          hoveredMessage.current = null;
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
            message={message}
            showAvatar={showAvatar}
            isPinned={conversation?.pinned || false}
            isBookmarked={isBookmarked}
            isReminderSet={isReminderSet}
            reminderDueInLabel={reminderDueInLabel}
            variant={variant}
            isHighlighted={isHighlighted}
            channelId={channelId}
            context={context}
            channelScopeType={channelScopeType}
            isFirstInThread={isFirstInThread}
            showLinkPreview={false}
            searchItemView={searchItemView}
            {...(onUserClick && { onUserClick })}
            {...(allThreadAttachments && { allThreadAttachments })}
            workflowNumber={workflowNumber}
            {...(afterTextContent !== undefined && { afterTextContent })}
            {...(context === 'channel' &&
              !isSystemMessage &&
              !isMessageDeleted && {
                headerContent: (
                  <ThreadTags
                    conversationId={conversation?.conversationId}
                    threadType={conversation?.threadType}
                    canEdit
                  />
                ),
              })}
            {...(conversation && { conversation: conversation })}
            {...(shouldEnableMobileThreadOpen && {
              onClick: handleMobileBubbleThreadOpen,
            })}
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

          {/* Desktop hover actions are rendered by the shared MessageHoverToolbar
              overlay mounted at the list-container level (see
              messageHoverActionsRegistry registration above). Message shortcuts
              are surfaced through that same registration. */}
          {/* Message Shortcut Picker Modal */}
          {shortcutModalOpen && messageShortcuts.length > 0 && (
            <ShortcutPickerModal
              open={shortcutModalOpen}
              onClose={() => setShortcutModalOpen(false)}
              channelId={channelId}
              conversationId={conversation?.conversationId ?? null}
              message={
                !isSystemMessage
                  ? {
                      text:
                        new DOMParser().parseFromString(message.content ?? '', 'text/html').body
                          .textContent ?? '',
                      senderName: sender?.name ?? '',
                      messageId: message.messageId,
                    }
                  : undefined
              }
              shortcuts={messageShortcuts}
            />
          )}
          {/* Mobile Actions Drawer */}
          {isMobile && !searchItemView && isActionsDrawerOpen && (
            <MessageActionsDrawer
              open
              onOpenChange={handleActionsDrawerOpenChange}
              messageId={message.messageId}
              conversationId={conversation?.conversationId || message.conversationId}
              {...(conversation?.initialMessageId && {
                initialMessageId: conversation.initialMessageId,
              })}
              {...(conversation && { conversation })}
              reactionsMd={message.reactions_md}
              showEditAction={canEditMessage}
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
                !isMessageDeleted && {
                  onBookmark: handleToggleBookmark,
                  isBookmarked,
                })}
              {...((!isSystemMessage || isTicketCreationMessage) &&
                !isMessageDeleted && { onRemindMe: handleOpenReminderOptions })}
              {...(!isMessageDeleted &&
                (isCallMessage || !isSystemMessage) &&
                !isRecordingMessage && { onForwardMessage: handleForwardMessage })}
              {...(shouldShowSendToChannel &&
                !isMessageDeleted && { onSendToChannel: handleSendToChannel })}
              {...(canEditMessage && { onEditMessage: handleEditMessage })}
              {...(canDeleteMessage && { onDeleteMessage: handleDeleteMessage })}
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
                  onStartRecording: handleStartRecordingFromMessage,
                  isRecordingDisabled: recordingStatus !== 'idle' && recordingStatus !== 'error',
                })}
              {...(conversation &&
                (!isSystemMessage || isTicketCreationMessage) &&
                !isMessageDeleted &&
                (context === 'channel' || (context === 'thread' && isFirstInThread)) && {
                  onPinMessage: handlePinMessage,
                })}
              {...(!disableAskAI &&
                ((conversation && (context === 'channel' || isFirstInThread)) || isCallMessage) &&
                (!isSystemMessage || isCallMessage) &&
                !isMessageDeleted && { onAskAI: handleAskAI })}
              {...(shouldShowMarkAsUnread ? { onMarkAsUnread: handleMarkAsUnread } : {})}
              isChannelArchived={channel?.isArchived ?? false}
              {...(imageAttachments.length > 0 &&
                !isMessageDeleted && { onCopyImage: handleCopyImage })}
            />
          )}
        </>
      )}

      {shouldShowStandaloneLinkPreview && (
        <div
          className={cn(
            'pr-3 max-w-full pl-4 ml-14 transition-colors rounded-r border-l-4 border-l-gray-300 dark:border-l-gray-600',
            message.senderId === user?.id && 'max-[500px]:mb-5',
            'group-data-[hovered]/bubble:bg-accent/50',
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
        <div
          className={cn(
            'pr-3 max-w-full pl-4 ml-14 transition-colors rounded-r border-l-4 border-l-gray-300 dark:border-l-gray-600',
            message.senderId === user?.id && 'max-[500px]:mb-5',
            'group-data-[hovered]/bubble:bg-accent/50',
          )}
        >
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
      {conversation &&
        context === 'thread' &&
        isTicketThread &&
        canNestSubTicket &&
        isSubTicketModalOpen && (
          <SubTicketModal
            isOpen
            onClose={() => setIsSubTicketModalOpen(false)}
            ticketId={threadTicketId}
            conversationId={conversation.conversationId}
          />
        )}

      {isReminderOptionsOpen && (
        <Dialog
          open={isReminderOptionsOpen}
          onOpenChange={setIsReminderOptionsOpen}
          title='Remind me'
          description='Choose when to be reminded about this message'
        >
          <div className='p-6 space-y-2'>
            <h2 className='text-lg font-semibold text-foreground mb-3'>Remind me</h2>
            {MESSAGE_REMINDER_MENU_OPTIONS.map(option => (
              <Button
                key={option.option}
                variant='ghost'
                className='w-full justify-start'
                onClick={e => handleReminderPresetSelect(option.option, e)}
                data-track-category='CHAT_BUBBLE'
                data-track-name='SELECT_REMINDER_PRESET'
              >
                {option.label}
              </Button>
            ))}
          </div>
        </Dialog>
      )}

      {isCustomReminderModalOpen && (
        <Dialog
          open={isCustomReminderModalOpen}
          onOpenChange={setIsCustomReminderModalOpen}
          title='Reminder'
          description='Set a reminder for this message'
        >
          <div className='p-6 space-y-4'>
            <div className='flex items-center justify-between'>
              <h3 className='text-lg font-semibold text-foreground'>Reminder</h3>
              <button
                type='button'
                className='rounded-sm opacity-70 transition-opacity hover:opacity-100'
                onClick={() => setIsCustomReminderModalOpen(false)}
                data-track-category='CHAT_BUBBLE'
                data-track-name='Close_Custom_Reminder_Modal'
                data-track-metadata={JSON.stringify({ messageId: message.messageId })}
              >
                <X className='h-4 w-4' />
                <span className='sr-only'>Close</span>
              </button>
            </div>
            <div className='space-y-2'>
              <label
                htmlFor={customReminderDatePickerId}
                className='text-sm font-medium text-foreground'
              >
                When
              </label>
              <DatePicker
                id={customReminderDatePickerId}
                selectedDate={customReminderDate}
                onSelect={setCustomReminderDate}
                placeholder='Select date'
                minDate={new Date(new Date().setHours(0, 0, 0, 0))}
                inputClassName='w-full !h-9'
                showClearButton={false}
              />
            </div>

            <div className='space-y-2'>
              <label
                htmlFor={customReminderTimeSelectId}
                className='text-sm font-medium text-foreground'
              >
                Time
              </label>
              <Select
                value={customReminderTime}
                onValueChange={value => setCustomReminderTime(value)}
              >
                <SelectTrigger id={customReminderTimeSelectId} className='w-full'>
                  <SelectValue placeholder='Select time' />
                </SelectTrigger>
                <SelectContent showScrollButtons={false}>
                  {REMINDER_TIME_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className='flex justify-end gap-2 pt-2'>
              <Button
                variant='outline'
                onClick={() => setIsCustomReminderModalOpen(false)}
                data-track-category='CHAT_BUBBLE'
                data-track-name='CANCEL_CUSTOM_REMINDER'
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveCustomReminder}
                data-track-category='CHAT_BUBBLE'
                data-track-name='SAVE_CUSTOM_REMINDER'
                disabled={!customReminderDate}
              >
                Save
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {showDeleteConfirm && (
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
                className='rounded-sm text-foreground opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:ring-offset-2 disabled:pointer-events-none'
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
                  data-testid='confirm-delete-message'
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
      )}

      {isForwardModalOpen && (
        <Dialog
          open={isForwardModalOpen}
          onOpenChange={setIsForwardModalOpen}
          onOpenAutoFocus={event => event.preventDefault()}
        >
          <ForwardMessageForm
            message={message}
            channelId={channelId}
            onCancel={() => setIsForwardModalOpen(false)}
            onSuccess={() => setIsForwardModalOpen(false)}
          />
        </Dialog>
      )}

      {showParticipantsModal && (
        <CallParticipantsSelectionModal
          isOpen
          onClose={() => setShowParticipantsModal(false)}
          channelId={channelId}
          conversationId={messageConversationId}
        />
      )}
    </div>
  );
};
