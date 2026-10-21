import {
  Bookmark,
  BookmarkMinus,
  Copy,
  CornerUpLeft,
  Edit,
  AlarmClock,
  Headphones,
  Link as LinkIcon,
  MessageCircleMore,
  Pin,
  PinOff,
  RotateCcw,
  Trash2,
} from 'lucide-react-native';
import { getStatus, removePending, usePendingByMessageId } from '@xyne/shared/messages';
import { useCallback, useMemo, type ReactNode } from 'react';
import { Alert, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import { useRouter } from 'expo-router';
import { v4 as uuidv4 } from 'uuid';
import * as Clipboard from 'expo-clipboard';
import {
  BookmarkEntityType,
  MessageType,
  isForwardedMessageXml,
  parseForwardedMessageXml,
} from '@xyne/shared';

import { haptics } from '@/src/utils/haptics';
import { useZero } from '@/src/hooks/useZero';
import { useUserBookmarks } from '@/src/hooks/useUserBookmarks';
import { mutators } from '@/src/zero/mutators';
import { buildWebMessageLink } from '@/src/utils/messageDeepLink';
import { getActiveWorkspaceId } from '@/src/utils/activeWorkspace';
import { normalizeWorkspaceIdForLink } from '@/src/utils/deepLinkWorkspace';
import { logger as appLogger } from '@/src/observability/logging/appLogger';
import { startAudioCall } from '@/src/utils/startAudioCall';
import { composerHtmlHasSendableBody } from '@/src/utils/customEmoji';
import { composerHtmlToPlainText } from '@/src/components/input-composer/utils/conversation-input.utils';
import { retryPendingMessageFromV2 } from '@/src/features/chat/v2/pendingRetryTelemetry';
import { setRichMessageClipboard } from '@/src/utils/richMessageClipboard';
import {
  copyImageAttachmentToClipboard,
  getFirstImageAttachment,
} from '@/src/utils/copyImageAttachment';
import { TurnUpRightIcon } from '@/src/components/icons';
import type { ChatInputEditingMessage } from '@/src/components/input-composer/input-composer.types';

import type { MessageAction, MessageActionsTarget } from './message-actions-target';
import { decodeBasicEntitiesExact, HTML_TAG_OR_EMPTY, stripHtmlTags } from '@/src/utils/htmlText';

const EMOJI_IMG_RE = /<img[^>]*data-emoji="true"[^>]*>/i;
const DESTRUCTIVE_COLOR = '#dc2626';

const channelHtmlToPlainText = (html: string): string => {
  let s = html.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|h[1-6]|li)>/gi, '\n');
  s = s.replace(/<img[^>]*data-emoji="true"[^>]*alt="([^"]*)"[^>]*>/gi, '$1');
  s = stripHtmlTags(s, HTML_TAG_OR_EMPTY);
  s = decodeBasicEntitiesExact(s);
  return s.trim();
};

const channelHasTextContent = (content: string): boolean => {
  const stripped = stripHtmlTags(content, HTML_TAG_OR_EMPTY).trim();
  if (stripped.length > 0) return true;
  return EMOJI_IMG_RE.test(content);
};

export type UseMessageActionsArgs = {
  target: MessageActionsTarget | null;
  currentUserId?: string | undefined;
  context: 'channel' | 'thread';
  closeActionSheet: (afterDismiss?: () => void) => void;
  openForward: () => void;
  openReminderOptions?: ((target: MessageActionsTarget) => void) | undefined;
  repliesEnabled?: boolean | undefined;
  onEditInChat?: ((payload: ChatInputEditingMessage) => void) | undefined;
  onBeforeMarkUnread?: (() => void) | undefined;
  onMarkUnreadFailure?: (() => void) | undefined;
};

export const useMessageActions = ({
  target,
  currentUserId,
  context,
  closeActionSheet,
  openForward,
  openReminderOptions,
  repliesEnabled = true,
  onEditInChat,
  onBeforeMarkUnread,
  onMarkUnreadFailure,
}: UseMessageActionsArgs): MessageAction[] => {
  const foreground = useCSSVariable('--color-foreground') as string;
  const zero = useZero();
  const router = useRouter();
  const { isEntityBookmarked } = useUserBookmarks({ enabled: Boolean(target) });

  const message = target?.message ?? null;
  const messageId = message?.messageId;
  const isBookmarked = Boolean(
    messageId && isEntityBookmarked(messageId, BookmarkEntityType.MESSAGE),
  );

  const pending = usePendingByMessageId(messageId ?? '');
  const handlePendingRetry = useCallback(() => {
    if (!pending) return;
    retryPendingMessageFromV2(zero, pending, 'message_actions');
    closeActionSheet();
  }, [closeActionSheet, pending, zero]);
  const handlePendingDelete = useCallback(() => {
    if (!pending) return;
    removePending(pending.messageId);
    closeActionSheet();
  }, [closeActionSheet, pending]);
  const canDeletePending = pending ? !pending.mutatorFired || pending.mutatorAppError : false;

  const flags = useMemo(() => {
    if (!message) return null;
    const metadata = (message.metadata ?? null) as Record<string, unknown> | null;
    const isTicketActivity =
      message.msgType === MessageType.SYSTEM && metadata?.['isTicketActivity'] === true;
    const isTicketCreationMessage =
      message.msgType === MessageType.SYSTEM &&
      metadata?.['ticketId'] !== undefined &&
      !isTicketActivity;
    const isSystemMessage =
      message.msgType === MessageType.SYSTEM && !isTicketActivity && !isTicketCreationMessage;
    const isCallMessage = isSystemMessage && metadata?.['isCallMessage'] === true;
    const isShowInChannel = message.showInChannel === true;
    const isMessageDeleted = !!message.isDeleted;
    const isOwnMessage = !!currentUserId && message.senderId === currentUserId;
    const canEditMessage =
      isOwnMessage && message.msgType !== MessageType.SYSTEM && !isMessageDeleted;
    const hasImages = getFirstImageAttachment(message.attachments) !== null;
    const hasTextContent =
      context === 'channel'
        ? message.content
          ? channelHasTextContent(message.content)
          : false
        : !!message.content && composerHtmlHasSendableBody(message.content);

    return {
      isMessageDeleted,
      isSystemMessage,
      isTicketCreationMessage,
      isCallMessage,
      isShowInChannel,
      isOwnMessage,
      canEditMessage,
      hasImages,
      hasTextContent,
    };
  }, [context, currentUserId, message]);

  const visibility = useMemo(() => {
    const isThread = context === 'thread';
    const isChannelArchived = !!target?.isChannelArchived;
    const isFirstInThread = !!target?.isFirstInThread;
    const hasTicket = !!target?.hasTicket;

    if (!flags) {
      return {
        replyInThread: false,
        sendToChannel: false,
        editInChat: false,
        copyMessage: false,
        copyImage: false,
        copyLink: false,
        forwardMessage: false,
        pin: false,
        bookmark: false,
        reminder: false,
        markAsUnread: false,
        startCall: false,
        delete: false,
      };
    }

    const {
      isMessageDeleted,
      isSystemMessage,
      isTicketCreationMessage,
      isCallMessage,
      isShowInChannel,
      isOwnMessage,
      canEditMessage,
      hasImages,
      hasTextContent,
    } = flags;

    return {
      replyInThread:
        !isThread &&
        repliesEnabled &&
        (!isSystemMessage || isTicketCreationMessage || isCallMessage) &&
        !isShowInChannel,
      sendToChannel:
        isThread && !isShowInChannel && !isFirstInThread && isOwnMessage && !isMessageDeleted,
      editInChat: canEditMessage && !isChannelArchived && !!onEditInChat,
      copyMessage: !isMessageDeleted && hasTextContent,
      copyImage: !isMessageDeleted && hasImages,
      copyLink: isThread ? true : !isMessageDeleted,
      forwardMessage: !isMessageDeleted && !isSystemMessage,
      pin:
        (!isSystemMessage || isTicketCreationMessage) &&
        !isMessageDeleted &&
        // Thread messages do not include the conversation's pinned state. Do not
        // render a control whose label and result cannot be kept accurate.
        !isThread,
      bookmark: (!isSystemMessage || isTicketCreationMessage) && !isMessageDeleted,
      reminder: !isMessageDeleted,
      markAsUnread: !isSystemMessage && !isMessageDeleted && !isTicketCreationMessage,
      startCall: isThread && !isSystemMessage && !isMessageDeleted,
      delete: canEditMessage && !hasTicket,
    };
  }, [context, flags, onEditInChat, repliesEnabled, target]);

  const handleReplyInThread = useCallback(() => {
    if (!target) return;
    const { channelId, conversationId } = target;
    closeActionSheet(() => {
      router.push({
        pathname: '/chat/[channelId]/[threadId]',
        params: {
          channelId,
          threadId: conversationId,
          from: 'channel_thread',
          openStartedAtMs: String(Date.now()),
        },
      });
    });
  }, [closeActionSheet, router, target]);

  const handleSendToChannel = useCallback(() => {
    if (!messageId) return;
    closeActionSheet(() => {
      try {
        void zero.mutate(
          mutators.messages.updateShowInChannel({
            messageId,
            showInChannel: true,
            childConversationId: uuidv4(),
            timestamp: Date.now(),
          }),
        );
      } catch {
        Alert.alert('Failed to send to channel', 'Please try again.');
      }
    });
  }, [closeActionSheet, messageId, zero]);

  const handleStartCall = useCallback(() => {
    if (!target) return;
    const { channelId } = target;
    closeActionSheet(() => {
      void startAudioCall(channelId);
    });
  }, [closeActionSheet, target]);

  const handleEditInChat = useCallback(() => {
    if (!message || !target) return;
    const rawContent = message.content ?? '';
    // Editing a forwarded message edits only its optional text — the
    // conversations.update mutator re-wraps it into the ForwardedMessage XML.
    const isForwarded =
      message.msgType === MessageType.FORWARDED || isForwardedMessageXml(rawContent);
    const content = isForwarded
      ? (parseForwardedMessageXml(rawContent)?.optionalText ?? '')
      : rawContent;
    const payload: ChatInputEditingMessage = {
      messageId: message.messageId,
      conversationId: target.conversationId,
      channelId: target.channelId,
      content,
    };
    closeActionSheet(() => onEditInChat?.(payload));
  }, [closeActionSheet, message, onEditInChat, target]);

  const handleCopyMessage = useCallback(() => {
    const content = message?.content;
    if (!content) return;
    const raw =
      context === 'channel' ? (parseForwardedMessageXml(content)?.content ?? content) : content;
    const plain =
      context === 'channel' ? channelHtmlToPlainText(raw) : composerHtmlToPlainText(raw);
    if (!plain) return;
    setRichMessageClipboard({ plainText: plain, storedHtml: raw });
    void Clipboard.setStringAsync(plain);
    void haptics.success();
    closeActionSheet();
  }, [closeActionSheet, context, message?.content]);

  const handleCopyImage = useCallback(() => {
    const attachment = getFirstImageAttachment(message?.attachments);
    if (!attachment) return;
    closeActionSheet();
    void copyImageAttachmentToClipboard(attachment)
      .then(() => haptics.success())
      .catch(error => {
        Alert.alert(
          'Copy failed',
          error instanceof Error ? error.message : 'Failed to copy image.',
        );
      });
  }, [closeActionSheet, message?.attachments]);

  const handleCopyLink = useCallback(() => {
    if (!target || !messageId) return;
    // Include the active workspace so the link opens the right workspace on desktop
    // (and stays deep-linkable to the exact message in-app).
    // Null-guard: a cold cache can yield no active workspace. Omit the
    // workspace segment (link still opens in-place) rather than emit a
    // malformed prefix, and record it so the gap is observable.
    const workspaceId = normalizeWorkspaceIdForLink(getActiveWorkspaceId());
    if (!workspaceId) {
      appLogger.warn('deep_link_copy_link_workspace_missing', { context });
    }
    // `exactOptionalPropertyTypes` forbids passing an explicit `undefined` for an
    // optional property, so an absent workspace must omit the key entirely.
    const workspaceScope = workspaceId ? { workspaceId } : {};
    const link =
      context === 'thread'
        ? buildWebMessageLink({
            channelId: target.channelId,
            ...workspaceScope,
            threadId: target.threadId ?? '',
            origin: target.threadId ?? '',
            messageId,
          })
        : buildWebMessageLink({
            channelId: target.channelId,
            ...workspaceScope,
            origin: target.conversationId,
          });
    void Clipboard.setStringAsync(link);
    void haptics.success();
    closeActionSheet();
  }, [closeActionSheet, context, messageId, target]);

  const handleForward = useCallback(() => openForward(), [openForward]);

  const handleTogglePin = useCallback(() => {
    if (!target) return;
    void zero.mutate(mutators.conversations.togglePin({ conversationId: target.conversationId }));
    closeActionSheet();
  }, [closeActionSheet, target, zero]);

  const handleToggleBookmark = useCallback(() => {
    if (!messageId) return;
    if (isBookmarked) {
      void zero.mutate(
        mutators.bookmark.remove({
          entityId: messageId,
          entityType: BookmarkEntityType.MESSAGE,
          timestamp: Date.now(),
        }),
      );
    } else {
      void zero.mutate(
        mutators.bookmark.add({
          entityId: messageId,
          entityType: BookmarkEntityType.MESSAGE,
          bookmarkId: uuidv4(),
          timestamp: Date.now(),
        }),
      );
    }
    closeActionSheet();
  }, [closeActionSheet, isBookmarked, messageId, zero]);

  const handleOpenReminderOptions = useCallback(() => {
    if (!target || !openReminderOptions) return;
    const reminderTarget = target;
    closeActionSheet(() => openReminderOptions(reminderTarget));
  }, [closeActionSheet, openReminderOptions, target]);

  const handleMarkAsUnread = useCallback(async () => {
    if (!target || !messageId) return;
    onBeforeMarkUnread?.();
    try {
      zero.mutate(
        mutators.channel.markChannelUnreadFrom({
          channelId: target.channelId,
          messageId,
          conversationId:
            context === 'thread'
              ? (target.threadId ?? target.conversationId)
              : target.conversationId,
          timestamp: Date.now(),
        }),
      );
      closeActionSheet();
    } catch {
      onMarkUnreadFailure?.();
      Alert.alert('Error', 'Could not mark as unread');
    }
  }, [closeActionSheet, context, messageId, onBeforeMarkUnread, onMarkUnreadFailure, target, zero]);

  const handleDelete = useCallback(() => {
    if (!messageId || !target) return;
    void haptics.warning();
    Alert.alert('Delete message?', 'This action cannot be undone.', [
      { text: 'Cancel', style: 'cancel', onPress: (): void => closeActionSheet() },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: (): void => {
          closeActionSheet(() => {
            try {
              void zero.mutate(mutators.messages.delete({ messageId }));
              void haptics.success();
            } catch {
              void haptics.error();
              Alert.alert('Failed to delete message', 'Please try again.');
            }
          });
        },
      },
    ]);
  }, [closeActionSheet, messageId, target, zero]);

  const markAsUnreadIcon = useMemo(
    (): ReactNode => (
      <View className='h-5 w-5 items-center justify-center'>
        <View className='h-3 w-3 rounded-full border-2' style={{ borderColor: foreground }} />
      </View>
    ),
    [foreground],
  );

  return useMemo<MessageAction[]>(() => {
    if (!message) return [];

    if (pending) {
      const isFailed = getStatus(pending) === 'failed';
      const pendingActions: MessageAction[] = [
        {
          id: 'pending-retry',
          icon: <RotateCcw size={20} color={foreground} />,
          label: 'Retry Send',
          onPress: handlePendingRetry,
          visible: isFailed,
        },
        {
          id: 'pending-delete',
          icon: <Trash2 size={20} color={DESTRUCTIVE_COLOR} />,
          label: 'Delete Message',
          variant: 'destructive',
          onPress: handlePendingDelete,
          visible: canDeletePending,
        },
      ];
      return pendingActions;
    }

    const actions: MessageAction[] = [
      {
        id: 'reply-in-thread',
        icon: <MessageCircleMore size={20} color={foreground} />,
        label: 'Reply in Thread',
        onPress: handleReplyInThread,
        visible: visibility.replyInThread,
      },
      {
        id: 'send-to-channel',
        icon: <CornerUpLeft size={20} color={foreground} />,
        label: 'Send to Channel',
        onPress: handleSendToChannel,
        visible: visibility.sendToChannel,
      },
      {
        id: 'edit-in-chat',
        icon: <Edit size={20} color={foreground} />,
        label: 'Edit in Chat',
        onPress: handleEditInChat,
        visible: visibility.editInChat,
      },
      {
        id: 'copy-message',
        icon: <Copy size={20} color={foreground} />,
        label: 'Copy Message',
        onPress: handleCopyMessage,
        visible: visibility.copyMessage,
      },
      {
        id: 'copy-link',
        icon: <LinkIcon size={20} color={foreground} />,
        label: 'Copy Link',
        onPress: handleCopyLink,
        visible: visibility.copyLink,
      },
      {
        id: 'forward-message',
        icon: <TurnUpRightIcon color={foreground} />,
        label: 'Forward Message',
        onPress: handleForward,
        visible: visibility.forwardMessage,
      },
      {
        id: 'copy-image',
        icon: <Copy size={20} color={foreground} />,
        label: 'Copy Image',
        onPress: handleCopyImage,
        visible: visibility.copyImage,
      },
      {
        id: 'pin',
        icon: target?.isPinned ? (
          <PinOff size={20} color={foreground} />
        ) : (
          <Pin size={20} color={foreground} />
        ),
        label: target?.isPinned ? 'Unpin Message' : 'Pin Message',
        onPress: handleTogglePin,
        visible: visibility.pin,
      },
      {
        id: 'bookmark',
        icon: isBookmarked ? (
          <BookmarkMinus size={20} color={foreground} />
        ) : (
          <Bookmark size={20} color={foreground} />
        ),
        label: isBookmarked ? 'Remove Bookmark' : 'Add Bookmark',
        onPress: handleToggleBookmark,
        visible: visibility.bookmark,
      },
      {
        id: 'remind-me',
        icon: <AlarmClock size={20} color={foreground} />,
        label: 'Remind me',
        onPress: handleOpenReminderOptions,
        visible: visibility.reminder && !!openReminderOptions,
      },
      {
        id: 'start-call',
        icon: <Headphones size={20} color={foreground} />,
        label: 'Start Call',
        onPress: handleStartCall,
        visible: visibility.startCall,
      },
      {
        id: 'mark-as-unread',
        icon: markAsUnreadIcon,
        label: 'Mark as Unread',
        onPress: handleMarkAsUnread,
        visible: visibility.markAsUnread,
        dividerBefore: visibility.editInChat || visibility.delete,
      },
      {
        id: 'delete',
        icon: <Trash2 size={20} color={DESTRUCTIVE_COLOR} />,
        label: 'Delete Message',
        variant: 'destructive',
        onPress: handleDelete,
        visible: visibility.delete,
        dividerBefore: !visibility.markAsUnread,
      },
    ];

    return actions;
  }, [
    foreground,
    handleCopyImage,
    handleCopyLink,
    handleCopyMessage,
    handleDelete,
    handleEditInChat,
    handleForward,
    handleMarkAsUnread,
    handleOpenReminderOptions,
    handleReplyInThread,
    handleSendToChannel,
    handleStartCall,
    handleToggleBookmark,
    handleTogglePin,
    isBookmarked,
    markAsUnreadIcon,
    message,
    openReminderOptions,
    target?.isPinned,
    visibility,
    pending,
    canDeletePending,
    handlePendingRetry,
    handlePendingDelete,
  ]);
};
