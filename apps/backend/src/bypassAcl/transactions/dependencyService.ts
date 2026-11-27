import type { Prisma, PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { ActivityType, MessageType, toEdges } from '@xyne/shared';
import { db } from '@/database/client';
import { ACLFactory } from '@/database/acl';
import { transaction } from '../base';
import { tryAdvisoryXactLock } from '../lockServices';
import { assertNoDependencyCycle } from '../dependencyGraph';
import {
  canReadTicket, TICKET_SCOPE_SELECT, withWorkspaceRole, type SubTicketLinkActor,
} from '@/services/subTicketLinkService';
import {
  DependencyError, type CreateBlocksInput, type DependencySettings,
} from '@/services/dependencies/types';

export type DependencyActor = SubTicketLinkActor;
type Tx = Prisma.TransactionClient;
type TicketScope = Prisma.TicketGetPayload<{ select: typeof TICKET_SCOPE_SELECT }>;

export async function canEditDependencyTicket(tx: Tx, actor: DependencyActor, ticket: TicketScope) {
  if (!(await canReadTicket(tx, actor, ticket))) return false;
  const channel = await tx.channel.findFirst({
    where: { id: ticket.channelId, workspaceId: actor.workspaceId, isArchived: false },
    select: { id: true },
  });
  if (!channel) return false;
  // Resource WRITE is separate from the ticket's channel membership/read ACL.
  const resource = await tx.resource.findFirst({ where: { name: 'TICKETS' }, select: { id: true } });
  if (!resource) return false;
  const access = await tx.resourceAccess.findFirst({
    where: {
      workspaceId: actor.workspaceId, resourceId: resource.id, accessType: { in: ['WRITE', 'ADMIN'] },
      OR: [
        { userId: actor.userId },
        { userGroup: { workspaceId: actor.workspaceId, isActive: true, userGroupMappings: { some: { userId: actor.userId, workspaceId: actor.workspaceId } } } },
      ],
    },
    select: { id: true },
  });
  if (!access) return false;
  const acl = ACLFactory.getACL('ticket', {
    userId: actor.userId, workspaceId: actor.workspaceId, role: actor.role,
  }, tx as unknown as PrismaClient);
  const where = await acl.getMutateWhere() as Prisma.TicketWhereInput | null;
  return where != null && (await tx.ticket.count({ where: { AND: [{ id: ticket.id }, where] } })) > 0;
}

async function endpoints(tx: Tx, actor: DependencyActor, blockerId: string, dependentId: string) {
  const [blocker, dependent] = await Promise.all([blockerId, dependentId].map(id =>
    tx.ticket.findUnique({ where: { id }, select: TICKET_SCOPE_SELECT }),
  ));
  // Identical errors for missing, cross-workspace and unreadable tickets.
  if (!blocker || !dependent || !(await canReadTicket(tx, actor, blocker)) || !(await canReadTicket(tx, actor, dependent))) {
    throw new DependencyError('DEPENDENCY_NOT_FOUND', 'Dependency not found', 404);
  }
  if (!(await canEditDependencyTicket(tx, actor, blocker)) && !(await canEditDependencyTicket(tx, actor, dependent))) {
    throw new DependencyError('DEPENDENCY_FORBIDDEN', 'You must be able to edit one of these tickets', 403);
  }
  return { blocker, dependent };
}

async function validateSettings(tx: Tx, blocker: TicketScope, dependent: TicketScope, settings: DependencySettings) {
  if (blocker.id === dependent.id) throw new DependencyError('DEPENDENCY_SELF', 'A ticket cannot block itself', 400);
  const board = await tx.board.findFirst({ where: { id: dependent.boardId, workspaceId: dependent.workspaceId } });
  if (!board || board.boardType === 'FLOW') throw new DependencyError('DEPENDENCY_FLOW', 'FLOW stages are managed by the flow engine', 400);
  for (const [id, boardId] of [[settings.gatedStageId, dependent.boardId], [settings.satisfiedStageId, blocker.boardId]] as const) {
    if (id && !(await tx.stage.findFirst({ where: { id, boardId, workspaceId: dependent.workspaceId }, select: { id: true } }))) {
      throw new DependencyError('DEPENDENCY_STAGE', 'Choose a stage on the correct board', 400);
    }
  }
}

/** Generic text is intentional: thread viewers may not share the actor's access to the other endpoint. */
export async function recordDependencyChange(tx: Tx, actor: DependencyActor, tickets: readonly TicketScope[], action: string) {
  const now = new Date();
  for (const ticket of tickets) {
    await tx.ticketActivity.create({ data: {
      id: uuidv4(), workspaceId: actor.workspaceId, ticketId: ticket.id,
      updatedBy: actor.userId, timestamp: now, activityType: ActivityType.REFERENCE_TICKET,
      channelId: ticket.channelId, value: { relationType: 'BLOCKS', action },
    } });
    await tx.message.create({ data: {
      messageId: uuidv4(), workspaceId: actor.workspaceId,
      conversationId: ticket.conversationId, senderId: actor.userId,
      content: `Ticket dependency ${action}`, msgType: MessageType.SYSTEM,
      hasAttachment: false, edited: false, isDeleted: false, isSent: true,
      showInChannel: false, createdAt: now,
      metadata: { activityType: ActivityType.REFERENCE_TICKET, isTicketActivity: true },
    } });
  }
}

export async function withDependencyWrite<T>(requestActor: DependencyActor, fn: (tx: Tx, actor: DependencyActor) => Promise<T>) {
  return transaction(
    ['Ticket', 'TicketReferenceMapping', 'TicketSubTicketMapping', 'SubTicket', 'Stage', 'Board', 'User', 'TicketActivity', 'Message', 'Resource', 'ResourceAccess', 'UserGroupMapping'],
    'dependency graph write: reauthorize both endpoints and serialize with sub-ticket linking', db,
    async tx => {
      const actor = await withWorkspaceRole(tx, requestActor);
      if (!(await tryAdvisoryXactLock(tx, ['TicketReferenceMapping', 'TicketSubTicketMapping'],
        'dependency graph mutation shares the sub-ticket workspace lock', `link-subticket:ws:${actor.workspaceId}`))) {
        throw new DependencyError('DEPENDENCY_BUSY', 'Another dependency change is in progress; retry');
      }
      return fn(tx, actor);
    },
    { timeout: 15_000 },
  );
}

export async function createBlocksTx(tx: Tx, actor: DependencyActor, input: CreateBlocksInput) {
  const { blocker, dependent } = await endpoints(tx, actor, input.sourceTicketId, input.targetTicketId);
  await validateSettings(tx, blocker, dependent, input);
  const existing = await tx.ticketReferenceMapping.findFirst({ where: {
    workspaceId: actor.workspaceId, sourceTicketId: blocker.id, targetTicketId: dependent.id, relationType: 'BLOCKS',
  } });
  if (existing) throw new DependencyError('DEPENDENCY_EXISTS', 'This dependency already exists');
  const id = uuidv4();
  const candidate = toEdges([{ ...input, id, relationType: 'BLOCKS' }], [], [])[0]!;
  await assertNoDependencyCycle(tx, actor.workspaceId, candidate);
  const result = await tx.ticketReferenceMapping.create({ data: {
    ...input, id, workspaceId: actor.workspaceId, relationType: 'BLOCKS', origin: 'MANUAL', createdBy: actor.userId,
  } });
  await recordDependencyChange(tx, actor, [blocker, dependent], 'added');
  return { id: result.id };
}

export async function changeBlocksTx(tx: Tx, actor: DependencyActor, id: string, operation: 'update' | 'delete' | 'satisfy', settings?: DependencySettings) {
  const row = await tx.ticketReferenceMapping.findFirst({ where: { id, workspaceId: actor.workspaceId, relationType: 'BLOCKS' } });
  if (!row) throw new DependencyError('DEPENDENCY_NOT_FOUND', 'Dependency not found', 404);
  const { blocker, dependent } = await endpoints(tx, actor, row.sourceTicketId, row.targetTicketId);
  if (operation === 'update') {
    if (!settings) throw new DependencyError('DEPENDENCY_SETTINGS', 'Dependency settings required', 400);
    await validateSettings(tx, blocker, dependent, settings);
    const candidate = toEdges([{ ...row, ...settings }], [], [])[0]!;
    await assertNoDependencyCycle(tx, actor.workspaceId, candidate);
    await tx.ticketReferenceMapping.update({ where: { id }, data: settings });
  } else if (operation === 'delete') {
    await tx.ticketReferenceMapping.delete({ where: { id } });
  } else {
    if (row.satisfiedAt) return { id };
    await tx.ticketReferenceMapping.update({ where: { id }, data: { satisfiedAt: new Date() } });
  }
  await recordDependencyChange(tx, actor, [blocker, dependent], operation === 'satisfy' ? 'marked as satisfied' : operation === 'delete' ? 'removed' : 'updated');
  return { id };
}

export async function updateSubTicketGatingTx(tx: Tx, actor: DependencyActor, id: string, settings: DependencySettings) {
  const mapping = await tx.ticketSubTicketMapping.findFirst({ where: { id, workspaceId: actor.workspaceId } });
  const subTicket = mapping ? await tx.subTicket.findFirst({ where: { id: mapping.subTicketId, workspaceId: actor.workspaceId } }) : null;
  if (!mapping || !subTicket?.mappedTicketId) throw new DependencyError('DEPENDENCY_NOT_FOUND', 'Mapped sub-ticket not found', 404);
  const { blocker, dependent } = await endpoints(tx, actor, subTicket.mappedTicketId, mapping.ticketId);
  if (!(await canEditDependencyTicket(tx, actor, dependent))) throw new DependencyError('DEPENDENCY_FORBIDDEN', 'You must be able to edit the parent ticket', 403);
  await validateSettings(tx, blocker, dependent, { ...settings, satisfiedStageId: null });
  const candidate = toEdges([], [{ ...mapping, ...settings }], [subTicket])[0]!;
  await assertNoDependencyCycle(tx, actor.workspaceId, candidate);
  await tx.ticketSubTicketMapping.update({ where: { id }, data: { strength: settings.strength, gatedStageId: settings.gatedStageId } });
  await recordDependencyChange(tx, actor, [dependent], 'sub-ticket gating updated');
  return { id };
}
