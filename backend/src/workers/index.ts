import Bull from 'bull';
import { personalizationSyncWorker } from './personalizationSyncWorker';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';

/**
 * Worker Scheduler
 * 
 * Manages all background workers and their schedules
 */
export class WorkerScheduler {
    private isRunning = false;
    private personalizationQueue: Bull.Queue | null = null;

    /**
     * Start all workers
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            logger.info('[WORKER_SCHEDULER] Workers already running');
            return;
        }

        logger.info('[WORKER_SCHEDULER] Starting workers...');

        // Initialize Bull Queue
        this.personalizationQueue = new Bull('personalization-sync', {redis:redisService.getRedisConfig()});

        // Define worker process
        this.personalizationQueue.process(async (job) => {
            logger.info(`[BULL_WORKER] Processing job ${job.id} for personalization sync...`);
            try {
                await personalizationSyncWorker.syncAllUsers();
                logger.info(`[BULL_WORKER] Job ${job.id} completed successfully`);
            } catch (error) {
                logger.error(`[BULL_WORKER] Job ${job.id} failed:`, error);
                throw error; // Rethrow so Bull can handle retries
            }
        });

        // Schedule repeatable job (every 6 hours)
        await this.personalizationQueue.add(
            {},
            {
                repeat: { cron: '0 */6 * * *' },
                jobId: 'personalization-sync-repeatable',
                attempts: 3,
                backoff: {
                type: 'exponential',
                delay: 5000,
                },
                removeOnComplete: true,
            }
        );

        logger.info('[WORKER_SCHEDULER] Personalization sync scheduled via Bull (every 6 hours)');
        this.isRunning = true;
        logger.info('[WORKER_SCHEDULER] All workers started');
    }


    /**
     * Stop all workers
     */
    async stop() {
        if (!this.isRunning) {
            logger.info('[WORKER_SCHEDULER] Workers not running');
            return;
        }

        logger.info('[WORKER_SCHEDULER] Stopping workers...');

        if (this.personalizationQueue) {
            await this.personalizationQueue.close();
            this.personalizationQueue = null;
        }

        this.isRunning = false;
        logger.info('[WORKER_SCHEDULER] Workers stopped');
    }
}

// Export singleton instance
export const workerScheduler = new WorkerScheduler();
