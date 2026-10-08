import { Prisma } from '@prisma/client';
import { ActivityType, BoardType, TicketStatusV2, parseBoardEtaManagement } from '@xyne/shared';
import type { BoardMetadata } from '@xyne/shared';
import { db } from '@/database/client';
import { withWorkspaceScope } from '@/database/tenant/context';
import { TicketRepository } from '@/database/repositories/ticketRepository';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { getTicketBotActorId } from '@/utils/etaNotificationUtils';
import { recordTicketTimelineEvent } from '@/services/ticketTimelineEventService';
import { notifyEntryApprovers } from '@/services/stageTransition/stageEntryApproval';
import { maybeCreateEntryApprovalRequestTx } from '@/bypassAcl/transactions/stageEntryApproval';
import { ActivitySource } from '@/types/ticket';
import { resolveReleaseCompletionStage } from './resolveReleaseCompletionStage';

const LOG_PREFIX = '[ReleaseDevComplete]';

/**
 * Dev tickets in any of these statuses are moved when their release completes.
 * CANCELLED (Rejected group) is included on purpose: a ticket whose code shipped
 * in a completed release is, by definition, not rejected. COMPLETED is excluded
 * (already terminal-complete) — this also makes the hook idempotent and makes a
 * multi-release ticket close on whichever release completes first.
 */
export const RELEASE_COMPLETION_MOVABLE_STATUSES: readonly TicketStatusV2[] = [
  TicketStatusV2.TODO,
  TicketStatusV2.STARTED,
  TicketStatusV2.PAUSED,
  TicketStatusV2.CANCELLED,
];

export interface ReleaseCompletedParams {
  releaseTicketId: string;
  /** User who completed the release; recorded as closedBy. Falls back to the ticket bot. */
  completedBy?: string | null;
  /** When the release completed; recorded as closedAt. */
  completedAt: Date;
  /**
   * Backfill only: run even when ENABLE_RELEASE_DEV_TICKET_AUTO_COMPLETE is off.
   * Per-board `releaseCompletion.enabled=false` is still honoured.
   */
  ignoreGlobalFlag?: boolean;
}

export type DevTicketOutcome =
  | { ticketId: string; outcome: 'MOVED'; toStage: string; source: string }
  | { ticketId: string; outcome: 'APPROVAL_REQUESTED'; toStage: string }
  | { ticketId: string; outcome: 'SKIPPED'; reason: string }
  | { ticketId: string; outcome: 'FAILED'; error: string };

/** Board-level opt-out. Absent config / absent `enabled` → enabled. */
export function isReleaseCompletionEnabledForBoard(metadata: unknown): boolean {
  const rc = (metadata as BoardMetadata | null | undefined)?.releaseCompletion;
  return rc?.enabled !== false;
}

/**
 * Move every dev ticket bundled into a release (application_release_tickets,
 * populated by both commit-range and VERSION mapping) to a Completed-group
 * stage. Best-effort and per-ticket isolated: callers invoke it fire-and-forget
 * after the release-ticket status change has committed.
 */
async function onReleaseCompleted(params: ReleaseCompletedParams): Promise<DevTicketOutcome[]> {
  if (!config.enableReleaseDevTicketAutoComplete && !params.ignoreGlobalFlag) return [];

  // Service-scoped: the per-user tickets ACL would silently drop dev tickets the
  // release completer cannot see (private channels).
  const { release, devTicketIds } = await withWorkspaceScope(async () => {
    const release = await db.ticket.findUnique({
      where: { id: params.releaseTicketId },
      select: { id: true, xyneId: true, workspaceId: true, statusV2: true },
    });
    if (!release) return { release: null, devTicketIds: [] as string[] };
    const rows = await db.applicationReleaseTicket.findMany({
      where: { releaseId: release.id },
      select: { ticketId: true },
    });
    return { release, devTicketIds: Array.from(new Set(rows.map(r => r.ticketId))) };
  });
  if (!release || devTicketIds.length === 0) return [];
  // Re-check: a fast COMPLETED → STARTED flip must not close dev tickets.
  if (release.statusV2 !== TicketStatusV2.COMPLETED) {
    logger.info(`${LOG_PREFIX} release ${release.xyneId} no longer COMPLETED; skipping`);
    return [];
  }

  const botId = await getTicketBotActorId(release.workspaceId);
  const outcomes: DevTicketOutcome[] = [];
  for (const ticketId of devTicketIds) {
    try {
      outcomes.push(
        await completeDevTicket(ticketId, {
          releaseId: release.id,
          releaseXyneId: release.xyneId,
          botId,
          closedBy: params.completedBy || botId,
          closedAt: params.completedAt,
        }),
      );
    } catch (error) {
      logger.error(`${LOG_PREFIX} failed for dev ticket ${ticketId} (release ${release.xyneId}):`, error);
      outcomes.push({ ticketId, outcome: 'FAILED', error: error instanceof Error ? error.message : String(error) });
    }
  }

  const summary = outcomes.reduce<Record<string, number>>((acc, o) => {
    acc[o.outcome] = (acc[o.outcome] ?? 0) + 1;
    return acc;
  }, {});
  logger.info(`${LOG_PREFIX} release ${release.xyneId}: ${JSON.stringify(summary)}`, { outcomes });
  return outcomes;
}

interface CompleteCtx {
  releaseId: string;
  releaseXyneId: string;
  botId: string;
  closedBy: string;
  closedAt: Date;
}

async function completeDevTicket(ticketId: string, ctx: CompleteCtx): Promise<DevTicketOutcome> {
  const loaded = await withWorkspaceScope(async () => {
    const ticket = await db.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        workspaceId: true,
        boardId: true,
        stageName: true,
        statusV2: true,
        isArchived: true,
        conversationId: true,
        channelId: true,
      },
    });
    if (!ticket) return null;
    const [board, stages, transitions] = await Promise.all([
      db.board.findUnique({ where: { id: ticket.boardId }, select: { boardType: true, metadata: true } }),
      db.stage.findMany({
        where: { boardId: ticket.boardId },
        select: { id: true, name: true, sequenceNumber: true, defaultTicketStatusV2: true },
      }),
      db.stageTransition.findMany({
        where: { boardId: ticket.boardId },
        select: {
          id: true,
          fromStageId: true,
          toStageId: true,
          requiresApproval: true,
          bypassApprovalForAutomation: true,
        },
      }),
    ]);
    return { ticket, board, stages, transitions };
  });

  if (!loaded) return { ticketId, outcome: 'SKIPPED', reason: 'ticket not found' };
  const { ticket, board, stages, transitions } = loaded;
  if (ticket.isArchived) return { ticketId, outcome: 'SKIPPED', reason: 'archived' };
  if (!board) return { ticketId, outcome: 'SKIPPED', reason: 'board not found' };
  if (!isReleaseCompletionEnabledForBoard(board.metadata)) {
    return { ticketId, outcome: 'SKIPPED', reason: 'releaseCompletion disabled on board' };
  }
  if (!RELEASE_COMPLETION_MOVABLE_STATUSES.includes(ticket.statusV2 as TicketStatusV2)) {
    return { ticketId, outcome: 'SKIPPED', reason: `status ${ticket.statusV2}` };
  }

  const resolution = resolveReleaseCompletionStage({
    boardType: board.boardType,
    stages,
    transitions,
    standardPathStageIds: parseBoardEtaManagement(board.metadata, board.boardType).standardPathStageIds,
    currentStageName: ticket.stageName,
    configuredStageName: (board.metadata as BoardMetadata | null)?.releaseCompletion?.stageName ?? null,
  });
  if (resolution.kind === 'ALREADY_COMPLETED') {
    return { ticketId, outcome: 'SKIPPED', reason: 'already in a Completed stage' };
  }
  if (resolution.kind === 'NO_TARGET') {
    logger.warn(`${LOG_PREFIX} no target for ticket ${ticketId}: ${resolution.reason}`);
    return { ticketId, outcome: 'SKIPPED', reason: resolution.reason };
  }
  if (resolution.source === 'FALLBACK') {
    logger.warn(
      `${LOG_PREFIX} ticket ${ticketId} using FALLBACK stage "${resolution.stage.name}" (board ${ticket.boardId})`,
    );
  }

  const targetStage = resolution.stage;
  const wasRejected = ticket.statusV2 === TicketStatusV2.CANCELLED;

  // ── Approval gate on the edge INTO the target (NON_LINEAR only) ───────────
  // Intermediate gates are not evaluated (we jump directly). The final edge's
  // approval is honoured unless the board opted that edge into automation
  // bypass. The move runs as the ticket bot, never as the release completer, so
  // a completer who happens to be an approver cannot self-approve it.
  if (board.boardType === BoardType.NON_LINEAR) {
    const from = resolution.enteredFromStageId;
    const edge =
      (from && transitions.find(t => t.fromStageId === from && t.toStageId === targetStage.id))
      || transitions.find(t => t.fromStageId == null && t.toStageId === targetStage.id)
      || null;
    if (edge?.requiresApproval && !(edge.bypassApprovalForAutomation ?? false)) {
      return requestApproval(ticket, targetStage, edge, ctx);
    }
  }

  // ── Move ──────────────────────────────────────────────────────────────────
  // allowedCurrentStatuses turns this into a compare-and-swap on statusV2: a
  // concurrent manual close or a second release completing at the same time
  // makes this a no-op instead of a double transition.
  const repo = new TicketRepository();
  const updated = await repo.updateTicketStage(ticket.id, targetStage.name, ctx.botId, ActivitySource.AUTOMATION, undefined, {
    allowedCurrentStatuses: [...RELEASE_COMPLETION_MOVABLE_STATUSES],
  });
  if (!updated) return { ticketId, outcome: 'SKIPPED', reason: 'ticket changed concurrently' };

  // Closure analytics: only stamp when the move actually happened, and never
  // overwrite an existing closedAt.
  await withWorkspaceScope(() =>
    db.ticket.updateMany({
      where: { id: ticket.id, closedAt: null },
      data: { closedAt: ctx.closedAt, closedBy: ctx.closedBy },
    }),
  );

  if (ticket.conversationId) {
    const content = wasRejected
      ? `\u2705 Release ${ctx.releaseXyneId} completed — moved from Rejected stage "${ticket.stageName}" to "${targetStage.name}" because this ticket shipped in the release.`
      : `\u2705 Release ${ctx.releaseXyneId} completed — moved to "${targetStage.name}".`;
    await recordTicketTimelineEvent({
      message: {
        conversationId: ticket.conversationId,
        senderId: ctx.botId,
        content,
        activityType: ActivityType.STATUS,
        workspaceId: ticket.workspaceId,
        isAutomation: true,
        extraMetadata: {
          releaseTicketId: ctx.releaseId,
          releaseCompletion: { fromStage: ticket.stageName, toStage: targetStage.name, source: resolution.source },
        },
      },
    }).catch(error => logger.error(`${LOG_PREFIX} timeline message failed for ${ticket.id}:`, error));
  }

  return { ticketId, outcome: 'MOVED', toStage: targetStage.name, source: resolution.source };
}

async function requestApproval(
  ticket: { id: string; workspaceId: string; channelId: string | null; conversationId: string | null; stageName: string | null },
  targetStage: { id: string; name: string },
  edge: { id: string },
  ctx: CompleteCtx,
): Promise<DevTicketOutcome> {
  if (!ticket.conversationId || !ticket.stageName) {
    // The shared claim helper writes the audit message into the ticket thread.
    return { ticketId: ticket.id, outcome: 'SKIPPED', reason: 'approval required but ticket has no thread' };
  }
  let claimed = false;
  try {
    // Same atomic path as stage-entry approvals: locks the ticket row, re-checks
    // the stage, inserts or re-arms the (ticket, stage) request and writes the
    // "requested approval" system message in one transaction. Returns false if
    // a request is already SUBMITTED (idempotent across retries / re-completion).
    claimed = await maybeCreateEntryApprovalRequestTx(
      { id: ticket.id, conversationId: ticket.conversationId, workspaceId: ticket.workspaceId },
      targetStage.id,
      ticket.stageName,
      targetStage.name,
      ctx.botId,
      'Ticket Bot',
    );
  } catch (error) {
    // Concurrent claimer won the unique (ticketId, stageId) insert — benign.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
  }

  if (claimed) {
    await recordTicketTimelineEvent({
      message: {
        conversationId: ticket.conversationId,
        senderId: ctx.botId,
        content: `\u23F3 Release ${ctx.releaseXyneId} completed — waiting for approval to move to "${targetStage.name}".`,
        activityType: ActivityType.STATUS,
        workspaceId: ticket.workspaceId,
        isAutomation: true,
        extraMetadata: { releaseTicketId: ctx.releaseId, releaseCompletion: { toStage: targetStage.name, pendingApproval: true } },
      },
    }).catch(error => logger.error(`${LOG_PREFIX} timeline message failed for ${ticket.id}:`, error));
    await notifyEntryApprovers({ transitionId: edge.id }, ticket, targetStage.name, ctx.botId).catch(error =>
      logger.error(`${LOG_PREFIX} approver notify failed for ${ticket.id}:`, error),
    );
  }
  return { ticketId: ticket.id, outcome: 'APPROVAL_REQUESTED', toStage: targetStage.name };
}

export const releaseDevTicketCompletionService = { onReleaseCompleted };
