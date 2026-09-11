import Bull from 'bull';
import { logger } from '@/utils/logger';
import { DatabaseClient } from '@/database/client';
import { repositories } from '@/database/repositories';
import { evaluateAssignmentRule, AssignmentType } from '@/utils/assignmentEngine';
import { handleTicketAssignmentChange } from '@/utils/workloadUtils';
import { getAutomationsBotUserId } from '@/automations/steps/automations-bot';
import { TicketStatusV2 } from '@xyne/shared';

const prisma = DatabaseClient.getInstance();

export interface TicketReassignmentJobData {
  type: 'reassign-user-tickets';
  userId: string;
  userGroupId: string;
}

const OPEN_STATUSES: string[] = [TicketStatusV2.TODO, TicketStatusV2.STARTED];
const BATCH_SIZE = 50;

class TicketReassignmentQueue {
  private queue: Bull.Queue<TicketReassignmentJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) {
      return;
    }

    this.isInitializing = true;

    try {
      const redisConfig = {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        maxRetriesPerRequest: 3,
        ...(process.env.REDIS_PASSWORD && { password: process.env.REDIS_PASSWORD }),
        ...(process.env.REDIS_TLS === 'true' && {
          tls: {
            rejectUnauthorized: false
          }
        })
      };

      this.queue = new Bull<TicketReassignmentJobData>('ticket-reassignment', {
        redis: redisConfig,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
        settings: {
          lockDuration: 300000,     // Long-running (paginates all of a user's open tickets); 5 min lock
          stalledInterval: 30000,
          maxStalledCount: 2,
        },
      });

      this.setupProcessor();
      this.setupEventListeners();

      this.isInitialized = true;
      logger.info('✓ TicketReassignmentQueue initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize ticket reassignment queue:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Enqueue reassignment of every open ticket assigned to `userId` within `userGroupId`.
   * One job per (userGroupId, userId) pair - re-scheduling collapses onto the same jobId
   * instead of piling up duplicate work.
   */
  async scheduleReassignment(userId: string, userGroupId: string): Promise<void> {
    if (!this.queue) {
      throw new Error('Queue not initialized');
    }

    try {
      const jobId = `reassign-${userGroupId}-${userId}`;

      // Bull silently ignores an add whose jobId already exists, and this queue keeps
      // failed jobs (removeOnFail: false). Without this, one run that exhausted its
      // retries - or stalled out past maxStalledCount - would block every later
      // reassignment for the same pair forever, while callers still see success.
      // Only failed jobs need clearing: removeOnComplete drops successful ones already.
      // Best effort: waiting/active/delayed jobs are left alone so re-scheduling still
      // collapses onto them, and losing the race to an active job is harmless.
      try {
        const existing = await this.queue.getJob(jobId);
        if (existing && (await existing.isFailed())) {
          await existing.remove();
          logger.warn(`⚠️ [TICKET-REASSIGNMENT] Cleared stale job ${jobId} before re-enqueue`);
        }
      } catch (error) {
        logger.warn(
          `⚠️ [TICKET-REASSIGNMENT] Could not clear existing job ${jobId}; continuing to enqueue:`,
          error
        );
      }

      await this.queue.add(
        'reassign-user-tickets',
        { type: 'reassign-user-tickets', userId, userGroupId },
        { jobId },
      );

      logger.info(
        `⏳ [TICKET-REASSIGNMENT] Scheduled reassignment of open tickets for user ${userId} in group ${userGroupId}`
      );
    } catch (error) {
      logger.error(`❌ [TICKET-REASSIGNMENT] Error scheduling reassignment:`, error);
      throw error;
    }
  }

  private setupProcessor(): void {
    if (!this.queue) return;

    this.queue.process('reassign-user-tickets', async (job) => {
      const { userId, userGroupId } = job.data;
      logger.info(`🔄 [TICKET-REASSIGNMENT] Processing open tickets for user ${userId} in group ${userGroupId}`);

      // Walk the ticket table forward by id in small pages so a user with a large
      // backlog never loads their full open-ticket set into memory at once, and
      // ticket reassignments run one at a time (not Promise.all) to keep DB load low.
      let lastProcessedId: string | undefined;
      let hasMoreTickets = true;
      let scanned = 0;
      let reassigned = 0;

      while (hasMoreTickets) {
        const tickets = await prisma.ticket.findMany({
          where: {
            assignedTo: userId,
            userGroupId,
            isArchived: false,
            statusV2: { in: OPEN_STATUSES },
            ...(lastProcessedId ? { id: { gt: lastProcessedId } } : {}),
          },
          select: { id: true, boardId: true, projectId: true, channelId: true, workspaceId: true },
          orderBy: { id: 'asc' },
          take: BATCH_SIZE,
        });

        if (tickets.length === 0) {
          break;
        }

        for (const ticket of tickets) {
          scanned++;
          try {
            const result = await evaluateAssignmentRule(
              userGroupId,
              ticket.boardId,
              AssignmentType.TICKET_ASSIGNEE,
              userId,
              ticket.projectId,
              ticket.channelId,
            );

            // No eligible replacement (e.g. no other on-call/active member) - leave the
            // ticket assigned to the now-unavailable user rather than nulling it out.
            if (!result.assignedUserId) {
              logger.info(
                `[TICKET-REASSIGNMENT] No eligible replacement for ticket ${ticket.id} (${result.reason}); leaving assignee unchanged`
              );
              continue;
            }

            const systemActorId = await getAutomationsBotUserId(ticket.workspaceId);
            await repositories.tickets.updateTicketAssignee(ticket.id, result.assignedUserId, systemActorId);
            await handleTicketAssignmentChange(
              result.assignedUserId,
              userId,
              userGroupId,
              ticket.boardId,
              systemActorId,
            );
            reassigned++;
          } catch (error) {
            logger.error(`❌ [TICKET-REASSIGNMENT] Failed to reassign ticket ${ticket.id}:`, error);
          }
        }

        lastProcessedId = tickets[tickets.length - 1].id;
        hasMoreTickets = tickets.length === BATCH_SIZE;
      }

      logger.info(
        `✅ [TICKET-REASSIGNMENT] Completed for user ${userId} in group ${userGroupId}: reassigned ${reassigned}/${scanned} open ticket(s)`
      );
    });
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, error) => {
      logger.error(`❌ [TICKET-REASSIGNMENT] Job ${job?.id} failed:`, error);
    });

    this.queue.on('error', (error) => {
      logger.error('❌ [TICKET-REASSIGNMENT] Queue error:', error);
    });

    this.queue.on('stalled', (job) => {
      logger.warn(`⚠️ [TICKET-REASSIGNMENT] Job ${job?.id} stalled - will retry`);
    });
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.isInitialized = false;
      logger.info('🛑 [TICKET-REASSIGNMENT] Queue closed');
    }
  }
}

export const ticketReassignmentQueue = new TicketReassignmentQueue();
