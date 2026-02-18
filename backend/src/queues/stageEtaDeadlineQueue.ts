import Bull from 'bull';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
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

// Job Types
export type StageEtaDeadlineJobType = 'check-stage-eta-deadlines';

export interface StageEtaDeadlineJobData {
  type: StageEtaDeadlineJobType;
}



const THIRTY_MIN_CRON = '*/30 * * * *';
// Window for initial breach notification (30 minutes)
const BREACH_WINDOW_MS = 30 * 60 * 1000;


class StageEtaDeadlineQueue {
  private queue: Bull.Queue<StageEtaDeadlineJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) {
      return;
    }

    this.isInitializing = true;

    try {
      this.queue = new Bull<StageEtaDeadlineJobData>('stage-eta-deadline-check', {
        redis: redisService.getRedisConfig(),
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      });

      this.setupProcessor();
      this.setupEventListeners();

      await this.scheduleRepeatableJob();

      this.isInitialized = true;
      logger.info('[STAGE-ETA-DEADLINE] Queue initialized successfully');
    } catch (error) {
      logger.error('[STAGE-ETA-DEADLINE] Failed to initialize queue:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  private async scheduleRepeatableJob(): Promise<void> {
    if (!this.queue) return;

    await this.queue.add(
      'check-stage-eta-deadlines',
      { type: 'check-stage-eta-deadlines' },
      {
        repeat: { cron: THIRTY_MIN_CRON },
        jobId: 'stage-eta-deadline-check-repeatable',
      }
    );
    logger.info('[STAGE-ETA-DEADLINE] Scheduled repeatable job: check-stage-eta-deadlines (every 30 mins)');
  }

  private setupProcessor(): void {
    if (!this.queue) return;

    this.queue.process('check-stage-eta-deadlines', async () => {
      logger.info('[STAGE-ETA-DEADLINE] Processing stage ETA deadline check job');
      await this.checkAndNotifyStageEtaDeadlines();
      logger.info('[STAGE-ETA-DEADLINE] Stage ETA deadline check completed');
    });
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, error) => {
      logger.error(`[STAGE-ETA-DEADLINE] Job ${job.name} failed:`, error);
    });

    this.queue.on('error', (error) => {
      logger.error('[STAGE-ETA-DEADLINE] Queue error:', error);
    });

    this.queue.on('stalled', (job) => {
      logger.warn(`[STAGE-ETA-DEADLINE] Job ${job.name} stalled`);
    });
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
      logger.error('[STAGE-ETA-DEADLINE] Error checking stage ETA deadlines:', error);
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
      },
    });
  }

  private async checkAndNotifyForStageEta(
    tickets: TicketWithStageInfo[],
    now: Date
  ): Promise<void> {
    // Get bot actorId for activities
    const actorId = await getTicketBotActorId();

    // Get active stage entries for these tickets
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
      select: { id: true, name: true },
    });

    const ticketMap = new Map(tickets.map(t => [t.id, t]));
    const stageMap = new Map(stages.map(s => [s.id, s]));

    for (const entry of activeStageEntries) {
      const ticket = ticketMap.get(entry.ticketId);
      const stage = stageMap.get(entry.stageId);

      if (!ticket || !stage) continue;

      // Get stage name from stage entry and compare with ticket's current stage
      if (!stage || stage.name !== ticket.stageName) continue;

      const stageEta = new Date(entry.stageEta!);

      // Check if stage ETA is breached
      if (stageEta > now) continue; // Not yet breached

      const timeSinceBreach = now.getTime() - stageEta.getTime();
      const daysOverdue = calculateDaysOverdueExact(stageEta, now);

      // Determine if we should send notification:
      // 1. Initial breach: within last 30 mins
      // 2. Follow-up: at same time every subsequent day (within 30 min window)
      const isInitialBreach = timeSinceBreach <= BREACH_WINDOW_MS;
      const isFollowUpTime = timeSinceBreach > BREACH_WINDOW_MS && isSameTimeDaily(stageEta, now);

      if (!isInitialBreach && !isFollowUpTime) continue;

      // Create message based on whether it's initial breach or follow-up
      const overdueText = daysOverdue === 0 ? 'due today' : `overdue (${daysOverdue} days)`;
      const message = isInitialBreach
        ? `Ticket ${ticket.xyneId} stage "${stage.name}" is ${overdueText}`
        : `Reminder: Ticket ${ticket.xyneId} stage "${stage.name}" is still ${overdueText}`;

      // Create activities for users using helper (includes assignedTo, createdBy, and form field users)
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

      // Send message
      if (ticket.conversationId) {
        await createEtaSystemMessage({
          conversationId: ticket.conversationId,
          content: message,
          createdAt: now,
          activityType: 'STAGE_ETA',
          stageId: stage.id,
        });
      }

      logger.info(
        `[STAGE-ETA-DEADLINE] ${isInitialBreach ? 'Initial breach' : 'Follow-up'} reminder for ticket ${ticket.xyneId} stage "${stage.name}" (${daysOverdue} days overdue)`
      );
    }
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.isInitialized = false;
      logger.info('[STAGE-ETA-DEADLINE] Queue closed');
    }
  }
}

export const stageEtaDeadlineQueue = new StageEtaDeadlineQueue();
