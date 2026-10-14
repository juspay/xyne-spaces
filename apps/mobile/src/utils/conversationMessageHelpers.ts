import {
  MessageType,
  isForwardedMessageXml,
  parseInitialMessageMd,
  parseParentMessageMd,
  parseForwardedMessageXml,
  parseReactionsMd,
  parseTicketMd,
} from '@xyne/shared';
import type { InitialMessageSummary, ParentMessageSummary } from '@xyne/shared';
import type { MessageAttachment } from '@xyne/shared';
import type { QueryResultType } from '@rocicorp/zero';

import { queries } from '@/src/zero/queries';
import type { MessageForRender } from '@/src/components/chat/message/message.types';
import type { RawReaction } from '@/src/components/chat/message/reactions/reaction-pill.utils';

/**
 * Convert a parsed InitialMessageSummary to a UI message shape (denormalized MD path).
 * Mirrors dashboard `initialMessageSummaryToMessage`.
 */
export function initialMessageSummaryToMessage(summary: InitialMessageSummary): Omit<
  {
    messageId: string;
    conversationId: string;
    childConversationId: string | null;
    senderId: string;
    content: string;
    msgType: import('@xyne/shared').MessageType;
    hasAttachment: boolean;
    edited: boolean;
    isDeleted: boolean;
    showInChannel: boolean;
    visibleTo: string | null;
    createdAt: number;
    metadata: unknown;
    nudgeCount: number | null;
    isSent: boolean;
    reactions_md: string | null;
    link_preview_md: string | null;
  },
  never
> {
  return {
    messageId: summary.messageId,
    conversationId: summary.conversationId,
    childConversationId: summary.childConversationId ?? null,
    senderId: summary.senderId,
    content: summary.content,
    msgType: summary.msgType,
    hasAttachment: summary.hasAttachment,
    edited: summary.edited,
    isDeleted: summary.isDeleted,
    showInChannel: summary.showInChannel,
    visibleTo: summary.visibleTo ?? null,
    createdAt: summary.createdAt,
    metadata: summary.metadata ? JSON.parse(summary.metadata) : null,
    nudgeCount: summary.nudgeCount ?? null,
    isSent: summary.isSent,
    reactions_md: summary.reactions_md ?? null,
    link_preview_md: summary.link_preview_md ?? null,
  };
}

export function reactionsMdToRawReactions(
  reactionsMd: string | null | undefined,
  messageId: string,
): RawReaction[] {
  const data = parseReactionsMd(reactionsMd);
  const out: RawReaction[] = [];
  for (const [emojiName, userIds] of Object.entries(data)) {
    for (const userId of userIds) {
      out.push({
        reactionId: `${messageId}:${emojiName}:${userId}`,
        messageId,
        userId,
        emojiName,
        createdAt: 0,
      });
    }
  }
  return out;
}

/**
 * Full initial message from `initial_message_md` (dashboard contract).
 */
export function getInitialMessageFromConversation(
  conversation: { initial_message_md?: string | null },
  userId?: string,
): ReturnType<typeof initialMessageSummaryToMessage> | null {
  const summary = parseInitialMessageMd(conversation.initial_message_md);
  if (!summary) return null;

  if (userId && summary.visibleTo && summary.visibleTo !== userId) {
    return null;
  }

  return initialMessageSummaryToMessage(summary);
}

export function getParentMessageFromConversation(conversation: {
  parent_message_md?: string | null;
}): ParentMessageSummary | null {
  return parseParentMessageMd(conversation.parent_message_md);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const stripHtmlForPreview = (content: string): string =>
  content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const getParentMessageContentForPreview = (parent: ParentMessageSummary | null): string => {
  if (!parent?.content?.trim()) return '';

  if (parent.msgType === MessageType.FORWARDED || /<ForwardedMessage\b/i.test(parent.content)) {
    const forwarded = isForwardedMessageXml(parent.content)
      ? parseForwardedMessageXml(parent.content)
      : null;
    return forwarded?.optionalText || forwarded?.content || '';
  }

  return parent.content;
};

/**
 * Parent snapshots are UI previews. Never expose forwarded XML or a legacy
 * conversation UUID when a reply is also sent to the channel.
 */
export function getParentMessagePreviewText(parent: ParentMessageSummary | null): string {
  const content = getParentMessageContentForPreview(parent);

  const preview = stripHtmlForPreview(content);
  return !preview || UUID_PATTERN.test(preview) ? 'Message' : preview;
}

// export type ChannelConversationV2Row = QueryResultType<
//   typeof queries.channelConversationsPaginatedV2
// >[number];

export type ChannelConversationV3Row = QueryResultType<
  typeof queries.channelConversationsPaginatedV3
>[number];

/**
 * Maps a V2 channel conversation row + MD snapshot into `MessageForRender` for Lotus `Message` UI.
 */
export function conversationRowV3ToMessageForRender(
  row: ChannelConversationV3Row,
  currentUserId: string,
): MessageForRender | null {
  const base = getInitialMessageFromConversation(row, currentUserId);
  if (!base) return null;

  const reactions = reactionsMdToRawReactions(base.reactions_md, base.messageId);
  const ticketSummary = parseTicketMd(('ticket_md' in row ? row.ticket_md : null) ?? null);

  return {
    ...row,
    ...(ticketSummary ? { ticket: ticketSummary } : {}),
    currentUserId,
    initialMessage: {
      ...base,
      attachments: (row.initialMessageAttachments ?? []) as unknown as MessageAttachment[],
      nudgeCounts: row.initialMessageNudgeCounts ?? [],
      reactions,
    },
  };
}
