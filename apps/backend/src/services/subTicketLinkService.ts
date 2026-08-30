import { v4 as uuidv4 } from 'uuid';
import type { Prisma } from '@prisma/client';
import {
  ActivityClassification,
  ActivityType,
  BoardType,
  ChannelVisibility,
  GuestEntity,
  isManualSubTicketBoard,
  linkedSubTicketId,
  MessageType,
  WorkspaceRole,
} from '@xyne/shared';
import { db } from '@/database/client';
import { activityService } from '@/services/activity/activityService';
import { notificationService } from '@/services/notificationService';
import { logger } from '@/utils/logger';
import { getFormFieldUserActors } from '@/utils/ticketActorUtils';

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
async function hasGuestTicketAccess(
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

/**
 * "Can this user see this ticket": channel is PUBLIC, or they participate in it.
 * Mirrors TicketsACL.canSelect, with the guest allow-list applied first.
 */
async function canReadTicket(
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

  const channel = await tx.channel.findUnique({
    where: { id: ticket.channelId },
    select: { visibility: true },
  });
  if (channel?.visibility === ChannelVisibility.PUBLIC) {
    return true;
  }

  const participant = await tx.channelParticipant.findFirst({
    where: { channelId: ticket.channelId, userId: actor.userId },
    select: { id: true },
  });
  return Boolean(participant);
}

/**
 * Writing to a ticket's sub-ticket edges needs more than read access: a PUBLIC channel
 * also requires participation in some PUBLIC channel of its project. Port of
 * TicketSubTicketMappingsACL.canInsert/canDelete, which gate these writes today.
 */
async function canWriteTicketMappings(
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

  const channel = await tx.channel.findUnique({
    where: { id: ticket.channelId },
    select: { visibility: true, projectId: true, workspaceId: true, isArchived: true },
  });
  if (!channel || channel.workspaceId !== actor.workspaceId) {
    return false;
  }
  // MessagesACL refused the SYSTEM message in an archived channel; keep that boundary.
  if (channel.isArchived) {
    throw new SubTicketLinkError('This channel is archived', 409);
  }

  if (channel.visibility === ChannelVisibility.PRIVATE) {
    const participant = await tx.channelParticipant.findFirst({
      where: { channelId: ticket.channelId, userId: actor.userId },
      select: { id: true },
    });
    return Boolean(participant);
  }
  if (channel.visibility !== ChannelVisibility.PUBLIC) {
    return false;
  }

  // The ACL navigated channel -> project. ticket.projectId is the BOARD's project, which
  // differs whenever a channel is mapped to a board in another project.
  const projectChannelParticipant = await tx.channelParticipant.findFirst({
    where: {
      userId: actor.userId,
      channel: {
        projectId: channel.projectId,
        workspaceId: actor.workspaceId,
        visibility: ChannelVisibility.PUBLIC,
      },
    },
    select: { id: true },
  });
  return Boolean(projectChannelParticipant);
}

/**
 * req.user.role is the API KEY's role on that auth path, not the workspace role, so the guest
 * branch must read users.role directly - the same source zero/server.ts trusts.
 */
async function withWorkspaceRole(
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

const TICKET_SCOPE_SELECT = {
  id: true,
  workspaceId: true,
  channelId: true,
  projectId: true,
  conversationId: true,
  boardId: true,
  xyneId: true,
} as const;

async function assertManualBoard(tx: PrismaTx, boardId: string, subject: string): Promise<void> {
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
async function assertNoCycle(
  tx: PrismaTx,
  ticketId: string,
  mappedTicketId: string,
): Promise<void> {
  const closesLoop = await tx.$queryRaw<Array<{ found: number }>>`
    WITH RECURSIVE ancestors AS (
      SELECT ${ticketId}::text AS ticket_id
      UNION
      SELECT m."ticketId"
      FROM ancestors a
      JOIN "public"."sub_tickets" s ON s."mappedTicketId" = a.ticket_id
      JOIN "public"."ticket_sub_ticket_mappings" m ON m."subTicketId" = s.id
    )
    SELECT 1 AS found FROM ancestors WHERE ticket_id = ${mappedTicketId} LIMIT 1
  `;

  if (closesLoop.length > 0) {
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

  const parentChannelId = await db.$transaction(
    async tx => {
      const actor = await withWorkspaceRole(tx, requestActor);

      const parentTicket = await tx.ticket.findUnique({
        where: { id: ticketId },
        select: TICKET_SCOPE_SELECT,
      });
      if (!parentTicket || parentTicket.workspaceId !== actor.workspaceId) {
        throw new SubTicketLinkError('Parent ticket not found', 404);
      }
      if (!(await canWriteTicketMappings(tx, actor, parentTicket))) {
        throw new SubTicketLinkError('You do not have access to the parent ticket', 403);
      }
      await assertManualBoard(
        tx,
        parentTicket.boardId,
        'Sub-tickets on this board are managed automatically',
      );

      const mappedTicket = await tx.ticket.findUnique({
        where: { id: mappedTicketId },
        select: TICKET_SCOPE_SELECT,
      });
      if (!mappedTicket || !(await canReadTicket(tx, actor, mappedTicket))) {
        throw new SubTicketLinkError('Ticket to link not found', 404);
      }
      await assertManualBoard(
        tx,
        mappedTicket.boardId,
        "Sub-tickets on that ticket's board are managed automatically",
      );

      // The guards below are read-then-writes. Lock the whole workspace, not the two
      // endpoints: the ancestor walk reads edges at arbitrary depth, so two links with
      // disjoint endpoints could still close a cycle. try_ so a contended request returns
      // immediately instead of holding a pooled connection until the transaction times out.
      const [lock] = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtext(${'link-subticket:ws:' + actor.workspaceId})) AS locked
      `;
      if (!lock?.locked) {
        throw new SubTicketLinkError('Another sub-ticket link is in progress, try again', 409);
      }

      await assertNoCycle(tx, ticketId, mappedTicketId);

      // One parent per linked ticket, so the findFirst lookups on mappedTicketId
      // elsewhere stay unambiguous.
      const existingSubTickets = await tx.subTicket.findMany({
        where: { mappedTicketId },
        select: { id: true, ticketMappings: { select: { ticketId: true } } },
      });
      for (const existing of existingSubTickets) {
        if (existing.ticketMappings.some(mapping => mapping.ticketId === ticketId)) {
          throw new SubTicketLinkError('This ticket is already linked as a sub-ticket', 409);
        }
        if (existing.ticketMappings.length > 0) {
          throw new SubTicketLinkError('This ticket is already a sub-ticket of another ticket', 409);
        }
      }

      const rowAtDerivedId = await tx.subTicket.findUnique({
        where: { id: subTicketId },
        select: { mappedTicketId: true },
      });
      if (rowAtDerivedId && rowAtDerivedId.mappedTicketId !== mappedTicketId) {
        throw new SubTicketLinkError('This ticket cannot be linked as a sub-ticket right now', 409);
      }

      // Empty update = ON CONFLICT DO NOTHING, which is what the Zero insert compiled to.
      // rowAtDerivedId above already proved any existing row points at the same ticket.
      await tx.subTicket.upsert({
        where: { id: subTicketId },
        update: {},
        create: {
          id: subTicketId,
          title: subTicketTitle,
          description: null,
          mappedTicketId,
          createdBy: actor.userId,
          updatedBy: actor.userId,
          // The PARENT's conversation, as subTicket.create's callers pass.
          conversationId: parentTicket.conversationId,
          createdAt: now,
          updatedAt: now,
          stageProgression: null,
          assignedTo: null,
          workspaceId: actor.workspaceId,
        },
      });

      await tx.ticketSubTicketMapping.create({
        data: { id: mappingId, workspaceId: actor.workspaceId, ticketId, subTicketId },
      });

      await tx.ticketActivity.create({
        data: {
          id: uuidv4(),
          workspaceId: actor.workspaceId,
          ticketId,
          activityType: ActivityType.SUBTICKET_LINKED,
          updatedBy: actor.userId,
          timestamp: now,
          value: {
            subTicketAction: 'linked',
            subTicketId,
            subTicketTitle,
            subTicketXyneId: mappedTicket.xyneId,
          },
          channelId: parentTicket.channelId,
        },
      });

      if (parentTicket.conversationId) {
        const user = await tx.user.findUnique({
          where: { id: actor.userId },
          select: { displayName: true, name: true },
        });
        const userName = user?.displayName || user?.name || 'Someone';
        const displayId = mappedTicket.xyneId || subTicketId.substring(0, 8).toUpperCase();
        await tx.message.create({
          data: {
            messageId: uuidv4(),
            conversationId: parentTicket.conversationId,
            workspaceId: actor.workspaceId,
            senderId: actor.userId,
            content: `${userName} linked ticket ${displayId} as a sub-ticket`,
            msgType: MessageType.SYSTEM,
            hasAttachment: false,
            edited: false,
            isDeleted: false,
            isSent: true,
            showInChannel: false,
            createdAt: now,
            metadata: { activityType: ActivityType.SUBTICKET_LINKED, isTicketActivity: true },
          },
        });
      }

      return parentTicket.channelId;
    },
    { maxWait: 5_000, timeout: 15_000 },
  );

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

  await db.$transaction(
    async tx => {
      const actor = await withWorkspaceRole(tx, requestActor);

      const mapping = await tx.ticketSubTicketMapping.findUnique({
        where: { id: mappingId },
        select: { id: true, ticketId: true, subTicketId: true },
      });
      if (!mapping) {
        throw new SubTicketLinkError('Sub-ticket link not found', 404);
      }

      const parentTicket = await tx.ticket.findUnique({
        where: { id: mapping.ticketId },
        select: TICKET_SCOPE_SELECT,
      });
      if (!parentTicket || parentTicket.workspaceId !== actor.workspaceId) {
        throw new SubTicketLinkError('Parent ticket not found', 404);
      }
      if (!(await canWriteTicketMappings(tx, actor, parentTicket))) {
        throw new SubTicketLinkError('You do not have access to the parent ticket', 403);
      }

      const subTicket = await tx.subTicket.findUnique({
        where: { id: mapping.subTicketId },
        select: { id: true, title: true, mappedTicketId: true },
      });
      // A drafted sub-ticket (mappedTicketId null) holds its own content — dropping it
      // would destroy data, so only real links are unlinkable.
      if (!subTicket?.mappedTicketId) {
        throw new SubTicketLinkError('Only linked sub-tickets can be unlinked', 400);
      }

      // Gate on the ROW (only linkExisting mints the derived id), not the parent's current
      // board — moving it to a RELEASE board would otherwise strand the link.
      if (subTicket.id !== linkedSubTicketId(mapping.ticketId, subTicket.mappedTicketId)) {
        throw new SubTicketLinkError('This sub-ticket is managed automatically', 400);
      }

      const mappedTicket = await tx.ticket.findUnique({
        where: { id: subTicket.mappedTicketId },
        select: TICKET_SCOPE_SELECT,
      });
      if (actor.role === WorkspaceRole.GUEST) {
        if (!mappedTicket || !(await hasGuestTicketAccess(tx, actor, mappedTicket))) {
          throw new SubTicketLinkError('Sub-ticket not accessible for guest users', 403);
        }
      }

      // deleteMany, not delete: a concurrent unlink of the same edge would otherwise
      // raise P2025 and surface as a 500 instead of this 404.
      const { count } = await tx.ticketSubTicketMapping.deleteMany({ where: { id: mappingId } });
      if (count === 0) {
        throw new SubTicketLinkError('Sub-ticket link not found', 404);
      }

      // Only drop the row once nothing points at it.
      const remainingMappings = await tx.ticketSubTicketMapping.count({
        where: { subTicketId: mapping.subTicketId },
      });
      if (remainingMappings === 0) {
        await tx.subTicket.deleteMany({ where: { id: mapping.subTicketId } });
      }

      await tx.ticketActivity.create({
        data: {
          id: uuidv4(),
          workspaceId: actor.workspaceId,
          ticketId: mapping.ticketId,
          activityType: ActivityType.SUBTICKET_UNLINKED,
          updatedBy: actor.userId,
          timestamp: now,
          value: {
            subTicketAction: 'unlinked',
            subTicketId: mapping.subTicketId,
            subTicketTitle: subTicket.title || mappedTicket?.xyneId || '',
            subTicketXyneId: mappedTicket?.xyneId,
          },
          channelId: parentTicket.channelId,
        },
      });

      if (parentTicket.conversationId) {
        const user = await tx.user.findUnique({
          where: { id: actor.userId },
          select: { displayName: true, name: true },
        });
        const userName = user?.displayName || user?.name || 'Someone';
        const displayId =
          mappedTicket?.xyneId || mapping.subTicketId.substring(0, 8).toUpperCase();
        await tx.message.create({
          data: {
            messageId: uuidv4(),
            conversationId: parentTicket.conversationId,
            workspaceId: actor.workspaceId,
            senderId: actor.userId,
            content: `${userName} unlinked ticket ${displayId} from this ticket`,
            msgType: MessageType.SYSTEM,
            hasAttachment: false,
            edited: false,
            isDeleted: false,
            isSent: true,
            showInChannel: false,
            createdAt: now,
            metadata: { activityType: ActivityType.SUBTICKET_UNLINKED, isTicketActivity: true },
          },
        });
      }
    },
    { maxWait: 5_000, timeout: 15_000 },
  );
}
