// HUB desks: a desk linked to one installed Xyne App gets a ticket for every new thread in the
// channels added to it (from those the app created). The ticket and a stub thread live on the desk;
// the thread stays in its channel (only referenced), so reading it still needs access to that channel.
import type { Ticket } from '@prisma/client';
import { MessageType, TicketPriority } from '@xyne/shared';
import { stripHtml } from '@/agents/xyne-ai/tools/helpers';
import type { TicketLike } from '@/automations/triggers/ticket-context';
import { insertHubTicket } from '@/bypassAcl/hubDeskServices';
import { db } from '@/database/client';
import { ExternalSourcePlatform } from '@/integrations/core/types';
import { vespaQueue } from '@/queues/vespaQueue';
import { messageMetadataService } from '@/services/messageMetadataService';
import { evaluateAssignmentRule } from '@/utils/assignmentEngine';
import { resolveChannelDefaultBoard } from '@/utils/channelDefaultBoard';
import { logger } from '@/utils/logger';
import { syncUserWorkload } from '@/utils/workloadUtils';
import { ticketSchema } from '@/vespa/src/types';

/** The desk's link to its app is an ExternalSource, like other desk sources; one per installed app. */
export const hubSourceName = (installedAppId: string): string => `${ExternalSourcePlatform.APP_HUB}:${installedAppId}`;

/** Each channel added to a HUB desk is one too; the unique name keeps a channel on one desk. */
export const hubChannelSourceName = (channelId: string): string =>
  `${ExternalSourcePlatform.APP_HUB_CHANNEL}:${channelId}`;

const TITLE_MAX_LENGTH = 120;

export async function hubDeskOf(installedAppId: string): Promise<string | null> {
  const source = await db.externalSource.findFirst({
    where: { sourceType: ExternalSourcePlatform.APP_HUB, externalIdentifier: installedAppId, isActive: true },
    select: { channelId: true },
  });
  return source?.channelId ?? null;
}

/** The installed app feeding a HUB desk. */
export async function hubAppOf(deskId: string): Promise<{ id: string; name: string } | null> {
  const source = await db.externalSource.findFirst({
    where: { sourceType: ExternalSourcePlatform.APP_HUB, channelId: deskId, isActive: true },
    select: { externalIdentifier: true, displayName: true },
  });
  return source?.externalIdentifier ? { id: source.externalIdentifier, name: source.displayName } : null;
}

/** The HUB desk this channel was added to, if any. */
async function hubDeskForChannel(channelId: string): Promise<string | null> {
  const source = await db.externalSource.findUnique({
    where: { name: hubChannelSourceName(channelId) },
    select: { channelId: true, isActive: true },
  });
  return source?.isActive ? source.channelId : null;
}

/** Creates the desk ticket for a new top-level thread; null when the channel has no HUB desk or it already has one. */
export async function createHubTicket(conversationId: string): Promise<Ticket | null> {
  const conversation = await db.conversation.findUnique({
    where: { conversationId },
    select: { workspaceId: true, channelId: true, ticketId: true, parentMessageId: true, initialMessageId: true },
  });
  if (!conversation?.channelId || conversation.ticketId || conversation.parentMessageId || !conversation.initialMessageId) {
    return null;
  }
  const sourceChannelId = conversation.channelId;
  const deskId = await hubDeskForChannel(sourceChannelId);
  if (!deskId) return null;

  const [preference, message, sourceChannel] = await Promise.all([
    db.emailChannelPreference.findUnique({
      where: { channelId: deskId },
      select: { boardId: true, assigneeUserGroupId: true },
    }),
    db.message.findUnique({
      where: { messageId: conversation.initialMessageId },
      select: { content: true, senderId: true, createdAt: true, msgType: true },
    }),
    db.channel.findUnique({ where: { id: sourceChannelId }, select: { name: true } }),
  ]);
  if (!message || message.msgType === MessageType.SYSTEM || !sourceChannel) return null;

  const boardId = preference?.boardId ?? (await resolveChannelDefaultBoard(db, deskId))?.boardId;
  const [board, firstStage] = boardId
    ? await Promise.all([
        db.board.findUnique({ where: { id: boardId }, select: { projectId: true } }),
        db.stage.findFirst({ where: { boardId }, orderBy: { sequenceNumber: 'asc' }, select: { name: true } }),
      ])
    : [null, null];
  if (!boardId || !board || !firstStage) {
    logger.error('[hub-desk] Desk has no usable board; no ticket created', { deskId, conversationId, boardId });
    return null;
  }

  const text = stripHtml(message.content);
  const priority = TicketPriority.LOW;
  const ticket = await insertHubTicket({
    workspaceId: conversation.workspaceId,
    conversationId,
    sourceChannelId,
    sourceChannelName: sourceChannel.name,
    deskId,
    projectId: board.projectId,
    boardId,
    stageName: firstStage.name,
    title: (text.length > TITLE_MAX_LENGTH ? `${text.slice(0, TITLE_MAX_LENGTH - 1)}…` : text) || 'New conversation',
    description: text,
    createdBy: message.senderId,
    createdAt: message.createdAt,
    priority,
    userGroupId: preference?.assigneeUserGroupId ?? null,
  });
  if (!ticket) return null;

  logger.info('[hub-desk] Ticket created', { ticketId: ticket.id, deskId, conversationId, sourceChannelId });
  void messageMetadataService
    .syncInitialMessageMd(ticket.conversationId)
    .catch((err: unknown) => logger.error('[hub-desk] Stub md sync failed', { ticketId: ticket.id, err }));
  await afterCreate(ticket, sourceChannelId);
  return ticket;
}

async function afterCreate(ticket: Ticket, sourceChannelId: string): Promise<void> {
  // Loaded lazily: this module sits on the message path, and importing the triggers eagerly
  // puts them in an import cycle that breaks startup.
  const [{ emitDomainEvent }, { TICKET_CREATED_EVENT }, { emitTicketUpdated }] = await Promise.all([
    import('@/events/emitDomainEvent'),
    import('@/automations/triggers/ticket-created.trigger'),
    import('@/automations/triggers/ticket-updated.trigger'),
  ]);
  void emitDomainEvent(
    {
      type: TICKET_CREATED_EVENT,
      payload: {
        ticketId: ticket.id,
        scope: { boardId: ticket.boardId ?? null, projectId: ticket.projectId ?? null, channelId: ticket.channelId },
      },
    },
    ticket.workspaceId,
  ).catch((err: unknown) => logger.error('[hub-desk] TICKET_CREATED emit failed', { ticketId: ticket.id, err }));
  vespaQueue
    .addJob({ schema: ticketSchema, jobType: 'feed', docId: ticket.id, workspaceId: ticket.workspaceId })
    .catch((err: unknown) => logger.error('[hub-desk] Vespa job failed', { ticketId: ticket.id, err }));

  if (!ticket.userGroupId || !ticket.boardId) return;
  void emitTicketUpdated({
    ticket: ticket as unknown as TicketLike, // Prisma's statusV2 is a plain string
    changes: { userGroupId: { previousValue: null, newValue: ticket.userGroupId } },
    performedById: ticket.createdBy,
  });
  // Only people who can open the conversation: desk members who are also in its channel.
  try {
    const { assignedUserId } = await evaluateAssignmentRule(
      ticket.userGroupId,
      ticket.boardId,
      undefined,
      undefined,
      ticket.projectId,
      ticket.channelId,
      sourceChannelId,
    );
    if (!assignedUserId) return;
    await db.ticket.update({ where: { id: ticket.id }, data: { assignedTo: assignedUserId } });
    await syncUserWorkload(assignedUserId, ticket.userGroupId, ticket.boardId, ticket.createdBy);
  } catch (err) {
    logger.error('[hub-desk] Auto-assignment failed', { ticketId: ticket.id, err });
  }
}
