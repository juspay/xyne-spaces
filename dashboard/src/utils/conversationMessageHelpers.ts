import { parseInitialMessageMd, parseParentMessageMd } from '@xyne/shared';
import type { InitialMessageSummary, ParentMessageSummary } from '@xyne/shared';
import type { MessageWithOptionalNudgeCounts } from '../components/ui/MessageBubble/MessageBubble.types';

/**
 * Convert a parsed InitialMessageSummary to a MessageWithOptionalNudgeCounts
 * compatible object for use in ChatBubble and other message-rendering components.
 */
export function initialMessageSummaryToMessage(
  summary: InitialMessageSummary,
): MessageWithOptionalNudgeCounts {
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    metadata: summary.metadata ? JSON.parse(summary.metadata) : null,
    nudgeCount: summary.nudgeCount ?? null,
    isSent: summary.isSent,
    reactions_md: summary.reactions_md ?? null,
    link_preview_md: summary.link_preview_md ?? null,
    workspaceId: summary.workspaceId ?? null,
  };
}

/**
 * Get the initial message from a conversation's denormalized initial_message_md field.
 * Returns null if no initial_message_md is available, or if the message is not visible
 * to the given userId (respects the visibleTo visibility filter).
 */
export function getInitialMessageFromConversation(
  conversation: { initial_message_md?: string | null },
  userId?: string,
): MessageWithOptionalNudgeCounts | null {
  const summary = parseInitialMessageMd(conversation.initial_message_md);
  if (!summary) return null;

  // Apply visibleTo filter: if visibleTo is set, only return the message
  // if it's visible to the current user (matches old .where() behavior)
  if (userId && summary.visibleTo && summary.visibleTo !== userId) {
    return null;
  }

  return initialMessageSummaryToMessage(summary);
}

/**
 * Get the parent message summary from a conversation's denormalized parent_message_md field.
 */
export function getParentMessageFromConversation(conversation: {
  parent_message_md?: string | null;
}): ParentMessageSummary | null {
  return parseParentMessageMd(conversation.parent_message_md);
}
