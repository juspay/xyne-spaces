import { logger } from '@/utils/logger';
import { recapGenerationService } from '@/services/recapGenerationService';
import { redisService } from '@/services/redisService';
import { db } from '@/database/client';
import Bull from 'bull';

/**
 * Recap Worker Service
 * 
 * Handles recap generation and cleanup jobs scheduled via Bull queues
 */

interface RecapGenerationJobData {
  targetDate?: string; // ISO date string, defaults to previous day (yesterday)
}

interface RecapCleanupJobData {
  retentionDays?: number; // Number of days to retain, defaults to config
}

export class RecapWorker {
  /**
   * Process recap generation job
   * Generates recaps for the specified date (defaults to previous day/yesterday)
   */
  async processGenerationJob(job: Bull.Job<RecapGenerationJobData>): Promise<{
    totalChannels: number;
    successful: number;
    failed: number;
    results: any[];
  }> {
    logger.info(`[RECAP_WORKER] Processing generation job ${job.id || 'manual'}...`);

    try {
      // Calculate target date (defaults to previous day/yesterday in IST)
      const now = new Date();
      logger.info(`[RECAP_WORKER] Current server time: ${now.toISOString()}`);
      logger.info(`[RECAP_WORKER] Current time in IST: ${now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
      
      const targetDate = job.data.targetDate
        ? new Date(job.data.targetDate)
        : (() => {
            // Get yesterday in IST timezone properly using Date arithmetic
            // This handles month/year boundaries correctly
            const formatter = new Intl.DateTimeFormat('en-CA', {
              timeZone: 'Asia/Kolkata',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit'
            });
            
            // Get current date in IST
            const parts = formatter.formatToParts(now);
            const year = parts.find(p => p.type === 'year')?.value || now.getFullYear().toString();
            const month = parts.find(p => p.type === 'month')?.value || (now.getMonth() + 1).toString().padStart(2, '0');
            const day = parts.find(p => p.type === 'day')?.value || now.getDate().toString().padStart(2, '0');
            
            // Create a date object for current IST date and subtract 1 day (handles month/year boundaries)
            const istDate = new Date(`${year}-${month}-${day}T00:00:00+05:30`);
            istDate.setDate(istDate.getDate() - 1);
            
            // Format yesterday's date in IST
            const yesterdayDateStr = istDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
            
            // Create the date at UTC to match storage format
            const result = new Date(`${yesterdayDateStr}T00:00:00Z`);
            
            const istDisplay = result.toLocaleDateString('en-IN', { 
              timeZone: 'Asia/Kolkata',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit'
            });
            logger.info(`[RECAP_WORKER] Yesterday date (IST): ${istDisplay}`);
            return result;
          })();

      const istTargetDate = targetDate.toLocaleDateString('en-IN', { 
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      logger.info(`[RECAP_WORKER] Target date for recap generation: ${istTargetDate} (IST)`);

      const result = await recapGenerationService.generateRecapsForDate(targetDate);

      logger.info(
        `[RECAP_WORKER] Generation completed: ${result.successful}/${result.totalChannels} successful, ${result.failed} failed`
      );

      // Log failed channels for investigation
      if (result.failed > 0) {
        const failedChannels = result.results.filter((r: any) => !r.success);
        logger.error('[RECAP_WORKER] Failed channels:', failedChannels.map((f: any) => ({
          channelId: f.channelId,
          error: f.error,
        })));
      }

      return result;
    } catch (error) {
      logger.error(`[RECAP_WORKER] Generation job failed:`, error);
      throw error;
    }
  }

  /**
   * Process recap cleanup job
   * Deletes recaps older than the retention period (default: 30 days)
   */
  async processCleanupJob(job: Bull.Job<RecapCleanupJobData>): Promise<number> {
    logger.info(`[RECAP_WORKER] Processing cleanup job ${job.id || 'manual'}...`);

    try {
      const retentionDays = job.data.retentionDays || 30;
      
      // Calculate cutoff date - delete recaps older than retention days
      const cutoffDate = new Date();
      cutoffDate.setUTCDate(cutoffDate.getUTCDate() - retentionDays);
      cutoffDate.setUTCHours(0, 0, 0, 0);

      const cutoffDateStr = cutoffDate.toISOString().split('T')[0];
      logger.info(`[RECAP_WORKER] Deleting recaps older than ${cutoffDateStr} (retention: ${retentionDays} days)`);

      // Delete recaps older than cutoff date
      const result = await db.channelRecap.deleteMany({
        where: {
          recapDate: {
            lt: cutoffDate,
          },
        },
      });

      logger.info(`[RECAP_WORKER] Cleanup completed: deleted ${result.count} recap(s) older than ${cutoffDateStr}`);

      // Broadcast cleanup event to all subscribed users for real-time UI updates
      await this.broadcastCleanupCompleted(cutoffDate, result.count);

      return result.count;
    } catch (error) {
      logger.error(`[RECAP_WORKER] Cleanup job failed:`, error);
      throw error;
    }
  }

  /**
   * Broadcast cleanup completed event to subscribed users
   * Uses Redis pub/sub to communicate with the main API server's WebSocket service
   */
  private async broadcastCleanupCompleted(cleanupDate: Date, deletedCount: number): Promise<void> {
    try {
      // Get all users who have any recap subscriptions
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

      // Broadcast to each user via Redis pub/sub
      // The main API server will receive this and emit via WebSocket to connected clients
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
