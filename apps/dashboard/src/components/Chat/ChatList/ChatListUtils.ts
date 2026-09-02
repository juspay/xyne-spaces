import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../../zero/queries';
import { MessageType } from '@xyne/shared';
import { MessageMetadata } from '../../ui/MessageBubble/MessageBubble.utils';
import { getInitialMessageFromConversation } from '../../../utils/conversationMessageHelpers';

// Type definitions for utility functions
export type ThreadMessage = QueryResultType<typeof queries.channelAndThreadMessagesV2>[number];

type ChatListConversation = QueryResultType<typeof queries.channelConversationsPaginatedV3>[number];

export type CombinedMessageItem =
  | {
      type: 'conversation';
      data: ChatListConversation;
      createdAt: Date;
    }
  | {
      type: 'thread-message';
      data: ThreadMessage;
      createdAt: Date;
    };
/**
 * Extract origin conversation ID from URL hash
 * Example: #origin=9d305bdb-2a05-4833-8bd2-1d4e911db695 → 9d305bdb-2a05-4833-8bd2-1d4e911db695
 */
export const extractOriginFromHash = (hash: string): string | null => {
  if (!hash) return null;

  const match = hash.match(/origin=([^&]+)/);
  return match?.[1] ?? null;
};

/**
 * Extract message ID from URL hash
 * Example: #origin=abc123&messageId=xyz789 → xyz789
 */
export const extractMessageIdFromHash = (hash: string): string | null => {
  if (!hash) return null;

  const match = hash.match(/messageId=([^&]+)/);
  return match?.[1] ?? null;
};

/**
 * Helper function to determine if avatar should be shown
 * Shows avatar when:
 * - It's the first message
 * - Different sender than previous message
 * - Previous message was a conversation with replies
 */
export const shouldShowAvatar = (
  currentItem: CombinedMessageItem,
  prevItem: CombinedMessageItem | null,
): boolean => {
  if (!prevItem) return true;

  const isSameDayMessege = (): boolean => {
    const createdAt = currentItem.createdAt;
    const createAtPrevItem = prevItem.createdAt;
    const d1 = new Date(createdAt);
    const d2 = new Date(createAtPrevItem);

    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
    );
  };

  // Always show avatar for call messages
  const isCurrentItemCallMessage = (): boolean => {
    if (currentItem.type === 'conversation') {
      const initialMessage = getInitialMessageFromConversation(currentItem.data);
      const metadata = initialMessage?.metadata as Record<string, unknown> | null;
      return metadata?.['isCallMessage'] === true;
    }
    const metadata = currentItem.data.metadata as Record<string, unknown> | null;
    return metadata?.['isCallMessage'] === true;
  };

  const isPreviousItemAWorkflowOrActivity = (): boolean => {
    if (prevItem.type !== 'conversation') return false;

    const previousMessage = getInitialMessageFromConversation(prevItem.data);
    const previousMessageMetadata = previousMessage?.metadata as MessageMetadata | null;
    const isPreviousMessageAWorkflowMessage =
      (previousMessage?.msgType === MessageType.SYSTEM &&
        previousMessageMetadata?.workflowId &&
        previousMessageMetadata?.ticketId) ||
      (previousMessage?.msgType === MessageType.BOT &&
        previousMessageMetadata?.xyneId &&
        previousMessageMetadata?.ticketId);
    const prevMsgMetadataasRecord = previousMessage?.metadata as Record<string, unknown> | null;
    const isPreviousMessageAnActivity =
      previousMessage?.msgType === MessageType.SYSTEM &&
      prevMsgMetadataasRecord?.['isTicketActivity'] === true;

    return !!isPreviousMessageAWorkflowMessage || isPreviousMessageAnActivity;
  };

  // A tagged thread shows its chip beside the name and timestamp, so it needs its own
  // header row — grouped under the previous message there is nowhere to put it. Raw check
  // rather than parsing: '[]' means the tags were cleared, so there is nothing to show.
  const hasThreadTag = (): boolean => {
    if (currentItem.type !== 'conversation') return false;
    const raw = currentItem.data.threadType;
    return !!raw && raw !== '[]';
  };

  if (hasThreadTag()) return true;
  if (isCurrentItemCallMessage()) return true;
  if (!isSameDayMessege()) return true;

  if (isPreviousItemAWorkflowOrActivity()) return true;

  const getCurrentSenderId = (item: CombinedMessageItem): string => {
    if (item.type === 'conversation') {
      return item.data.createdBy;
    }
    return item.data.senderId;
  };

  // Check if previous message is a system message
  const isPreviousMessageSystem = (): boolean => {
    if (prevItem.type === 'conversation') {
      const prevInitialMessage = getInitialMessageFromConversation(prevItem.data);
      return prevInitialMessage?.msgType === MessageType.SYSTEM;
    }
    return prevItem.data.msgType === MessageType.SYSTEM;
  };

  // Always show avatar after a system message
  if (isPreviousMessageSystem()) return true;

  const currentSenderId = getCurrentSenderId(currentItem);
  const prevSenderId = getCurrentSenderId(prevItem);

  if (currentSenderId !== prevSenderId) return true;
  // --- TIME-GAP LOGIC ---

  const TIME_THRESHOLD_MS = 5 * 60 * 1000; // 5 minute threshold

  const currentTs = new Date(currentItem.createdAt).getTime();
  const prevTs = new Date(prevItem.createdAt).getTime();

  // If the gap between messages is > 5 minute, force avatar to reappear
  if (currentTs - prevTs > TIME_THRESHOLD_MS) {
    return true;
  }

  if (prevItem.type === 'conversation') {
    if ((prevItem.data.replyCount ?? 0) > 0) {
      return true;
    }
  }

  return false;
};

/**
 * Helper function to create message preview from HTML content
 * Extracts plain text and truncates to 50 characters
 */
export const createMessagePreview = (content: string | undefined): string => {
  if (!content) return '';

  const getPlainText = (html: string): string => {
    if (typeof DOMParser === 'undefined') return ''; // Handle server-side rendering
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    return doc.body.textContent || '';
  };

  const plainText = getPlainText(content).trim();
  const preview = plainText.substring(0, 50);
  return `"${preview}${plainText.length > 50 ? '...' : ''}"`;
};
