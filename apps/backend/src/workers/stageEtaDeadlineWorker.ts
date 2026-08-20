import type { Prisma } from '@prisma/client';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { runAsServiceActor } from '@/database/tenant/context';
import { stageEtaDeadlineQueue } from '@/queues/stageEtaDeadlineQueue';
import { TicketsSideEffectHandler } from '@/zero/side-effects/tables/tickets-handler';
import {
  ActivityType,
  parseBoardEtaManagement,
  parseTicketEtaManagement,
  mergeTicketEtaManagement,
  BoardType,
} from '@xyne/shared';
import {
  getUsersToNotifyForTicket,
  getTicketBotActorId,
  isSameTimeDaily,
  calculateDaysOverdueExact,
  createEtaSystemMessage,
  TicketWithStageInfo,
  OPEN_STATUSES,
} from '@/utils/etaNotificationUtils';
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

// Window for initial breach notification (30 minutes)
const BREACH_WINDOW_MS = 30 * 60 * 1000;
const STAGE_ETA_REMINDER_BATCH_SIZE = 50;
const STAGE_ETA_REMINDER_BATCH_DELAY_MS = 1000;

const chunkArray = <T>(items: T[], chunkSize: number): T[][] => {
  if (chunkSize <= 0) return [items];
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
};

const sleep = async (ms: number): Promise<void> => {
  if (ms <= 0) return;
  await new Promise(resolve => setTimeout(resolve, ms));
};

class StageEtaDeadlineWorker {
  private isInitialized = false;

  async start(): Promise<void> {
    if (this.isInitialized) return;

    await stageEtaDeadlineQueue.initialize();

    const queue = stageEtaDeadlineQueue.getQueue();

    queue.process('check-stage-eta-deadlines', async () => {
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
    logger.info(
      '[STAGE-ETA-DEADLINE-WORKER] Processing stage ETA deadline check job',
    );
    await this.checkAndNotifyStageEtaDeadlines();
    logger.info('[STAGE-ETA-DEADLINE-WORKER] Stage ETA deadline check completed');
  }

  private async checkAndNotifyStageEtaDeadlines(): Promise<void> {
    const now = new Date();

    try {
      // 1. Get open tickets with stage info, excluding tickets where overall ETA is breached
      const tickets = await this.getOpenTickets(now);
      
      if (tickets.length === 0) return;

      // 3. Check stage ETA for remaining tickets and create activities
      await this.checkAndNotifyForStageEta(tickets, now);
    } catch (error) {
      logger.error('[STAGE-ETA-DEADLINE-WORKER] Error checking stage ETA deadlines:', error);
      throw error;
    }
  }

  private async getOpenTickets(now: Date): Promise<TicketForReconciliation[]> {
    // Get today at midnight for date comparison
    const todayMidnight = new Date(now);
    todayMidnight.setHours(0, 0, 0, 0);

    return await db.ticket.findMany({
      where: {
        statusV2: { in: OPEN_STATUSES },
        // Exclude tickets where overall ETA is breached (eta < today at midnight)
        OR: [
          { eta: null },
          { eta: { gte: todayMidnight } },
        ],
      },
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
    });
  }

  private async checkAndNotifyForStageEta(
    tickets: TicketForReconciliation[],
    now: Date
  ): Promise<void> {
    // Fetch the FULL active-visit set once (no stageEta filter) and branch below into
    // "overdue" (stageEta <= now, existing breach-reminder logic) vs. "planning-risk"
    // (stageEta > now, new reconciliation) - avoids a second query over the same rows.
    const activeStageEntries = await db.ticketStageEta.findMany({
      where: {
        ticketId: { in: tickets.map(t => t.id) },
        stageLeftAt: null,
      },
    });

    if (activeStageEntries.length === 0) return;

    // Get stage info
    const stageIds = [...new Set(activeStageEntries.map(e => e.stageId))];
    const stages = await db.stage.findMany({
      where: { id: { in: stageIds } },
      select: { id: true, name: true, eta: true },
    });

    const ticketMap = new Map(tickets.map(t => [t.id, t]));
    const stageMap = new Map(stages.map(s => [s.id, s]));

    const overdueEntries = activeStageEntries.filter(e => e.stageEta.getTime() <= now.getTime());
    const planningRiskCandidateEntries = activeStageEntries.filter(
      e => e.stageEta.getTime() > now.getTime(),
    );

    if (!isEtaManagementKillSwitchActive()) {
      await this.reconcilePlanningRisk(planningRiskCandidateEntries, ticketMap, stageMap, now);
    }

    const entryBatches = chunkArray(overdueEntries, STAGE_ETA_REMINDER_BATCH_SIZE);

    for (let batchIndex = 0; batchIndex < entryBatches.length; batchIndex += 1) {
      const entryBatch = entryBatches[batchIndex]!;

      logger.info(
        `[STAGE-ETA-DEADLINE-WORKER] Processing stage ETA batch ${batchIndex + 1}/${entryBatches.length} (${entryBatch.length} entries)`
      );

      for (const entry of entryBatch) {
        const ticket = ticketMap.get(entry.ticketId);
        const stage = stageMap.get(entry.stageId);

        if (!ticket || !stage) continue;

        const actorId = await getTicketBotActorId(ticket.workspaceId);

        // Skip if stage ETA is not set on the board (ETA was disabled after entry was created)
        if (stage.eta === null || stage.eta === 0) continue;

        // Get stage name from stage entry and compare with ticket's current stage
        if (stage.name !== ticket.stageName) continue;

        const stageEta = new Date(entry.stageEta!);
        if (stageEta > now) continue;

        const timeSinceBreach = now.getTime() - stageEta.getTime();
        const daysOverdue = calculateDaysOverdueExact(stageEta, now);
        const isInitialBreach = timeSinceBreach <= BREACH_WINDOW_MS;
        const isFollowUpTime = timeSinceBreach > BREACH_WINDOW_MS && isSameTimeDaily(stageEta, now);

        if (!isInitialBreach && !isFollowUpTime) continue;

        const overdueText = daysOverdue === 0 ? 'due today' : `overdue (${daysOverdue} days)`;
        const message = isInitialBreach
          ? `Ticket ${ticket.xyneId} stage "${stage.name}" is ${overdueText}`
          : `Reminder: Ticket ${ticket.xyneId} stage "${stage.name}" is still ${overdueText}`;

        const usersToNotify = await getUsersToNotifyForTicket(
          ticket.id,
          ticket.assignedTo,
          ticket.createdBy
        );

        await TicketsSideEffectHandler.createEtaBreachActivities({
          ticketId: ticket.id,
          xyneId: ticket.xyneId,
          channelId: ticket.channelId,
          userIds: usersToNotify,
          actorAction: 'stage_eta_breach',
          actorId,
          stageName: stage.name,
          daysOverdue,
        });

        if (ticket.conversationId) {
          await runAsServiceActor('stage-eta-deadline-worker', ticket.workspaceId,
            () => createEtaSystemMessage({
              conversationId: ticket.conversationId!,
              content: message,
              createdAt: now,
              activityType: ActivityType.STAGE_ETA,
              stageId: stage.id,
            }),
          );
        }

        logger.info(
          `[STAGE-ETA-DEADLINE-WORKER] ${isInitialBreach ? 'Initial breach' : 'Follow-up'} reminder for ticket ${ticket.xyneId} stage "${stage.name}" (${daysOverdue} days overdue)`
        );
      }

      if (batchIndex < entryBatches.length - 1) {
        await sleep(STAGE_ETA_REMINDER_BATCH_DELAY_MS);
      }
    }
  }

  /**
   * Scheduled counterpart to the immediate planning-risk evaluation wired into every ticket
   * mutation path (services/etaManagement). Catches risk that appears purely from time
   * passing, with no new mutation event - e.g. a ticket due date that quietly falls behind
   * the current stage deadline while nothing else about the ticket changes. Read-only with
   * respect to `Ticket.eta`/forecasts: it only ever updates the persisted planning-risk
   * state, never extends a due date.
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
