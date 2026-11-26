import { UnreadableString, initialMessageMdTemplate, parentMessageMdTemplate, repliesMdAddReplierTemplate } from '@xyne/shared';
import type { ComposeRequest } from './compose';

// Compose requests for the md columns built from stored values, shared by the Zero handlers and the Prisma writers.

/** A message row as read from the database: content and link_preview_md as stored. */
export type StoredMessage = {
  messageId: string;
  conversationId: string;
  workspaceId?: string | null;
  senderId: string;
  content: string;
  msgType: string;
  createdAt: number;
  hasAttachment?: boolean;
  edited?: boolean;
  isDeleted?: boolean;
  showInChannel?: boolean;
  visibleTo?: string | null;
  metadata?: unknown;
  nudgeCount?: number | null;
  isSent?: boolean;
  reactions_md?: string | null;
  link_preview_md?: string | null;
  childConversationId?: string | null;
};

export function seal(value: string | null | undefined): UnreadableString | null | undefined {
  return value === null || value === undefined ? value : UnreadableString.make(value);
}

/** `initial_message_md` for `message`; `current` is the stored value, so an equal result comes back unchanged. */
export function initialMessageMdRequest(
  message: StoredMessage,
  current: string | null | undefined,
): ComposeRequest<typeof initialMessageMdTemplate> {
  return {
    template: initialMessageMdTemplate,
    inputs: {
      messageId: message.messageId,
      conversationId: message.conversationId,
      workspaceId: message.workspaceId,
      senderId: message.senderId,
      content: UnreadableString.make(message.content),
      msgType: message.msgType,
      createdAt: message.createdAt,
      hasAttachment: message.hasAttachment,
      edited: message.edited,
      isDeleted: message.isDeleted,
      showInChannel: message.showInChannel,
      visibleTo: message.visibleTo,
      metadata: message.metadata,
      nudgeCount: message.nudgeCount,
      isSent: message.isSent,
      reactions_md: message.reactions_md,
      link_preview_md: seal(message.link_preview_md),
      childConversationId: message.childConversationId,
    },
    current: seal(current),
  };
}

/** `parent_message_md` for the parent `message`. */
export function parentMessageMdRequest(
  message: Pick<StoredMessage, 'messageId' | 'conversationId' | 'senderId' | 'content' | 'msgType' | 'createdAt'>,
  current: string | null | undefined,
): ComposeRequest<typeof parentMessageMdTemplate> {
  return {
    template: parentMessageMdTemplate,
    inputs: {
      messageId: message.messageId,
      conversationId: message.conversationId,
      senderId: message.senderId,
      content: UnreadableString.make(message.content),
      msgType: message.msgType,
      createdAt: message.createdAt,
    },
    current: seal(current),
  };
}

/** The stored `replies_md` with `replierId` added as the latest replier. */
export function repliesMdAddReplierRequest(
  repliesMd: string | null | undefined,
  replierId: string,
): ComposeRequest<typeof repliesMdAddReplierTemplate> {
  return {
    template: repliesMdAddReplierTemplate,
    inputs: { repliesMd: seal(repliesMd) ?? null, replierId },
    current: seal(repliesMd),
  };
}
