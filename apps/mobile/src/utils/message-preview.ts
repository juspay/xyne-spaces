import {
  MessageType,
  parseInitialMessageMd,
  isForwardedMessageXml,
  parseForwardedMessageXml,
  type InitialMessageSummary,
} from '@xyne/shared';
import type { Conversation } from '@xyne/shared/machines';
import type { DmConversation } from '@/src/hooks/useDmsPaginatedMessagesV2';
import type { LastMessagePreview } from '@/src/types/dm-list-item';
import { stripHtmlTags } from '@/src/utils/htmlText';

type ConversationWithAttachments = DmConversation & {
  initialMessageAttachments?: Conversation['initialMessageAttachments'];
};

function stripHtml(html: string): string {
  return stripHtmlTags(html.replace(/<br\s*\/?>/gi, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function getInitialMessageFromConversation(
  conversation: { initial_message_md?: string | null },
  userId?: string,
) {
  const summary = parseInitialMessageMd(conversation.initial_message_md);
  if (!summary) return null;
  if (userId && summary.visibleTo && summary.visibleTo !== userId) return null;
  return summary;
}

export function getVisibleInitialMessageSummary(
  conversation: { initial_message_md?: string | null } | undefined,
  userId?: string,
) {
  if (!conversation) return null;
  return getInitialMessageFromConversation(conversation, userId);
}

/**
 * Builds the row preview from an already-parsed summary. The caller owns the
 * parse so it can cache it — `parseInitialMessageMd` splits and regex-scans the
 * whole message blob, and the DM list derives 100+ rows at a time.
 */
export function buildLastMessagePreviewFromSummary(
  summary: InitialMessageSummary | null | undefined,
  currentUserId: string,
  senderName?: string,
): LastMessagePreview {
  if (!summary) {
    return { variant: 'text', text: 'No messages yet' };
  }

  if (summary.isDeleted) {
    return { variant: 'text', text: 'Message deleted' };
  }

  if (summary.msgType === MessageType.FORWARDED && isForwardedMessageXml(summary.content)) {
    const parsed = parseForwardedMessageXml(summary.content);
    const text = stripHtml(parsed?.optionalText || parsed?.content || 'Forwarded a message');
    return { variant: 'text', text };
  }

  const raw = summary.content?.trim() || 'Message';
  const plain = stripHtml(raw);

  const prefix =
    summary.senderId === currentUserId
      ? 'You: '
      : senderName
        ? `${senderName.split(' ')[0]}: `
        : '';

  return {
    variant: 'text',
    text: `${prefix}${plain}`,
  };
}

export function buildLastMessagePreview(
  conversation: ConversationWithAttachments | undefined,
  currentUserId: string,
  senderName?: string,
): LastMessagePreview {
  if (!conversation) {
    return { variant: 'text', text: 'No messages yet' };
  }

  return buildLastMessagePreviewFromSummary(
    getInitialMessageFromConversation(conversation, currentUserId),
    currentUserId,
    senderName,
  );
}
