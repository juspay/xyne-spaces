import type { Transaction } from '@rocicorp/zero';
import { UnreadableString, initialMessageMdTemplate, parentMessageMdTemplate, ticketMdTemplate } from '@xyne/shared';
import type { Schema } from '@xyne/shared';
import { compose } from '@/services/encryption/compose';
import { unreadableTransaction } from '../unreadableTransaction';

// Md columns made from a message's text, built by compose so ciphertext never ends up inside an md.

/** A message row as a sync handler reads it: content and link_preview_md as stored. */
type StoredMessage = {
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

type TargetConversation = { conversationId: string; workspaceId: string };

function seal(value: string | null | undefined): UnreadableString | null | undefined {
  return value === null || value === undefined ? value : UnreadableString.make(value);
}

/** Rebuilds `conversation.initial_message_md` from `message`; writes it only when it changed. */
export async function composeInitialMessageMd(
  tx: Transaction<Schema>,
  message: StoredMessage,
  conversation: TargetConversation & { initial_message_md: string | null },
): Promise<void> {
  const result = await compose(
    {
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
      current: seal(conversation.initial_message_md),
    },
    { workspaceId: conversation.workspaceId },
  );
  if (result.unchanged) return;
  // Written sealed: unreadableTransaction unwraps it for the database.
  await unreadableTransaction(tx, conversation.workspaceId).mutate.conversations.update({
    conversationId: conversation.conversationId,
    initial_message_md: result.value,
  });
}

/** Rebuilds `conversation.parent_message_md` from its parent `message`; writes it only when it changed. */
export async function composeParentMessageMd(
  tx: Transaction<Schema>,
  message: Pick<StoredMessage, 'messageId' | 'conversationId' | 'senderId' | 'content' | 'msgType' | 'createdAt'>,
  conversation: TargetConversation & { parent_message_md: string | null },
): Promise<void> {
  const result = await compose(
    {
      template: parentMessageMdTemplate,
      inputs: {
        messageId: message.messageId,
        conversationId: message.conversationId,
        senderId: message.senderId,
        content: UnreadableString.make(message.content),
        msgType: message.msgType,
        createdAt: message.createdAt,
      },
      current: seal(conversation.parent_message_md),
    },
    { workspaceId: conversation.workspaceId },
  );
  if (result.unchanged) return;
  // Written sealed: unreadableTransaction unwraps it for the database.
  await unreadableTransaction(tx, conversation.workspaceId).mutate.conversations.update({
    conversationId: conversation.conversationId,
    parent_message_md: result.value,
  });
}

/** A ticket row as a sync handler reads it: description as stored. */
type StoredTicket = {
  id: string;
  title?: string | null;
  description?: string | null;
  statusV2?: string | null;
  priority?: string | null;
  assignedTo?: string | null;
  createdBy?: string | null;
  createdAt?: number | null;
  eta?: number | null;
  xyneId?: string | null;
  stageName?: string | null;
  ticketType?: string | null;
  channelId?: string | null;
  conversationId?: string | null;
};

/** Rebuilds `conversation.ticket_md` from `ticket`; writes it only when it changed, and says whether it did. */
export async function composeTicketMd(
  tx: Transaction<Schema>,
  ticket: StoredTicket,
  conversation: TargetConversation & { ticket_md?: string | null },
): Promise<boolean> {
  const result = await compose(
    {
      template: ticketMdTemplate,
      inputs: {
        id: ticket.id,
        title: ticket.title,
        description: seal(ticket.description),
        statusV2: ticket.statusV2,
        priority: ticket.priority,
        assignedTo: ticket.assignedTo ?? null,
        createdBy: ticket.createdBy,
        createdAt: ticket.createdAt,
        eta: ticket.eta ?? null,
        xyneId: ticket.xyneId,
        stageName: ticket.stageName,
        ticketType: ticket.ticketType ?? null,
        channelId: ticket.channelId,
        conversationId: ticket.conversationId,
      },
      current: seal(conversation.ticket_md),
    },
    { workspaceId: conversation.workspaceId },
  );
  if (result.unchanged) return false;
  // Written sealed: unreadableTransaction unwraps it for the database.
  await unreadableTransaction(tx, conversation.workspaceId).mutate.conversations.update({
    conversationId: conversation.conversationId,
    ticket_md: result.value,
  });
  return true;
}
