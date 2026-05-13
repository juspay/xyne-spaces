import { logger } from '@/utils/logger';
import { recapGenerationService } from '@/services/recapGenerationService';
import { projectRecapGenerationService } from '@/services/projectRecapGenerationService';
import { redisService } from '@/services/redisService';
import { db } from '@/database/client';
import Bull from 'bull';

function getYesterdayIST(now = new Date()): Date {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(now);
  const year = parts.find(p => p.type === 'year')?.value ?? now.getFullYear().toString();
  const month = parts.find(p => p.type === 'month')?.value ?? (now.getMonth() + 1).toString().padStart(2, '0');
  const day = parts.find(p => p.type === 'day')?.value ?? now.getDate().toString().padStart(2, '0');
  const istToday = new Date(`${year}-${month}-${day}T00:00:00+05:30`);
  istToday.setDate(istToday.getDate() - 1);
  const yesterdayStr = istToday.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  return new Date(`${yesterdayStr}T00:00:00Z`);
}

interface RecapGenerationJobData {
  targetDate?: string;
}

interface RecapCleanupJobData {
  retentionDays?: number;
}

export class RecapWorker {
  async processGenerationJob(job: Bull.Job<RecapGenerationJobData>): Promise<{
    totalChannels: number;
    successful: number;
    failed: number;
    results: any[];
    projectRecapResults?: {
      totalProjects: number;
      successful: number;
      failed: number;
    };
  }> {
    logger.info(`[RECAP_WORKER] Processing generation job ${job.id || 'manual'}...`);

    try {
      const now = new Date();
      logger.info(`[RECAP_WORKER] Current server time: ${now.toISOString()}`);
      logger.info(`[RECAP_WORKER] Current time in IST: ${now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);

      const targetDate = job.data.targetDate ? new Date(job.data.targetDate) : getYesterdayIST(now);

      logger.info(`[RECAP_WORKER] Target date for recap generation: ${targetDate.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })} (IST)`);

      // Step 1: Generate channel recaps
      const result = await recapGenerationService.generateRecapsForDate(targetDate);

      logger.info(
        `[RECAP_WORKER] Channel generation completed: ${result.successful}/${result.totalChannels} successful, ${result.failed} failed`
      );

      if (result.failed > 0) {
        const failedChannels = result.results.filter((r: any) => !r.success);
        logger.error('[RECAP_WORKER] Failed channels:', failedChannels.map((f: any) => ({
          channelId: f.channelId,
          error: f.error,
        })));
      }

      // Step 2: Generate project recaps (runs after channel recaps complete)
      logger.info(`[RECAP_WORKER] Starting project recap generation...`);
      const projectRecapResults = await projectRecapGenerationService.generateRecapsForDate(targetDate);

      logger.info(
        `[RECAP_WORKER] Project recap generation completed: ${projectRecapResults.successful}/${projectRecapResults.totalProjects} successful, ${projectRecapResults.failed} failed`
      );

      return {
        ...result,
        projectRecapResults: {
          totalProjects: projectRecapResults.totalProjects,
          successful: projectRecapResults.successful,
          failed: projectRecapResults.failed,
        },
      };
    } catch (error) {
      logger.error(`[RECAP_WORKER] Generation job failed:`, error);
      throw error;
    }
  }

  async processCleanupJob(job: Bull.Job<RecapCleanupJobData>): Promise<number> {
    logger.info(`[RECAP_WORKER] Processing cleanup job ${job.id || 'manual'}...`);

    try {
      const retentionDays = job.data.retentionDays || 30;
      const cutoffDate = new Date();
      cutoffDate.setUTCDate(cutoffDate.getUTCDate() - retentionDays);
      cutoffDate.setUTCHours(0, 0, 0, 0);

      const cutoffDateStr = cutoffDate.toISOString().split('T')[0];
      logger.info(`[RECAP_WORKER] Deleting recaps older than ${cutoffDateStr} (retention: ${retentionDays} days)`);

      // Delete channel recaps older than cutoff date
      const result = await db.recap.deleteMany({
        where: {
          entityType: 'CHANNEL',
          recapDate: {
            lt: cutoffDate,
          },
        },
      });

      logger.info(`[RECAP_WORKER] Cleanup completed: deleted ${result.count} channel recap(s) older than ${cutoffDateStr}`);

      await this.broadcastCleanupCompleted(cutoffDate, result.count);

      return result.count;
    } catch (error) {
      logger.error(`[RECAP_WORKER] Cleanup job failed:`, error);
      throw error;
    }
  }

  private async broadcastCleanupCompleted(cleanupDate: Date, deletedCount: number): Promise<void> {
    try {
      const subscriptions = await db.channelUserStatus.findMany({
        where: {
          isRecapSubscribed: true,
        },
        select: {
          userId: true,
        },
        distinct: ['userId'],
      });

      const userIds = subscriptions.map(s => s.userId);

      if (userIds.length === 0) {
        logger.info('[RECAP_WORKER] No subscribed users to broadcast cleanup event');
        return;
      }

      logger.info(`[RECAP_WORKER] Broadcasting cleanup event to ${userIds.length} subscribed users`);

      for (const userId of userIds) {
        await redisService.broadcastUserEvent(userId, {
          type: 'recap_cleanup_completed',
          userId,
          data: {
            date: cleanupDate.toISOString().split('T')[0],
            deletedCount,
          },
          timestamp: new Date()
        });
      }
    } catch (error) {
      logger.error('[RECAP_WORKER] Error broadcasting cleanup event:', error);
    }
  }
}

export const recapWorker = new RecapWorker();
