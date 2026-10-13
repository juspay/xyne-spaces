/**
 * Channels desk operations. A thread's author (often a guest) can't read the desk it feeds, so the
 * ticket is created in a service scope bound to the thread's workspace.
 */
import { randomUUID } from 'node:crypto';
import type { Ticket } from '@prisma/client';
import { BaseTicketType, ChannelType, EmailType, MessageType } from '@xyne/shared';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';
import { db } from '@/database/client';
import { EmailRepository } from '@/database/repositories/emailRepository';
import { createChannelsDeskTicket } from '@/channelsDesk/desk';
import { generateTicketId } from './transactions/ticketIdService';
import { asService, transaction } from './base';

const CHANNELS_DESK_TABLES = [
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
  'User',
] as const;

/** Called after a new top-level thread is created; a no-op unless its channel feeds a Channels desk. */
export function channelsDeskTicketForConversation(
  workspaceId: string,
  conversationId: string
): Promise<Ticket | null> {
  return asService(
    [...CHANNELS_DESK_TABLES],
    "Channels desk ticket: desk automation on a new thread, not the author's action",
    'channels-desk',
    workspaceId,
    () => createChannelsDeskTicket(conversationId)
  );
}

/**
 * The ticket needs a conversation in its own channel, so each one gets a stub thread on the desk
 * holding one system line. Desk activity lands there. Like other desks' external threads, the
 * merchant's thread is named by an email row on the stub (externalThreadId) and never written to.
 * Null if this thread already has a ticket on the desk.
 */
export async function insertChannelsDeskTicket(args: {
  workspaceId: string;
  conversationId: string;
  messageId: string;
  sourceChannelName: string;
  deskId: string;
  projectId: string;
  boardId: string;
  stageName: string;
  title: string;
  description: string;
  createdBy: string;
  senderEmail: string;
  createdAt: Date;
  priority: string;
  userGroupId: string | null;
}): Promise<Ticket | null> {
  return transaction(
    ['Conversation', 'Message', 'Ticket', 'ChannelUserStatus', 'Project', 'Email', 'Channel'],
    'Channels desk ticket: stub thread and ticket must commit together',
    db,
    async (tx) => {
      const existing = await tx.email.findFirst({
        where: { channelId: args.deskId, externalThreadId: args.conversationId },
        select: { id: true },
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
      await new EmailRepository().create(
        {
          type: EmailType.DEFAULT,
          subject: args.title,
          body: args.description,
          to: [],
          from: args.senderEmail,
          conversationId: stub.conversationId,
          channelId: args.deskId,
          externalThreadId: args.conversationId,
          externalMessageId: args.messageId,
          createdAt: args.createdAt,
        },
        tx
      );
      await syncConversationTicketMdFromPrismaTicket(tx, ticket);
      await tx.channelUserStatus.updateMany({
        where: { channelId: args.deskId, isDeleted: false },
        data: { unreadCount: { increment: 1 }, updatedAt: new Date() },
      });
      return ticket;
    }
  );
}

export interface ChannelsDeskThreadTicket {
  conversationId: string;
  ticketId: string;
  xyneId: string;
  title: string;
  statusV2: string;
  stageName: string;
  priority: string;
  assignee: { id: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The tickets Channels desks opened for these threads, for someone already allowed to open the threads
 * (`channelsDeskTicketsForThreads` checks that). The desk is outside their access, so only these fields leave
 * it: never the desk's own thread or its notes.
 */
export function readChannelsDeskTicketsForThreads(workspaceId: string, conversationIds: string[]): Promise<ChannelsDeskThreadTicket[]> {
  return asService(
    ['Email', 'Channel', 'Ticket', 'User'],
    "Channels desk ticket status for its thread's own members",
    'channels-desk',
    workspaceId,
    async () => {
      const links = await db.email.findMany({
        where: { externalThreadId: { in: conversationIds }, channel: { type: ChannelType.CHANNELS } },
        select: { externalThreadId: true, conversationId: true },
      });
      const threadOf = new Map(links.map((link) => [link.conversationId, link.externalThreadId]));
      const tickets = await db.ticket.findMany({
        where: { conversationId: { in: [...threadOf.keys()] }, isArchived: false },
        select: {
          id: true,
          xyneId: true,
          title: true,
          statusV2: true,
          stageName: true,
          priority: true,
          assignedTo: true,
          createdAt: true,
          updatedAt: true,
          conversationId: true,
        },
      });
      const assignees = await db.user.findMany({
        where: { id: { in: tickets.flatMap((ticket) => ticket.assignedTo ?? []) } },
        select: { id: true, name: true, displayName: true },
      });
      const nameOf = new Map(assignees.map((user) => [user.id, user.displayName || user.name]));
      return tickets.map((ticket) => ({
        conversationId: threadOf.get(ticket.conversationId)!,
        ticketId: ticket.id,
        xyneId: ticket.xyneId,
        title: ticket.title,
        statusV2: ticket.statusV2,
        stageName: ticket.stageName,
        priority: ticket.priority,
        assignee: ticket.assignedTo ? { id: ticket.assignedTo, name: nameOf.get(ticket.assignedTo) ?? '' } : null,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
      }));
    }
  );
}
