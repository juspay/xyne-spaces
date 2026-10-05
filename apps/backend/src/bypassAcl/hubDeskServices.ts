/**
 * HUB desk operations. A thread's author (often a guest) can't read the desk it feeds, so the
 * ticket is created in a service scope bound to the thread's workspace.
 */
import { randomUUID } from 'node:crypto';
import type { Ticket } from '@prisma/client';
import { BaseTicketType, MessageType } from '@xyne/shared';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';
import { db } from '@/database/client';
import { createHubTicket } from '@/hubDesk/hub';
import { generateTicketId } from './transactions/ticketIdService';
import { asService, transaction } from './base';

const HUB_TABLES = [
  'Conversation',
  'Message',
  'InstalledApps',
  'ExternalSource',
  'EmailChannelPreference',
  'ChannelBoardMapping',
  'Board',
  'Stage',
  'BoardSlaPolicy',
  'Ticket',
  'ChannelUserStatus',
  'Channel',
] as const;

/** Called after a new top-level thread is created; a no-op unless its channel feeds a HUB desk. */
export function hubTicketForConversation(
  workspaceId: string,
  conversationId: string
): Promise<Ticket | null> {
  return asService(
    [...HUB_TABLES],
    "HUB desk ticket: desk automation on a new thread, not the author's action",
    'hub-desk',
    workspaceId,
    () => createHubTicket(conversationId)
  );
}

/**
 * The ticket needs a conversation in its own channel, so each one gets a stub thread on the desk
 * holding one system line. Desk activity lands there. The merchant's thread is only referenced from
 * the stub's metadata and never written to: a ticket id on it would reach the merchant through the
 * conversation's ticket relation. Null if this thread already has a ticket on the desk.
 */
export async function insertHubTicket(args: {
  workspaceId: string;
  conversationId: string;
  sourceChannelId: string;
  sourceChannelName: string;
  deskId: string;
  projectId: string;
  boardId: string;
  stageName: string;
  title: string;
  description: string;
  createdBy: string;
  createdAt: Date;
  priority: string;
  userGroupId: string | null;
}): Promise<Ticket | null> {
  return transaction(
    ['Conversation', 'Message', 'Ticket', 'ChannelUserStatus', 'Project'],
    'HUB desk ticket: stub thread and ticket must commit together',
    db,
    async (tx) => {
      const existing = await tx.conversation.findFirst({
        where: {
          channelId: args.deskId,
          metadata: { path: ['hubSourceConversationId'], equals: args.conversationId },
        },
        select: { conversationId: true },
      });
      if (existing) return null;
      const stubMessageId = randomUUID();
      const stub = await tx.conversation.create({
        data: {
          channelId: args.deskId,
          createdBy: args.createdBy,
          initialMessageId: stubMessageId,
          workspaceId: args.workspaceId,
          lastActivityAt: args.createdAt,
          metadata: {
            hubSourceConversationId: args.conversationId,
            hubSourceChannelId: args.sourceChannelId,
          },
        },
      });
      await tx.message.create({
        data: {
          messageId: stubMessageId,
          conversationId: stub.conversationId,
          senderId: args.createdBy,
          workspaceId: args.workspaceId,
          content: `Conversation in #${args.sourceChannelName}`,
          msgType: MessageType.SYSTEM,
        },
      });
      const ticket = await tx.ticket.create({
        data: {
          title: args.title,
          description: args.description,
          createdBy: args.createdBy,
          updatedBy: args.createdBy,
          conversationId: stub.conversationId,
          channelId: args.deskId,
          workspaceId: args.workspaceId,
          xyneId: await generateTicketId(tx, args.projectId),
          projectId: args.projectId,
          boardId: args.boardId,
          stageName: args.stageName,
          priority: args.priority,
          ticketType: BaseTicketType.DESK,
          lastEmailAt: args.createdAt,
          ...(args.userGroupId && { userGroupId: args.userGroupId }),
        },
      });
      await tx.conversation.update({
        where: { conversationId: stub.conversationId },
        data: { ticketId: ticket.id },
      });
      await syncConversationTicketMdFromPrismaTicket(tx, ticket);
      await tx.channelUserStatus.updateMany({
        where: { channelId: args.deskId, isDeleted: false },
        data: { unreadCount: { increment: 1 }, updatedAt: new Date() },
      });
      return ticket;
    }
  );
}
