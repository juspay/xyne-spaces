import { unlinkSubTicketTx } from '@/bypassAcl/transactions/subTicketLinkService';
import { linkExistingSubTicketTx } from '@/bypassAcl/transactions/subTicketLinkService';
import { v4 as uuidv4 } from 'uuid';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  ActivityClassification,
  BoardType,
  GuestEntity,
  isManualSubTicketBoard,
  linkedSubTicketId,
  WorkspaceRole,
} from '@xyne/shared';
import { ACLFactory } from '@/database/acl';
import { db } from '@/database/client';
import { activityService } from '@/services/activity/activityService';
import { notificationService } from '@/services/notificationService';
import { logger } from '@/utils/logger';
import { getFormFieldUserActors } from '@/utils/ticketActorUtils';
import { subTicketLinkClosesLoop } from '@/bypassAcl/subTicketServices';

type PrismaTx = Prisma.TransactionClient;

export interface SubTicketLinkActor {
  userId: string;
  workspaceId: string;
  role: string;
}

export class SubTicketLinkError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = 'SubTicketLinkError';
  }
}

type TicketScope = { id: string; workspaceId: string; channelId: string; projectId: string };

/**
 * Guest access is an explicit allow-list (guest_access + channel_participants); a PUBLIC
 * channel never grants it. Port of acl/core/guest-access.ts hasGuestTicketAccess.
 */
export async function hasGuestTicketAccess(
  tx: PrismaTx,
  actor: SubTicketLinkActor,
  ticket: TicketScope,
): Promise<boolean> {
  if (ticket.workspaceId !== actor.workspaceId) {
    return false;
  }

  const grant = await tx.guestAccess.findFirst({
    where: {
      workspaceId: actor.workspaceId,
      userId: actor.userId,
      accessibleEntityType: GuestEntity.CHANNEL,
      accessibleEntityId: ticket.channelId,
    },
    select: { id: true },
  });
  if (grant) {
    return true;
  }

  const participant = await tx.channelParticipant.findFirst({
    where: { channelId: ticket.channelId, userId: actor.userId },
    select: { id: true },
  });
  return Boolean(participant);
}

/** Table ACL built from the re-resolved workspace role, not req.user.role (the API key's role). */
function aclFor(
  model: 'ticket' | 'ticketSubTicketMapping',
  tx: PrismaTx,
  actor: SubTicketLinkActor,
): ReturnType<typeof ACLFactory.getACL> {
  return ACLFactory.getACL(
    model,
    { userId: actor.userId, workspaceId: actor.workspaceId, role: actor.role },
    tx as unknown as PrismaClient,
  );
}

/** Read gate: member rule from TicketsACL; guests keep their own allow-list. */
export async function canReadTicket(
  tx: PrismaTx,
  actor: SubTicketLinkActor,
  ticket: TicketScope,
): Promise<boolean> {
  if (ticket.workspaceId !== actor.workspaceId) {
    return false;
  }

  if (actor.role === WorkspaceRole.GUEST) {
    return hasGuestTicketAccess(tx, actor, ticket);
  }

  const where = (await aclFor('ticket', tx, actor).getWhereClause()) as Prisma.TicketWhereInput | null;
  if (!where) {
    return false;
  }
  return (await tx.ticket.count({ where: { AND: [{ id: ticket.id }, where] } })) > 0;
}

/** Guest and archived-channel rules the table ACL does not express; 'defer' hands over to it. */
async function sharedWriteGuards(
  tx: PrismaTx,
  actor: SubTicketLinkActor,
  ticket: TicketScope,
): Promise<'allow' | 'deny' | 'defer'> {
  if (ticket.workspaceId !== actor.workspaceId) {
    return 'deny';
  }

  // The table ACL has no guest branch, so a grant-only guest must be decided here.
  if (actor.role === WorkspaceRole.GUEST) {
    return (await hasGuestTicketAccess(tx, actor, ticket)) ? 'allow' : 'deny';
  }

  const channel = await tx.channel.findUnique({
    where: { id: ticket.channelId },
    select: { workspaceId: true, isArchived: true },
  });
  if (!channel || channel.workspaceId !== actor.workspaceId) {
    return 'deny';
  }
  // MessagesACL refused the SYSTEM message in an archived channel; keep that boundary.
  if (channel.isArchived) {
    throw new SubTicketLinkError('This channel is archived', 409);
  }

  return 'defer';
}

/** Create gate: the shared guards, then TicketSubTicketMappingsACL.canCreate. */
export async function canCreateTicketMapping(
  tx: PrismaTx,
  actor: SubTicketLinkActor,
  ticket: TicketScope,
  subTicketId: string,
): Promise<boolean> {
  const guard = await sharedWriteGuards(tx, actor, ticket);
  if (guard !== 'defer') {
    return guard === 'allow';
  }

  return aclFor('ticketSubTicketMapping', tx, actor).canCreate({
    workspaceId: actor.workspaceId,
    ticketId: ticket.id,
    subTicketId,
  });
}

/** Delete gate: the shared guards, then TicketSubTicketMappingsACL.getMutateWhere. */
export async function canDeleteTicketMapping(
  tx: PrismaTx,
  actor: SubTicketLinkActor,
  ticket: TicketScope,
  mappingId: string,
): Promise<boolean> {
  const guard = await sharedWriteGuards(tx, actor, ticket);
  if (guard !== 'defer') {
    return guard === 'allow';
  }

  const where = (await aclFor('ticketSubTicketMapping', tx, actor).getMutateWhere()) as
    | Prisma.TicketSubTicketMappingWhereInput
    | null;
  if (!where) {
    return false;
  }
  return (await tx.ticketSubTicketMapping.count({ where: { AND: [{ id: mappingId }, where] } })) > 0;
}

/**
 * req.user.role is the API KEY's role on that auth path, not the workspace role, so the guest
 * branch must read users.role directly - the same source zero/server.ts trusts.
 */
export async function withWorkspaceRole(
  tx: PrismaTx,
  actor: SubTicketLinkActor,
): Promise<SubTicketLinkActor> {
  const user = await tx.user.findUnique({
    where: { id: actor.userId },
    select: { role: true, workspaceId: true },
  });
  if (!user || user.workspaceId !== actor.workspaceId) {
    throw new SubTicketLinkError('User not found in this workspace', 403);
  }
  return { ...actor, role: user.role };
}

export const TICKET_SCOPE_SELECT = {
  id: true,
  workspaceId: true,
  channelId: true,
  projectId: true,
  conversationId: true,
  boardId: true,
  xyneId: true,
} as const;

export async function assertManualBoard(tx: PrismaTx, boardId: string, subject: string): Promise<void> {
  const board = await tx.board.findUnique({ where: { id: boardId }, select: { boardType: true } });
  if (!isManualSubTicketBoard(board?.boardType as BoardType | undefined)) {
    throw new SubTicketLinkError(subject, 400);
  }
}

/**
 * Sub-ticket trees may nest deep but must stay TREES: walk up over EVERY in-edge (a row can
 * have several parents) and reject a link that would close a loop. One recursive query, not
 * one per ancestor, because this runs while the workspace lock is held; UNION dedupes, so a
 * pre-existing cycle terminates instead of spinning.
 */
export async function assertNoCycle(
  tx: PrismaTx,
  ticketId: string,
  mappedTicketId: string,
): Promise<void> {
  const closesLoop = await subTicketLinkClosesLoop(tx, ticketId, mappedTicketId);

  if (closesLoop) {
    throw new SubTicketLinkError('Cannot link a ticket to one of its own sub-tickets', 409);
  }
}

async function resolveTicketActors(ticketId: string): Promise<string[]> {
  const [ticket, roleAssignments, formFieldUserActors] = await Promise.all([
    db.ticket.findUnique({ where: { id: ticketId }, select: { createdBy: true, assignedTo: true } }),
    db.ticketAssignment.findMany({ where: { ticketId }, select: { userId: true } }),
    getFormFieldUserActors(ticketId),
  ]);

  return [
    ticket?.createdBy,
    ticket?.assignedTo,
    ...roleAssignments.map(a => a.userId),
    ...formFieldUserActors,
  ].filter((id, index, arr): id is string => Boolean(id) && arr.indexOf(id) === index);
}

/**
 * Fired after commit, matching TicketSubTicketMappingsSideEffectHandler.onInsert — the Zero
 * side-effect pipeline does not see Prisma writes, so this path notifies explicitly.
 */
async function notifySubTicketAdded(
  ticketId: string,
  channelId: string,
  actorId: string,
  subTicketTitle: string,
): Promise<void> {
  let allActorIds: string[] = [];
  try {
    allActorIds = await resolveTicketActors(ticketId);
  } catch (error) {
    logger.error('[SubTicketLinkService] Failed to resolve ticket actors:', error);
    return;
  }

  const activityRecipients = allActorIds.filter(id => id !== actorId);

  // Separate stages, as the side-effect handler had: a failed activity insert must not
  // swallow the notification.
  if (activityRecipients.length > 0) {
    try {
      await Promise.all(
        activityRecipients.map(userId =>
          activityService.createActivity({
            userId,
            actorAction: 'ticket_subticket_added',
            actionSource: 'ticket',
            actionSourceId: ticketId,
            ticketId,
            channelId,
            actorId,
            classification: ActivityClassification.FYI,
          }),
        ),
      );
    } catch (error) {
      logger.error('[SubTicketLinkService] Failed to create subticket added activities:', error);
    }
  }

  if (allActorIds.length > 0) {
    try {
      await notificationService.sendTicketSubticketAddedNotification(
        ticketId,
        allActorIds,
        subTicketTitle,
        actorId,
      );
    } catch (error) {
      logger.error('[SubTicketLinkService] Failed to send subticket added notification:', error);
    }
  }
}

export interface LinkExistingSubTicketInput {
  actor: SubTicketLinkActor;
  ticketId: string;
  mappedTicketId: string;
  /** Display fallback for the row; the tree renders from the linked ticket itself. */
  subTicketTitle: string;
}

/**
 * Link an EXISTING ticket as a sub-ticket. Writes sub_tickets + mappings, never
 * ticket_references. FLOW/RELEASE refused: their mappings are machine-owned.
 */
export async function linkExistingSubTicket({
  actor: requestActor,
  ticketId,
  mappedTicketId,
  subTicketTitle,
}: LinkExistingSubTicketInput): Promise<{ subTicketId: string; mappingId: string }> {
  if (mappedTicketId === ticketId) {
    throw new SubTicketLinkError('A ticket cannot be linked as its own sub-ticket', 400);
  }

  const subTicketId = linkedSubTicketId(ticketId, mappedTicketId);
  const mappingId = uuidv4();
  const now = new Date();

  const parentChannelId = await linkExistingSubTicketTx(requestActor, ticketId, subTicketId, mappedTicketId, subTicketTitle, now, mappingId);

  void notifySubTicketAdded(ticketId, parentChannelId, requestActor.userId, subTicketTitle);

  return { subTicketId, mappingId };
}

/**
 * Undo a link: drop the edge, never the linked ticket. The sub_tickets row goes too, so the
 * child stops counting as somebody's sub-ticket and can be re-linked.
 */
export async function unlinkSubTicket({
  actor: requestActor,
  mappingId,
}: {
  actor: SubTicketLinkActor;
  mappingId: string;
}): Promise<void> {
  const now = new Date();

  await unlinkSubTicketTx(requestActor, mappingId, now);
}
