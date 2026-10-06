import { db } from '@/database/client';
import { linkedSubTicketId, WorkspaceRole, ActivityType, MessageType } from '@xyne/shared';
import { v4 as uuidv4 } from 'uuid';
import { SubTicketLinkActor, withWorkspaceRole, SubTicketLinkError, TICKET_SCOPE_SELECT, canDeleteTicketMapping, hasGuestTicketAccess, canCreateTicketMapping, assertManualBoard, canReadTicket, assertNoCycle } from '@/services/subTicketLinkService';
import { transaction } from '../base';
import { tryAdvisoryXactLock } from '@/bypassAcl/lockServices';
export function linkExistingSubTicketTx(requestActor: SubTicketLinkActor, ticketId: string, subTicketId: string, mappedTicketId: string, subTicketTitle: string, now: Date, mappingId: string) {
  return transaction(['Message', 'SubTicket', 'Ticket', 'TicketActivity', 'TicketSubTicketMapping', 'User'], 'linkExistingSubTicket: cycle check, sub-ticket row, mapping row, activity and system message must commit together under the workspace-wide advisory lock; tx is not ACL-wrapped', db, 
    async tx => {
      const actor = await withWorkspaceRole(tx, requestActor);

      const parentTicket = await tx.ticket.findUnique({
        where: { id: ticketId },
        select: TICKET_SCOPE_SELECT,
      });
      if (!parentTicket || parentTicket.workspaceId !== actor.workspaceId) {
        throw new SubTicketLinkError('Parent ticket not found', 404);
      }
      if (!(await canCreateTicketMapping(tx, actor, parentTicket, subTicketId))) {
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
      const locked = await tryAdvisoryXactLock(tx, ['SubTicket', 'TicketSubTicketMapping'],
        'sub-ticket link: workspace-wide lock because the ancestor walk reads edges at arbitrary depth',
        'link-subticket:ws:' + actor.workspaceId);
      if (!locked) {
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
}

export function unlinkSubTicketTx(requestActor: SubTicketLinkActor, mappingId: string, now: Date) {
  return transaction(['Message', 'SubTicket', 'Ticket', 'TicketActivity', 'TicketSubTicketMapping', 'User'], 'unlinkSubTicket: removing the mapping, the orphaned sub-ticket and its activity must commit together; tx is not ACL-wrapped', db, 
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
      if (!(await canDeleteTicketMapping(tx, actor, parentTicket, mappingId))) {
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
