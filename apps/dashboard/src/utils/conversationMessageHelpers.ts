import { MessageType, parseInitialMessageMd, parseParentMessageMd } from '@xyne/shared';
import type { InitialMessageSummary, ParentMessageSummary } from '@xyne/shared';
import type { MessageWithOptionalNudgeCounts } from '../components/ui/MessageBubble/MessageBubble.types';
import { isUndecryptableMessage } from './undecryptableMessage';

/**
 * Convert a parsed InitialMessageSummary to a MessageWithOptionalNudgeCounts
 * compatible object for use in ChatBubble and other message-rendering components.
 */
export function initialMessageSummaryToMessage(
  summary: InitialMessageSummary,
  workspaceId: string,
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
    // initial_message_md doesn't carry message acts, so a message rebuilt from the blob
    // always reports none. Same caveat as resolveMessage in @xyne/shared.
    messageActs: null,
    isSent: summary.isSent,
    reactions_md: summary.reactions_md ?? null,
    link_preview_md: summary.link_preview_md ?? null,
    workspaceId,
  };
}

interface ConversationWithInitialMessage {
  initial_message_md?: string | null;
  workspaceId: string;
  conversationId?: string;
  initialMessageId?: string;
  createdBy?: string;
  createdAt?: number;
}

/**
 * The initial message of a conversation whose initial_message_md is still ciphertext, built
 * from the conversation's own columns. Its content stays ciphertext, which message renderers
 * show as a placeholder.
 */
function undecryptableInitialMessage(
  conversation: ConversationWithInitialMessage,
): MessageWithOptionalNudgeCounts | null {
  const { conversationId, initialMessageId, createdBy, createdAt, initial_message_md } =
    conversation;
  if (!initial_message_md || !isUndecryptableMessage(initial_message_md)) return null;
  if (!conversationId || !initialMessageId || !createdBy || createdAt === undefined) return null;
  return initialMessageSummaryToMessage(
    {
      messageId: initialMessageId,
      conversationId,
      senderId: createdBy,
      content: initial_message_md,
      msgType: MessageType.USER,
      hasAttachment: false,
      edited: false,
      isDeleted: false,
      showInChannel: false,
      createdAt,
      isSent: true,
    },
    conversation.workspaceId,
  );
}

/**
 * Get the initial message from a conversation's denormalized initial_message_md field.
 * Returns null if no initial_message_md is available, or if the message is not visible
 * to the given userId (respects the visibleTo visibility filter). An initial_message_md
 * that is still ciphertext yields a message whose content renders as a placeholder.
 */
export function getInitialMessageFromConversation(
  conversation: ConversationWithInitialMessage,
  userId?: string,
): MessageWithOptionalNudgeCounts | null {
  const summary = parseInitialMessageMd(conversation.initial_message_md);
  if (!summary) return undecryptableInitialMessage(conversation);

  // Apply visibleTo filter: if visibleTo is set, only return the message
  // if it's visible to the current user (matches old .where() behavior)
  if (userId && summary.visibleTo && summary.visibleTo !== userId) {
    return null;
  }

  // A message's workspace is its conversation's workspace (authoritative, non-null).
  return initialMessageSummaryToMessage(summary, conversation.workspaceId);
}

/**
 * Get the parent message summary from a conversation's denormalized parent_message_md field.
 * A parent_message_md that is still ciphertext yields a summary whose content renders as a
 * placeholder.
 */
export function getParentMessageFromConversation(conversation: {
  parent_message_md?: string | null;
  parentMessageId?: string | null;
}): ParentMessageSummary | null {
  const md = conversation.parent_message_md;
  const summary = parseParentMessageMd(md);
  if (summary || !md || !isUndecryptableMessage(md) || !conversation.parentMessageId)
    return summary;
  return {
    messageId: conversation.parentMessageId,
    senderId: '',
    content: md,
    msgType: MessageType.USER,
    createdAt: 0,
  };
}
