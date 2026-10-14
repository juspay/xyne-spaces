// Channels desks: a desk linked to one installed Xyne App gets a ticket for every new thread in the
// channels added to it (from those the app is in). The ticket and a stub thread live on the desk;
// the thread stays in its channel, named by an email row on the stub, so reading it still needs
// access to that channel. A ticket the merchant opens on their own thread is separate.
import type { Ticket } from '@prisma/client';
import { AppPermissionStatus, AppPermissionType, MessageType, TicketPriority, UserType } from '@xyne/shared';
import { stripHtml } from '@/agents/xyne-ai/tools/helpers';
import type { TicketLike } from '@/automations/triggers/ticket-context';
import { insertChannelsDeskTicket, readChannelsDeskTicketsForThreads, type ChannelsDeskThreadTicket } from '@/bypassAcl/channelsDeskServices';
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
export const channelsDeskSourceName = (installedAppId: string): string => `${ExternalSourcePlatform.APP_CHANNELS_DESK}:${installedAppId}`;

/** Each channel added to a Channels desk is one too; the unique name keeps a channel on one desk. */
export const channelsDeskChannelSourceName = (channelId: string): string =>
  `${ExternalSourcePlatform.APP_CHANNELS_DESK_CHANNEL}:${channelId}`;

const TITLE_MAX_LENGTH = 120;

/**
 * The desk itself, or null when nothing should be sent to it: it is archived (no one works it), or its app
 * no longer holds desk:write (removed, or the partner relationship ended).
 */
async function liveDesk(deskId: string | null | undefined, installedAppId: string | null | undefined): Promise<string | null> {
  if (!deskId || !installedAppId) return null;
  const [desk, deskWrite] = await Promise.all([
    db.channel.findUnique({ where: { id: deskId }, select: { isArchived: true } }),
    db.installedAppPermission.findFirst({
      where: {
        installedAppId,
        status: { in: [AppPermissionStatus.APPROVED, AppPermissionStatus.PENDINGDELETE] },
        permission: { name: 'desk', type: AppPermissionType.WRITE },
      },
      select: { id: true },
    }),
  ]);
  return desk && !desk.isArchived && deskWrite ? deskId : null;
}

/** The app's Channels desk. `evenIfArchived` finds the link itself, which stays while the desk is archived or the app has lost desk:write. */
export async function channelsDeskOf(installedAppId: string, { evenIfArchived = false } = {}): Promise<string | null> {
  const source = await db.externalSource.findFirst({
    where: { sourceType: ExternalSourcePlatform.APP_CHANNELS_DESK, externalIdentifier: installedAppId, isActive: true },
    select: { channelId: true },
  });
  return evenIfArchived ? (source?.channelId ?? null) : liveDesk(source?.channelId, installedAppId);
}

/** The installed app feeding a Channels desk. */
export async function channelsDeskAppOf(deskId: string): Promise<{ id: string; name: string } | null> {
  const source = await db.externalSource.findFirst({
    where: { sourceType: ExternalSourcePlatform.APP_CHANNELS_DESK, channelId: deskId, isActive: true },
    select: { externalIdentifier: true, displayName: true },
  });
  return source?.externalIdentifier ? { id: source.externalIdentifier, name: source.displayName } : null;
}

/** The Channels desk this channel was added to, if any. */
async function channelsDeskForChannel(channelId: string): Promise<string | null> {
  const source = await db.externalSource.findUnique({
    where: { name: channelsDeskChannelSourceName(channelId) },
    select: { channelId: true, isActive: true },
  });
  if (!source?.isActive || !source.channelId) return null;
  return liveDesk(source.channelId, (await channelsDeskAppOf(source.channelId))?.id);
}

/** Creates the desk ticket for a new top-level thread; null when the channel has no Channels desk or it already has one. */
export async function createChannelsDeskTicket(conversationId: string): Promise<Ticket | null> {
  const conversation = await db.conversation.findUnique({
    where: { conversationId },
    select: { workspaceId: true, channelId: true, ticketId: true, parentMessageId: true, initialMessageId: true },
  });
  if (!conversation?.channelId || conversation.ticketId || conversation.parentMessageId || !conversation.initialMessageId) {
    return null;
  }
  const sourceChannelId = conversation.channelId;
  const deskId = await channelsDeskForChannel(sourceChannelId);
  if (!deskId) return null;

  const [preference, message, sourceChannel] = await Promise.all([
    db.emailChannelPreference.findUnique({
      where: { channelId: deskId },
      select: { boardId: true, assigneeUserGroupId: true, ownerUserId: true },
    }),
    db.message.findUnique({
      where: { messageId: conversation.initialMessageId },
      select: { content: true, senderId: true, createdAt: true, msgType: true, sender: { select: { email: true, userType: true } } },
    }),
    db.channel.findUnique({ where: { id: sourceChannelId }, select: { name: true } }),
  ]);
  // Threads a bot, app or agent starts (welcomes, alerts, summaries) are not requests for the desk.
  if (!message || message.msgType === MessageType.SYSTEM || message.sender.userType !== UserType.USER || !sourceChannel) {
    return null;
  }

  const boardId = preference?.boardId ?? (await resolveChannelDefaultBoard(db, deskId))?.boardId;
  const [board, firstStage] = boardId
    ? await Promise.all([
        db.board.findUnique({ where: { id: boardId }, select: { projectId: true } }),
        db.stage.findFirst({ where: { boardId }, orderBy: { sequenceNumber: 'asc' }, select: { name: true } }),
      ])
    : [null, null];
  if (!boardId || !board || !firstStage) {
    logger.error('[channels-desk] Desk has no usable board; no ticket created', { deskId, conversationId, boardId });
    return null;
  }

  // Blocks end in a space, so paragraphs don't run together in the title.
  const text = stripHtml(message.content.replace(/<\/(p|div|li|h[1-6])>|<br\s*\/?>/gi, ' '));
  const priority = TicketPriority.LOW;
  const ticket = await insertChannelsDeskTicket({
    workspaceId: conversation.workspaceId,
    conversationId,
    messageId: conversation.initialMessageId,
    sourceChannelId,
    sourceChannelName: sourceChannel.name,
    deskId,
    projectId: board.projectId,
    boardId,
    stageName: firstStage.name,
    title: (text.length > TITLE_MAX_LENGTH ? `${text.slice(0, TITLE_MAX_LENGTH - 1)}…` : text) || 'New conversation',
    description: text,
    // Created as the desk's owner, like other desks' inbound tickets; the merchant is the requester (email row).
    createdBy: preference?.ownerUserId ?? message.senderId,
    senderEmail: message.sender.email,
    createdAt: message.createdAt,
    priority,
    userGroupId: preference?.assigneeUserGroupId ?? null,
  });
  if (!ticket) return null;

  logger.info('[channels-desk] Ticket created', { ticketId: ticket.id, deskId, conversationId, sourceChannelId });
  void messageMetadataService
    .syncInitialMessageMd(ticket.conversationId)
    .catch((err: unknown) => logger.error('[channels-desk] Stub md sync failed', { ticketId: ticket.id, err }));
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
  ).catch((err: unknown) => logger.error('[channels-desk] TICKET_CREATED emit failed', { ticketId: ticket.id, err }));
  vespaQueue
    .addJob({ schema: ticketSchema, jobType: 'feed', docId: ticket.id, workspaceId: ticket.workspaceId })
    .catch((err: unknown) => logger.error('[channels-desk] Vespa job failed', { ticketId: ticket.id, err }));

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
    logger.error('[channels-desk] Auto-assignment failed', { ticketId: ticket.id, err });
  }
}

/**
 * The desk tickets for the caller's own threads (SDK `tickets.forThreads`). The threads are read under
 * the caller's access first; null if any of them isn't one they can open.
 */
export async function channelsDeskTicketsForThreads(
  workspaceId: string,
  conversationIds: string[],
): Promise<ChannelsDeskThreadTicket[] | null> {
  const ids = [...new Set(conversationIds)];
  const visible = await db.conversation.count({ where: { conversationId: { in: ids } } });
  if (visible !== ids.length) return null;
  return readChannelsDeskTicketsForThreads(workspaceId, ids);
}
