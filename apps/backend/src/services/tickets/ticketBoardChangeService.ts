import type { Ticket } from '@prisma/client';
import { ActivityType, BoardType, TicketStatusV2, type BoardMetadata } from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { transferTicketToBoardTx } from '@/bypassAcl/transactions/controllersTicketController';
import { pushVespaJobForTicket } from '@/apps/core/ticketutils';
import { canUserModifyTicketControl, dispatchEtaNotifications, etaSignalsFromResult } from '@/services/etaManagement';
import { getTicketBotActorId } from '@/utils/etaNotificationUtils';
import type { RecordTicketTimelineEventInput } from '@/services/ticketTimelineEventService';
import { ticketAssignmentService, primaryUserIdOf, hasBoardAutoAssignment } from '@/services/ticketAssignmentService';
import { evaluateAssignmentRule } from '@/utils/assignmentEngine';
import { syncUserWorkload } from '@/utils/workloadUtils';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';
import { TicketsSideEffectHandler } from '@/zero/side-effects/tables/tickets-handler';
import { MessagesSideEffectHandler } from '@/zero/side-effects/tables/messages-handler';
import type { QueryContext } from '@/zero/acl/core/types';
import type { TicketPreviousValue } from '@/zero/side-effects/types';
import { vespaQueue } from '@/queues/vespaQueue';
import { entityExtractionQueue } from '@/queues/entityExtractionQueue';
import { messageClassificationQueue } from '@/queues/messageClassificationQueue';
import { messageSchema } from '@/vespa/src/types';

/**
 * Every board change runs through here (the Zero ticket.update mutator rejects boardId).
 * Same effective namespace → move in place; different → the caller transfers instead.
 */

export class BoardChangeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const boardSelect = {
  id: true,
  name: true,
  projectId: true,
  boardType: true,
  metadata: true,
  ticketNamespaceId: true,
} as const;

export type BoardChangeBoard = NonNullable<Awaited<ReturnType<typeof findBoard>>>;

function findBoard(id: string, workspaceId: string) {
  return db.board.findFirst({ where: { id, workspaceId }, select: boardSelect });
}

export async function loadBoardChangeBoards(
  sourceBoardId: string,
  targetBoardId: string,
  workspaceId: string,
): Promise<{ source: BoardChangeBoard; target: BoardChangeBoard }> {
  const [source, target] = await Promise.all([
    findBoard(sourceBoardId, workspaceId),
    findBoard(targetBoardId, workspaceId),
  ]);
  if (!target) throw new BoardChangeError('Target board not found', 404);
  if (!source) throw new BoardChangeError('Source board not found', 404);
  return { source, target };
}

// Effective namespace = the board's own, else its project's default
async function effectiveNamespaceId(board: BoardChangeBoard): Promise<string | null> {
  if (board.ticketNamespaceId) return board.ticketNamespaceId;
  const project = await db.project.findUnique({
    where: { id: board.projectId },
    select: { defaultTicketNamespaceId: true },
  });
  return project?.defaultTicketNamespaceId ?? null;
}

// Mirrors the dashboard: a transfer only when both boards resolve to different namespaces
export async function isCrossNamespaceChange(
  source: BoardChangeBoard,
  target: BoardChangeBoard,
): Promise<boolean> {
  const [sourceNamespaceId, targetNamespaceId] = await Promise.all([
    effectiveNamespaceId(source),
    effectiveNamespaceId(target),
  ]);
  return !!sourceNamespaceId && !!targetNamespaceId && sourceNamespaceId !== targetNamespaceId;
}

// Flow-board and ticket-control checks, shared by move and transfer
export async function assertCanChangeBoard(
  ticket: { boardId: string; userGroupId: string | null },
  source: BoardChangeBoard,
  target: BoardChangeBoard,
  userId: string,
): Promise<void> {
  // Flow boards only receive tickets through the flow cascade or "Start flow"
  if (target.boardType === BoardType.FLOW) {
    throw new BoardChangeError('Tickets cannot be moved onto a Flow board', 400);
  }
  if (source.boardType === BoardType.FLOW) {
    throw new BoardChangeError('Tickets cannot be moved off a Flow board', 400);
  }

  const permission = await canUserModifyTicketControl(userId, ticket.userGroupId, ticket.boardId, {
    getBoardMetadata: async () => source.metadata ?? null,
    getUserGroupMapping: async (mappingUserId, userGroupId) => {
      const mapping = await db.userGroupMapping.findFirst({
        where: { userId: mappingUserId, userGroupId },
        select: { roleId: true, responsibility: true },
      });
      return mapping
        ? { roleId: mapping.roleId ?? null, responsibility: mapping.responsibility ?? null }
        : null;
    },
  });
  if (!permission.allowed) {
    throw new BoardChangeError(permission.reason ?? 'Not authorized to modify this ticket', 403);
  }
}

/**
 * Moves a ticket to another board in the same namespace: first stage, stage ETAs and
 * pending stage requests reset, BOARD activity + system message, then the post-commit
 * side effects the Zero mutator used to trigger (notifications, automations, search,
 * auto-assignment for the new board).
 */
export async function moveTicketToBoard(params: {
  ticketId: string;
  targetBoardId: string;
  ctx: QueryContext;
}): Promise<Ticket> {
  const { ticketId, targetBoardId, ctx } = params;
  const userId = ctx.userID;

  const ticket = await db.ticket.findFirst({
    where: { id: ticketId, workspaceId: ctx.workspaceId },
    select: {
      id: true,
      workspaceId: true,
      projectId: true,
      boardId: true,
      channelId: true,
      conversationId: true,
      title: true,
      description: true,
      stageName: true,
      statusV2: true,
      priority: true,
      assignedTo: true,
      createdBy: true,
      userGroupId: true,
      eta: true,
      metadata: true,
    },
  });
  if (!ticket) throw new BoardChangeError('Ticket not found', 404);

  const { source, target } = await loadBoardChangeBoards(ticket.boardId, targetBoardId, ctx.workspaceId);
  await assertCanChangeBoard(ticket, source, target, userId);

  const actor = await db.user.findUnique({
    where: { id: userId },
    select: { name: true, displayName: true },
  });
  const actorName = actor?.displayName || actor?.name || 'Someone';
  const now = new Date();
  const boardEvent: RecordTicketTimelineEventInput = {
    activity: {
      ticketId,
      updatedBy: userId,
      activityType: ActivityType.BOARD,
      value: { oldValue: ticket.boardId, newValue: targetBoardId },
      workspaceId: ticket.workspaceId,
      channelId: ticket.channelId,
      timestamp: now,
    },
    ...(ticket.conversationId && {
      message: {
        conversationId: ticket.conversationId,
        senderId: userId,
        content: `${actorName} moved ticket from board "${source.name}" to "${target.name}"`,
        activityType: ActivityType.BOARD,
        workspaceId: ticket.workspaceId,
        createdAt: now,
      },
    }),
  };

  // Resolved outside the transaction: a stable bot-user lookup, best kept off the held connection
  const systemActorId = await getTicketBotActorId(ticket.workspaceId);
  const { updatedTicket, etaResult, boardEventMessageId } = await transferTicketToBoardTx(
    targetBoardId,
    ticketId,
    now,
    userId,
    ticket,
    systemActorId,
    boardEvent,
  );

  // Post-commit side effects are best-effort and never affect the committed move
  if (updatedTicket.statusV2 !== TicketStatusV2.PAUSED) {
    void dispatchEtaNotifications(etaSignalsFromResult(etaResult), {
      ticketId,
      createdBy: ticket.createdBy,
      assignedTo: ticket.assignedTo,
      ticketUserGroupId: ticket.userGroupId,
      boardId: targetBoardId,
      actorId: userId,
    }).catch(error => {
      logger.error('[BOARD-CHANGE] Failed to dispatch ETA notifications', { ticketId, error });
    });
  }

  const previousValue: TicketPreviousValue = {
    assignedTo: ticket.assignedTo,
    stageName: ticket.stageName,
    statusV2: ticket.statusV2,
    priority: ticket.priority,
    title: ticket.title,
    description: ticket.description,
    eta: ticket.eta ? ticket.eta.getTime() : null,
    boardId: ticket.boardId,
    userGroupId: ticket.userGroupId,
    createdBy: ticket.createdBy,
    channelId: ticket.channelId,
    metadata: ticket.metadata,
  };
  // ETA/metadata are left out: the dispatch above already covers those notifications
  new TicketsSideEffectHandler(ctx)
    .onUpdate({
      entityId: ticketId,
      entityType: 'tickets',
      operation: 'update',
      args: {
        boardId: targetBoardId,
        stageName: updatedTicket.stageName,
        statusV2: updatedTicket.statusV2,
      },
      previousValue,
    })
    .catch(error => logger.error('[BOARD-CHANGE] TicketsSideEffectHandler error:', error));

  pushVespaJobForTicket(ticketId, userId, ticket.workspaceId).catch(error => {
    logger.error(`[BOARD-CHANGE] Vespa indexing failed for ${ticketId}:`, error);
  });

  if (boardEventMessageId && ticket.conversationId) {
    new MessagesSideEffectHandler(ctx)
      .onInsert({ entityId: boardEventMessageId, entityType: 'messages', operation: 'insert' })
      .catch(error => logger.error('[BOARD-CHANGE] MessagesSideEffectHandler error:', error));
    vespaQueue
      .addJob({ schema: messageSchema, jobType: 'feed', docId: boardEventMessageId, workspaceId: ticket.workspaceId })
      .catch(error => logger.error(`[BOARD-CHANGE] Vespa indexing failed for message ${boardEventMessageId}:`, error));
    void entityExtractionQueue.enqueueForMessage(ticket.conversationId);
    void messageClassificationQueue.enqueueForMessage(ticket.conversationId);
  }

  if (ticket.userGroupId) {
    void reassignForNewBoard(ticket, ticket.userGroupId, target, previousValue, ctx).catch(error => {
      logger.error('[BOARD-CHANGE] Failed to retrigger auto-assignment', { ticketId, error });
    });
  }

  return updatedTicket;
}

// Re-runs auto-assignment against the new board, as the mutator's board branch did
async function reassignForNewBoard(
  ticket: { id: string; projectId: string; channelId: string | null; assignedTo: string | null },
  userGroupId: string,
  target: BoardChangeBoard,
  previousValue: TicketPreviousValue,
  ctx: QueryContext,
): Promise<void> {
  const userId = ctx.userID;
  const fullRoleAssignment = hasBoardAutoAssignment(target.metadata as BoardMetadata | undefined);

  const assignedUserId = fullRoleAssignment
    ? primaryUserIdOf(
        await ticketAssignmentService.assignFullRolesToTicket({
          ticketId: ticket.id,
          userGroupId,
          boardId: target.id,
          createdBy: userId,
          projectId: ticket.projectId,
          channelId: ticket.channelId,
        }),
      )
    : (
        await evaluateAssignmentRule(
          userGroupId,
          target.id,
          undefined,
          undefined,
          ticket.projectId,
          ticket.channelId,
        )
      ).assignedUserId;
  if (!assignedUserId) return;

  const updated = await db.ticket.update({
    where: { id: ticket.id },
    data: { assignedTo: assignedUserId, updatedAt: new Date(), updatedBy: userId },
  });
  await syncConversationTicketMdFromPrismaTicket(db, updated);
  if (!fullRoleAssignment) {
    await syncUserWorkload(assignedUserId, userGroupId, target.id, userId);
  }

  await new TicketsSideEffectHandler(ctx).onUpdate({
    entityId: ticket.id,
    entityType: 'tickets',
    operation: 'update',
    args: { assignedTo: assignedUserId },
    previousValue: { ...previousValue, boardId: target.id, assignedTo: ticket.assignedTo },
  });
}
