import { Prisma } from '@prisma/client';
import { ActivityType, BoardType, FormContextType, TicketStatusV2, parseBoardEtaManagement } from '@xyne/shared';
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
import { evaluateReleaseCompletionGates, type LinearStageGate } from './releaseCompletionGates';

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
  | { ticketId: string; outcome: 'APPROVAL_REQUESTED'; toStage: string; advancedTo?: string }
  | { ticketId: string; outcome: 'NEEDS_MANUAL_MOVE'; gate: 'FORM' | 'NOT_ALLOWED'; toStage: string; advancedTo?: string }
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
          formId: true,
          requiresApproval: true,
          bypassApprovalForAutomation: true,
        },
      }),
    ]);
    // Linear boards gate on the stage itself (form mapping / approvers), not on edges.
    const linearStageGates = new Map<string, LinearStageGate>();
    if (board && (board.boardType === BoardType.DEFAULT || board.boardType === BoardType.RELEASE)) {
      const stageIds = stages.map(s => s.id);
      const [forms, approvers] = await Promise.all([
        db.formContextMapping.findMany({
          where: { contextId: { in: stageIds }, contextType: FormContextType.STAGE },
          select: { contextId: true },
        }),
        db.stageApprovers.findMany({ where: { stageId: { in: stageIds } }, select: { stageId: true } }),
      ]);
      const withForm = new Set(forms.map(f => f.contextId));
      const withApprovers = new Set(approvers.map(a => a.stageId));
      for (const id of stageIds) {
        linearStageGates.set(id, { hasForm: withForm.has(id), hasApprovers: withApprovers.has(id) });
      }
    }
    return { ticket, board, stages, transitions, linearStageGates };
  });

  if (!loaded) return { ticketId, outcome: 'SKIPPED', reason: 'ticket not found' };
  const { ticket, board, stages, transitions, linearStageGates } = loaded;
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
  const stageById = new Map(stages.map(s => [s.id, s]));
  const currentStageId = stages.find(s => s.name === ticket.stageName)?.id ?? null;

  // ── Gates along the whole route, not just the final edge ──────────────────
  // The write is a single jump, so every hop the ticket would have taken is
  // checked first. The first hop that needs a human (form, approval without
  // automation bypass, or no allowed edge) stops the move there.
  const gates = evaluateReleaseCompletionGates({
    boardType: board.boardType,
    currentStageId,
    path: resolution.path,
    transitions,
    linearStageGates,
  });

  // Advance as far as the route is clear: to the target when nothing blocks,
  // otherwise to the stage just before the first gate (if that is not where the
  // ticket already is). Runs as the ticket bot, never as the release completer,
  // so a completer who happens to be an approver cannot self-approve a gate.
  const stopStageId = gates.kind === 'CLEAR' ? targetStage.id : gates.fromStageId;
  const stopStage = stopStageId ? stageById.get(stopStageId) ?? null : null;
  let advancedTo: string | undefined;
  if (stopStage && stopStage.id !== currentStageId) {
    // allowedCurrentStatuses turns this into a compare-and-swap on statusV2: a
    // concurrent manual close or a second release completing at the same time
    // makes this a no-op instead of a double transition. closedAt/closedBy are
    // derived inside the same write when the stop stage is Completed-group.
    const repo = new TicketRepository();
    const updated = await repo.updateTicketStage(ticket.id, stopStage.name, ctx.botId, ActivitySource.AUTOMATION, undefined, {
      allowedCurrentStatuses: [...RELEASE_COMPLETION_MOVABLE_STATUSES],
    });
    if (!updated) return { ticketId, outcome: 'SKIPPED', reason: 'ticket changed concurrently' };
    advancedTo = stopStage.name;
  }

  if (gates.kind === 'BLOCKED') {
    const gatedStage = stageById.get(gates.toStageId)!;
    const atStageName = advancedTo ?? ticket.stageName;
    if (gates.gate === 'APPROVAL') {
      return requestApproval(
        { ...ticket, stageName: atStageName },
        gatedStage,
        gates.transitionId ? { transitionId: gates.transitionId } : { stageId: gatedStage.id },
        ctx,
        advancedTo,
      );
    }
    await postTimeline(ticket, ctx, {
      content:
        gates.gate === 'FORM'
          ? `\u26A0\uFE0F Release ${ctx.releaseXyneId} completed — ${advancedTo ? `moved to "${advancedTo}", but ` : ''}moving to "${gatedStage.name}" needs a form, so this ticket must be moved manually.`
          : `\u26A0\uFE0F Release ${ctx.releaseXyneId} completed — the board does not allow moving from "${atStageName}" to "${gatedStage.name}", so this ticket must be moved manually.`,
      extra: { releaseCompletion: { fromStage: ticket.stageName, advancedTo: advancedTo ?? null, blockedAt: gatedStage.name, gate: gates.gate } },
    });
    return { ticketId, outcome: 'NEEDS_MANUAL_MOVE', gate: gates.gate, toStage: gatedStage.name, ...(advancedTo && { advancedTo }) };
  }

  // Closure attribution: the move above stamped closedAt/closedBy as the ticket
  // bot. Re-attribute to the release completer and release time, but only for
  // the stamp this move just wrote (closedBy still the bot).
  await withWorkspaceScope(() =>
    db.ticket.updateMany({
      where: { id: ticket.id, statusV2: TicketStatusV2.COMPLETED, closedBy: ctx.botId },
      data: { closedAt: ctx.closedAt, closedBy: ctx.closedBy },
    }),
  );

  await postTimeline(ticket, ctx, {
    content: wasRejected
      ? `\u2705 Release ${ctx.releaseXyneId} completed — moved from Rejected stage "${ticket.stageName}" to "${targetStage.name}" because this ticket shipped in the release.`
      : `\u2705 Release ${ctx.releaseXyneId} completed — moved to "${targetStage.name}".`,
    extra: { releaseCompletion: { fromStage: ticket.stageName, toStage: targetStage.name, source: resolution.source } },
  });

  return { ticketId, outcome: 'MOVED', toStage: targetStage.name, source: resolution.source };
}

type TimelineTicket = { id: string; workspaceId: string; conversationId: string | null };

/** Best-effort system message in the dev ticket thread, linked back to the release ticket. */
async function postTimeline(
  ticket: TimelineTicket,
  ctx: CompleteCtx,
  msg: { content: string; extra: Record<string, unknown> },
): Promise<void> {
  if (!ticket.conversationId) return;
  await recordTicketTimelineEvent({
    message: {
      conversationId: ticket.conversationId,
      senderId: ctx.botId,
      content: msg.content,
      activityType: ActivityType.STATUS,
      workspaceId: ticket.workspaceId,
      isAutomation: true,
      extraMetadata: { releaseTicketId: ctx.releaseId, ...msg.extra },
    },
  }).catch(error => logger.error(`${LOG_PREFIX} timeline message failed for ${ticket.id}:`, error));
}

async function requestApproval(
  ticket: { id: string; workspaceId: string; channelId: string | null; conversationId: string | null; stageName: string | null },
  targetStage: { id: string; name: string },
  approversWhere: { transitionId: string } | { stageId: string },
  ctx: CompleteCtx,
  advancedTo: string | undefined,
): Promise<DevTicketOutcome> {
  const base = { ticketId: ticket.id, ...(advancedTo && { advancedTo }) };
  if (!ticket.conversationId || !ticket.stageName) {
    // The shared claim helper writes the audit message into the ticket thread.
    return { ...base, outcome: 'SKIPPED', reason: 'approval required but ticket has no thread' } as DevTicketOutcome;
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
    await postTimeline(ticket, ctx, {
      content: `\u23F3 Release ${ctx.releaseXyneId} completed — ${advancedTo ? `moved to "${advancedTo}" and ` : ''}waiting for approval to move to "${targetStage.name}".`,
      extra: { releaseCompletion: { advancedTo: advancedTo ?? null, toStage: targetStage.name, pendingApproval: true } },
    });
    await notifyEntryApprovers(approversWhere, ticket, targetStage.name, ctx.botId).catch(error =>
      logger.error(`${LOG_PREFIX} approver notify failed for ${ticket.id}:`, error),
    );
  }
  return { ...base, outcome: 'APPROVAL_REQUESTED', toStage: targetStage.name };
}

export const releaseDevTicketCompletionService = { onReleaseCompleted };
