import { Prisma } from '@prisma/client';
import { logger } from '@/utils/logger';
import { db, readReplicaDb } from '@/database/client';
import { runAsServiceActor } from '@/database/tenant/context';
import { stageEtaDeadlineQueue } from '@/queues/stageEtaDeadlineQueue';
import {
  getTicketBotActorId,
  TicketWithStageInfo,
  OPEN_STATUSES,
} from '@/utils/etaNotificationUtils';
import {
  parseBoardEtaManagement,
  parseTicketEtaManagement,
  mergeTicketEtaManagement,
  BoardType,
} from '@xyne/shared';
import { recordTicketTimelineEvent } from '@/services/ticketTimelineEventService';
import {
  evaluatePlanningRisk,
  buildRiskTransitionActivityIntents,
  dispatchEtaNotifications,
  etaSignalsFromResult,
  isEtaManagementKillSwitchActive,
} from '@/services/etaManagement';

interface TicketForReconciliation extends TicketWithStageInfo {
  boardId: string;
  userGroupId: string | null;
  statusV2: string;
  metadata: unknown;
}

// Batching for the bulk `isStageOverdue` flag sync.
const BATCH_SIZE = parseInt(process.env.STAGE_ETA_DEADLINE_BATCH_SIZE || '15', 10);
const BATCH_SLEEP_MS = parseInt(process.env.STAGE_ETA_DEADLINE_BATCH_SLEEP_MS || '1000', 10);

// Batching for the planning-risk reconciliation pass, which does per-ticket writes
// (metadata + timeline + notifications) rather than a bulk `updateMany`.
const STAGE_ETA_REMINDER_BATCH_SIZE = 15;
const STAGE_ETA_REMINDER_BATCH_DELAY_MS = 1000;

const chunkArray = <T>(items: T[], chunkSize: number): T[][] => {
  if (chunkSize <= 0) return [items];
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

class StageEtaDeadlineWorker {
  private isInitialized = false;
  private isProcessing = false;

  async start(): Promise<void> {
    if (this.isInitialized) return;

    await stageEtaDeadlineQueue.initialize();

    const queue = stageEtaDeadlineQueue.getQueue();

    queue.process('check-stage-eta-deadlines', async () => {
      if (this.isProcessing) {
        logger.warn(
          '[STAGE-ETA-DEADLINE-WORKER] Skipping job: previous job still in progress',
        );
        return;
      }
      return this.processJob();
    });

    queue.on('failed', (job, err) => {
      logger.error(
        `[STAGE-ETA-DEADLINE-WORKER] Job ${job.id} failed:`,
        err,
      );
    });

    this.isInitialized = true;
    logger.info('[STAGE-ETA-DEADLINE-WORKER] Started, ready to process jobs');
  }

  private async processJob(): Promise<void> {
    this.isProcessing = true;
    try {
      logger.info(
        '[STAGE-ETA-DEADLINE-WORKER] Processing stage ETA deadline check job',
      );
      const now = new Date();
      // Two independent passes over the same hourly tick, split by which side of `now`
      // the active visit's deadline falls on: already-breached visits drive the
      // denormalized `isStageOverdue` flag, not-yet-breached ones drive planning-risk
      // reconciliation.
      await this.syncStageOverdueFlags(now);
      await this.reconcileOpenTicketPlanningRisk(now);
      logger.info('[STAGE-ETA-DEADLINE-WORKER] Stage ETA deadline check completed');
    } catch (error) {
      logger.error('[STAGE-ETA-DEADLINE-WORKER] Error checking stage ETA deadlines:', error);
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }

  private async syncStageOverdueFlags(now: Date = new Date()): Promise<void> {
    const overdueTicketIds = await this.getOverdueTicketIds(now);

    if (overdueTicketIds.length === 0) return;

    for (let i = 0; i < overdueTicketIds.length; i += BATCH_SIZE) {
      const batchIds = overdueTicketIds.slice(i, i + BATCH_SIZE);
      await db.$executeRaw`
        UPDATE "tickets"
        SET "isStageOverdue" = true
        WHERE "id" IN (${Prisma.join(batchIds)})
          AND ("isStageOverdue" = false OR "isStageOverdue" IS NULL)
      `;
      if (i + BATCH_SIZE < overdueTicketIds.length) {
        await sleep(BATCH_SLEEP_MS);
      }
    }
  }

  private async getOverdueTicketIds(now: Date): Promise<string[]> {
    const readerDb = readReplicaDb ?? db;
    const allOverdueTicketIds: string[] = [];
    const QUERY_BATCH_SIZE = 10000;
    let cursor: string | undefined;

    while (true) {
      const overdueEntries = await readerDb.ticketStageEta.findMany({
        where: {
          stageLeftAt: null,
          stageEta: { lte: now },
          // Ensure stage exists (filters out orphaned records with deleted stages)
          // ticket is implicitly checked via the statusV2 filter (JOIN filters out missing tickets)
          stage: { id: { not: '' } },
          ticket: {
            statusV2: { in: OPEN_STATUSES },
            // Only fetch tickets not already marked as overdue
            OR: [
              { isStageOverdue: false },
              { isStageOverdue: null },
            ],
          } as any,
        },
        select: {
          id: true,
          ticketId: true,
          stage: { select: { name: true } },
          ticket: { select: { stageName: true } },
        },
        take: QUERY_BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
      });

      if (overdueEntries.length === 0) break;

      // Filter to only tickets still in the overdue stage (stage name matches current stage)
      // Also skip entries with missing relations (orphaned records)
      const filteredIds = (overdueEntries as any[])
        .filter(entry => entry.stage?.name && entry.ticket?.stageName && entry.stage.name === entry.ticket.stageName)
        .map(entry => entry.ticketId);

      allOverdueTicketIds.push(...filteredIds);

      if (overdueEntries.length < QUERY_BATCH_SIZE) break;

      cursor = overdueEntries[overdueEntries.length - 1].id;
    }

    return allOverdueTicketIds;
  }

  /**
   * Loads the not-yet-breached active visits (`stageEta > now`) that planning-risk
   * reconciliation operates on. Deliberately the complement of `getOverdueTicketIds`:
   * once a stage deadline is breached it stops being a *planning* risk and becomes a
   * stage-overdue condition, which the flag sync above owns.
   */
  private async reconcileOpenTicketPlanningRisk(now: Date): Promise<void> {
    if (isEtaManagementKillSwitchActive()) return;

    // Tickets whose overall ETA is already breached are excluded - the daily
    // ticket-overdue worker owns those, and ticket-overdue outranks planning risk.
    const todayMidnight = new Date(now);
    todayMidnight.setHours(0, 0, 0, 0);

    const entries = await db.ticketStageEta.findMany({
      where: {
        stageLeftAt: null,
        stageEta: { gt: now },
        ticket: {
          statusV2: { in: OPEN_STATUSES },
          OR: [
            { eta: null },
            { eta: { gte: todayMidnight } },
          ],
        },
      },
      select: {
        id: true,
        ticketId: true,
        stageId: true,
        stageEta: true,
        stageEnteredAt: true,
        ticket: {
          select: {
            id: true,
            xyneId: true,
            assignedTo: true,
            createdBy: true,
            channelId: true,
            conversationId: true,
            stageName: true,
            eta: true,
            workspaceId: true,
            boardId: true,
            userGroupId: true,
            statusV2: true,
            metadata: true,
          },
        },
      },
    });

    if (entries.length === 0) return;

    const ticketMap = new Map<string, TicketForReconciliation>(
      entries.map(e => [e.ticketId, e.ticket as TicketForReconciliation]),
    );

    const stageIds = [...new Set(entries.map(e => e.stageId))];
    const stages = await db.stage.findMany({
      where: { id: { in: stageIds } },
      select: { id: true, name: true, eta: true },
    });
    const stageMap = new Map(stages.map(s => [s.id, s]));

    await this.reconcilePlanningRisk(entries, ticketMap, stageMap, now);
  }

  /**
   * Scheduled counterpart to the immediate planning-risk evaluation wired into every ticket
   * mutation path (services/etaManagement).
   *
   * Note it is NOT the clock that creates work here: the risk condition includes
   * `now <= stageDeadline`, so as time passes the condition can only go true -> false. Time
   * ends a planning risk (it becomes stage-overdue); it can never start one. What this pass
   * catches is risk state that has gone stale against its current inputs, in the cases where
   * the thing that changed was not a ticket mutation:
   *
   *   - Tickets never evaluated at all - written before this feature existed, or by a path
   *     that doesn't run the immediate evaluation (imports, flow cascades). Their metadata
   *     parses to state NONE even though the condition is already true.
   *   - A board ETA-config change: it bumps `configVersion`, which changes the risk
   *     fingerprint of every ticket on that board without touching a single ticket row, so
   *     nothing else would ever notice it.
   *
   * Scope is deliberately the pre-breach window only - the loader filters `stageEta > now`,
   * so a visit whose deadline has already passed is not seen here at all; that is
   * stage-overdue, owned by syncStageOverdueFlags. One consequence: a risk that was ACTIVE
   * when its deadline passed keeps that state until the ticket's next mutation. It is
   * masked in the UI (stage-overdue outranks planning risk), but the stored state is stale.
   *
   * Read-only with respect to `Ticket.eta`/forecasts: it only ever updates the persisted
   * planning-risk state, never extends a due date.
   */
  private async reconcilePlanningRisk(
    entries: Array<{
      id: string;
      ticketId: string;
      stageId: string;
      stageEta: Date;
      stageEnteredAt: Date;
    }>,
    ticketMap: Map<string, TicketForReconciliation>,
    stageMap: Map<string, { id: string; name: string; eta: number | null }>,
    now: Date,
  ): Promise<void> {
    if (entries.length === 0) return;

    const boardIds = [
      ...new Set(
        entries
          .map(e => ticketMap.get(e.ticketId)?.boardId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const boards = await db.board.findMany({
      where: { id: { in: boardIds } },
      select: { id: true, boardType: true, metadata: true },
    });
    const boardMap = new Map(boards.map(b => [b.id, b]));

    const metrics = { detected: 0, reopened: 0, resolved: 0, skippedStale: 0, evaluated: 0 };
    const startedAt = Date.now();

    const batches = chunkArray(entries, STAGE_ETA_REMINDER_BATCH_SIZE);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batch = batches[batchIndex]!;

      for (const entry of batch) {
        const ticket = ticketMap.get(entry.ticketId);
        if (!ticket) continue;

        const board = boardMap.get(ticket.boardId);
        // Flow boards are deferred this release; detection must not synthesize forecasts/
        // visits there. Non-linear/Release boards are fine here since we only ever compare
        // the ticket's OWN active visit deadline against its due date - no route needed.
        if (!board || board.boardType === BoardType.FLOW) continue;

        // Guard against a stale/orphaned open entry left over from a stage transition that
        // didn't close it (same check the overdue branch above applies) - only evaluate risk
        // against the entry that matches the ticket's actual current stage.
        const stage = stageMap.get(entry.stageId);
        if (!stage || stage.name !== ticket.stageName) continue;

        const boardEtaManagement = parseBoardEtaManagement(board.metadata);
        const currentTicketEtaManagement = parseTicketEtaManagement(ticket.metadata);
        const deadlineTracked = entry.stageEta.getTime() !== entry.stageEnteredAt.getTime();

        metrics.evaluated += 1;
        const decision = evaluatePlanningRisk({
          ticketId: ticket.id,
          activeStageVisitId: entry.id,
          stageDeadline: entry.stageEta,
          deadlineTracked,
          ticketDue: ticket.eta,
          ticketStatus: ticket.statusV2,
          boardConfigVersion: boardEtaManagement.configVersion,
          now,
          currentRisk: currentTicketEtaManagement.planningRisk,
          isTerminal: false, // OPEN_STATUSES excludes COMPLETED/CANCELLED already
        });

        if (decision.transitionKind === 'UNCHANGED') continue;

        // Re-check the persisted fingerprint under a row lock and write in the same
        // transaction, so an overlapping run or a retry can't pass the check and then
        // both write. Without the lock this is check-then-write: two workers could
        // duplicate the risk activities and notify twice for one fingerprint.
        const systemActorId = await getTicketBotActorId(ticket.workspaceId);
        const committed = await runAsServiceActor(
          'stage-eta-deadline-worker',
          ticket.workspaceId,
          async () =>
            db.$transaction(async tx => {
              const [locked] = await tx.$queryRaw<{ metadata: unknown }[]>`
                SELECT "metadata"
                FROM "tickets"
                WHERE "id" = ${ticket.id}
                FOR UPDATE
              `;
              const freshRisk = parseTicketEtaManagement(locked?.metadata).planningRisk;
              if (freshRisk.fingerprint !== currentTicketEtaManagement.planningRisk.fingerprint) {
                return false;
              }

              const mergedMetadata = mergeTicketEtaManagement(locked?.metadata, {
                planningRisk: decision.nextState,
              });
              await tx.ticket.update({
                where: { id: ticket.id },
                data: { metadata: mergedMetadata as Prisma.InputJsonValue },
              });

              const intents = buildRiskTransitionActivityIntents(decision, {
                currentStageId: entry.stageId,
                oldEta: ticket.eta ? ticket.eta.getTime() : null,
                boardConfigVersion: boardEtaManagement.configVersion,
                trigger: 'RECONCILIATION',
                systemReason: 'Hourly reconciliation detected a planning-risk state change',
                previousRiskFingerprint: currentTicketEtaManagement.planningRisk.fingerprint,
              });
              for (const intent of intents) {
                await recordTicketTimelineEvent(
                  {
                    activity: {
                      ticketId: ticket.id,
                      updatedBy: systemActorId,
                      activityType: intent.activityType,
                      value: intent.value as Prisma.InputJsonValue,
                      workspaceId: ticket.workspaceId,
                      channelId: ticket.channelId,
                    },
                  },
                  tx,
                );
              }
              return true;
            }),
        );

        if (!committed) {
          metrics.skippedStale += 1;
          continue;
        }

        // Post-commit, and never while paused. Only the run that actually won the lock
        // reaches here, so one fingerprint notifies once.
        if (ticket.statusV2 !== 'PAUSED') {
          await runAsServiceActor('stage-eta-deadline-worker', ticket.workspaceId, () =>
            dispatchEtaNotifications(
              etaSignalsFromResult({ etaDecision: { newEta: null, changed: false }, planningRisk: decision }),
              {
                ticketId: ticket.id,
                createdBy: ticket.createdBy ?? systemActorId,
                assignedTo: ticket.assignedTo,
                ticketUserGroupId: ticket.userGroupId,
                boardId: ticket.boardId,
                actorId: systemActorId,
              },
            ),
          );
        }

        if (decision.transitionKind === 'DETECTED') metrics.detected += 1;
        else if (decision.transitionKind === 'REOPENED') metrics.reopened += 1;
        else if (decision.transitionKind === 'RESOLVED') metrics.resolved += 1;
      }

      if (batchIndex < batches.length - 1) {
        await sleep(STAGE_ETA_REMINDER_BATCH_DELAY_MS);
      }
    }

    logger.info('[STAGE-ETA-DEADLINE-WORKER] Planning-risk reconciliation complete', {
      ...metrics,
      durationMs: Date.now() - startedAt,
    });
  }


  async shutdown(): Promise<void> {
    await stageEtaDeadlineQueue.close();
    this.isInitialized = false;
    logger.info('[STAGE-ETA-DEADLINE-WORKER] Shut down');
  }
}

export const stageEtaDeadlineWorker = new StageEtaDeadlineWorker();
