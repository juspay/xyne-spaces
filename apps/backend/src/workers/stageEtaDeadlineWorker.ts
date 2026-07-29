import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { runWithContext } from '@/database/tenant/context';
import { stageEtaDeadlineQueue } from '@/queues/stageEtaDeadlineQueue';
import { TicketsSideEffectHandler } from '@/zero/side-effects/tables/tickets-handler';
import {
  getUsersToNotifyForTicket,
  getTicketBotActorId,
  isSameTimeDaily,
  calculateDaysOverdueExact,
  createEtaSystemMessage,
  TicketWithStageInfo,
  OPEN_STATUSES,
} from '@/utils/etaNotificationUtils';

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

  private async getOpenTickets(now: Date): Promise<TicketWithStageInfo[]> {
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
      },
    });
  }

  private async checkAndNotifyForStageEta(
    tickets: TicketWithStageInfo[],
    now: Date
  ): Promise<void> {
    // Get active stage entries for these tickets
    const activeStageEntries = await db.ticketStageEta.findMany({
      where: {
        ticketId: { in: tickets.map(t => t.id) },
        stageLeftAt: null,
        stageEta: { lte: now },
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

    const entryBatches = chunkArray(activeStageEntries, STAGE_ETA_REMINDER_BATCH_SIZE);

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
          await runWithContext(
            { userId: 'stage-eta-deadline-worker', workspaceId: ticket.workspaceId },
            () => createEtaSystemMessage({
              conversationId: ticket.conversationId!,
              content: message,
              createdAt: now,
              activityType: 'STAGE_ETA',
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

  async shutdown(): Promise<void> {
    await stageEtaDeadlineQueue.close();
    this.isInitialized = false;
    logger.info('[STAGE-ETA-DEADLINE-WORKER] Shut down');
  }
}

export const stageEtaDeadlineWorker = new StageEtaDeadlineWorker();
