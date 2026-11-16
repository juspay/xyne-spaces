import Bull from 'bull';
import { personalizationSyncWorker } from './personalizationSyncWorker';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';

export const schedulerRedisConfig = (): Bull.QueueOptions['redis'] => ({
    ...redisService.getRedisConfig(),
    lazyConnect: false,
});

export const startPersonalizationSyncQueue = async (redis: Bull.QueueOptions['redis']): Promise<Bull.Queue> => {
    const queue = new Bull('personalization-sync', { redis });

    queue.process(async (job) => {
        logger.info(`[BULL_WORKER] Processing job ${job.id} for personalization sync...`);
        try {
            await personalizationSyncWorker.syncAllUsers();
            logger.info(`[BULL_WORKER] Job ${job.id} completed successfully`);
        } catch (error) {
            logger.error(`[BULL_WORKER] Job ${job.id} failed:`, error);
            throw error;
        }
    });

    await queue.add(
        {},
        {
            repeat: { cron: '0 * * * *' },
            jobId: 'personalization-sync-repeatable',
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 5000,
            },
            removeOnComplete: true,
        }
    );

    logger.info('[WORKER_SCHEDULER] Personalization sync scheduled via Bull (hourly)');
    return queue;
};

/**
 * Queues whose worker was removed. Bull keeps a repeatable job's repeat key
 * and next delayed job in Redis until something deletes them, so drop the
 * whole queue once on startup. Safe to repeat: obliterating an empty queue
 * is a no-op. Remove an entry once every environment has run it.
 */
export const removeRetiredQueues = async (redis: Bull.QueueOptions['redis']): Promise<void> => {
    const retiredQueueNames = ['product-insights-recluster'];
    for (const name of retiredQueueNames) {
        const queue = new Bull(name, { redis });
        try {
            await queue.obliterate({ force: true });
            logger.info(`[WORKER_SCHEDULER] Removed retired queue ${name}`);
        } catch (error) {
            logger.error(`[WORKER_SCHEDULER] Failed to remove retired queue ${name}:`, error);
        } finally {
            await queue.close();
        }
    }
};
