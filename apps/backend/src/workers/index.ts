import Bull from 'bull';
import { personalizationSyncWorker } from './personalizationSyncWorker';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { recapWorker } from './recapWorker';
import { deskReportWorker } from './deskReportWorker';
import { instagramTokenRefreshWorker } from './instagramTokenRefreshWorker';

/**
 * Worker Scheduler
 * 
 * Manages all background workers and their schedules
 */
export class WorkerScheduler {
    private isRunning = false;
    private personalizationQueue: Bull.Queue | null = null;
    private recapGenerationQueue: Bull.Queue | null = null;
    private recapCleanupQueue: Bull.Queue | null = null;
    private deskReportGenerationQueue: Bull.Queue | null = null;
    private deskReportCleanupQueue: Bull.Queue | null = null;
    private instagramTokenRefreshQueue: Bull.Queue | null = null;

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
        const workerRedisConfig = {
            ...redisService.getRedisConfig(),
            lazyConnect: false,
        };
        
        this.personalizationQueue = new Bull('personalization-sync', {redis:workerRedisConfig});

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

        // Schedule repeatable job (every 1 hour)
        await this.personalizationQueue.add(
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

        logger.info('[WORKER_SCHEDULER] Personalization sync scheduled via Bull (every 6 hours)');

        // Initialize Recap Generation Queue
        if (config.recapScheduler.enabled) {
            this.recapGenerationQueue = new Bull('recap-generation', {
                redis: { ...redisService.getRedisConfig(), lazyConnect: false },
                defaultJobOptions: {
                    removeOnComplete: true,
                    removeOnFail: false,
                    attempts: 3,
                    backoff: {
                        type: 'exponential',
                        delay: 5000,
                    },
                },
                settings: {
                    stalledInterval: 30 * 60 * 1000, // 30 minutes - extended for long-running recap jobs
                    maxStalledCount: 1,
                },
            });

            this.recapGenerationQueue.process(async (job) => {
                logger.info(`[WORKER_SCHEDULER] Processing recap generation job ${job.id}...`);
                try {
                    await recapWorker.processGenerationJob(job);
                    logger.info(`[WORKER_SCHEDULER] Recap generation job ${job.id} completed successfully`);
                } catch (error) {
                    logger.error(`[WORKER_SCHEDULER] Recap generation job ${job.id} failed:`, error);
                    throw error;
                }
            });

            // Remove existing repeatable job to allow CRON updates
            try {
                await this.recapGenerationQueue.removeRepeatableByKey('recap-generation-repeatable');
                logger.info('[WORKER_SCHEDULER] Removed existing recap generation repeatable job');
            } catch (error) {
                // Ignore error if job doesn't exist
                logger.debug('[WORKER_SCHEDULER] No existing recap generation repeatable job to remove');
            }

            // Schedule daily recap generation
            const recapCron = config.recapScheduler.generationCron;
            logger.info(`[WORKER_SCHEDULER] Scheduling recap generation with cron: "${recapCron}"`);
            
            try {
                await this.recapGenerationQueue.add(
                    {},
                    {
                        repeat: { cron: recapCron },
                        jobId: 'recap-generation-repeatable',
                        attempts: 3,
                        backoff: {
                            type: 'exponential',
                            delay: 5000,
                        },
                        removeOnComplete: true,
                    }
                );
                logger.info(`[WORKER_SCHEDULER] Recap generation scheduled via Bull (${recapCron})`);
            } catch (cronError) {
                logger.error(`[WORKER_SCHEDULER] Failed to schedule recap generation with cron "${recapCron}":`, cronError);
                logger.warn(`[WORKER_SCHEDULER] Recap generation will not be automatically scheduled. Manual triggers will still work.`);
                // Continue without crashing the entire worker
            }

            // Initialize Recap Cleanup Queue
            this.recapCleanupQueue = new Bull('recap-cleanup', {
                redis: { ...redisService.getRedisConfig(), lazyConnect: false },
                defaultJobOptions: {
                    removeOnComplete: true,
                    removeOnFail: false,
                    attempts: 3,
                    backoff: {
                        type: 'exponential',
                        delay: 5000,
                    },
                },
                settings: {
                    stalledInterval: 10 * 60 * 1000, // 10 minutes for cleanup jobs
                    maxStalledCount: 1,
                },
            });

            this.recapCleanupQueue.process(async (job) => {
                logger.info(`[WORKER_SCHEDULER] Processing recap cleanup job ${job.id}...`);
                try {
                    await recapWorker.processCleanupJob(job);
                    logger.info(`[WORKER_SCHEDULER] Recap cleanup job ${job.id} completed successfully`);
                } catch (error) {
                    logger.error(`[WORKER_SCHEDULER] Recap cleanup job ${job.id} failed:`, error);
                    throw error;
                }
            });

            // Remove existing repeatable job to allow CRON updates
            try {
                await this.recapCleanupQueue.removeRepeatableByKey('recap-cleanup-repeatable');
                logger.info('[WORKER_SCHEDULER] Removed existing recap cleanup repeatable job');
            } catch (error) {
                // Ignore error if job doesn't exist
                logger.debug('[WORKER_SCHEDULER] No existing recap cleanup repeatable job to remove');
            }

            // Schedule daily recap cleanup
            const cleanupCron = config.recapScheduler.cleanupCron;
            logger.info(`[WORKER_SCHEDULER] Scheduling recap cleanup with cron: "${cleanupCron}"`);
            
            try {
                await this.recapCleanupQueue.add(
                    {},
                    {
                        repeat: { cron: cleanupCron },
                        jobId: 'recap-cleanup-repeatable',
                        attempts: 3,
                        backoff: {
                            type: 'exponential',
                            delay: 5000,
                        },
                        //removeOnComplete: true,
                    }
                );
                logger.info(`[WORKER_SCHEDULER] Recap cleanup scheduled via Bull (${cleanupCron})`);
            } catch (cronError) {
                logger.error(`[WORKER_SCHEDULER] Failed to schedule recap cleanup with cron "${cleanupCron}":`, cronError);
                logger.warn(`[WORKER_SCHEDULER] Recap cleanup will not be automatically scheduled. Manual triggers will still work.`);
                // Continue without crashing the entire worker
            }
            // Note: Project recap generation is now integrated into the channel recap generation job
            // It runs automatically after all channel recaps complete successfully
            logger.info('[WORKER_SCHEDULER] Project recap generation is integrated with channel recap generation');
        } else {
            logger.info('[WORKER_SCHEDULER] Recap scheduler is disabled (ENABLE_RECAP_SCHEDULER=false)');
        }

        // Initialize Desk Report Generation Queue
        if (config.deskReportScheduler.enabled) {
            this.deskReportGenerationQueue = new Bull('desk-report-generation', {
                redis: { ...redisService.getRedisConfig(), lazyConnect: false },
                defaultJobOptions: {
                    removeOnComplete: true,
                    removeOnFail: false,
                    attempts: 3,
                    backoff: {
                        type: 'exponential',
                        delay: 5000,
                    },
                },
                settings: {
                    stalledInterval: 30 * 60 * 1000, // 30 minutes - dispatch loop over many desks
                    maxStalledCount: 1,
                },
            });

            this.deskReportGenerationQueue.process(async (job) => {
                logger.info(`[WORKER_SCHEDULER] Processing desk report generation job ${job.id}...`);
                try {
                    await deskReportWorker.processGenerationJob(job);
                    logger.info(`[WORKER_SCHEDULER] Desk report generation job ${job.id} completed successfully`);
                } catch (error) {
                    logger.error(`[WORKER_SCHEDULER] Desk report generation job ${job.id} failed:`, error);
                    throw error;
                }
            });

            // Remove existing repeatable job(s) to allow CRON updates
            try {
                const existingRepeatable = await this.deskReportGenerationQueue.getRepeatableJobs();
                for (const job of existingRepeatable) {
                    if (job.id !== 'desk-report-generation-repeatable') continue;
                    await this.deskReportGenerationQueue.removeRepeatableByKey(job.key);
                    logger.info(`[WORKER_SCHEDULER] Removed existing desk report generation repeatable job (cron: ${job.cron})`);
                }
            } catch (error) {
                logger.debug('[WORKER_SCHEDULER] No existing desk report generation repeatable job to remove', error);
            }

            const deskReportCron = config.deskReportScheduler.generationCron;
            logger.info(`[WORKER_SCHEDULER] Scheduling desk report generation with cron: "${deskReportCron}"`);

            try {
                await this.deskReportGenerationQueue.add(
                    {},
                    {
                        repeat: { cron: deskReportCron },
                        jobId: 'desk-report-generation-repeatable',
                        attempts: 3,
                        backoff: {
                            type: 'exponential',
                            delay: 5000,
                        },
                        removeOnComplete: true,
                    }
                );
                logger.info(`[WORKER_SCHEDULER] Desk report generation scheduled via Bull (${deskReportCron})`);
            } catch (cronError) {
                logger.error(`[WORKER_SCHEDULER] Failed to schedule desk report generation with cron "${deskReportCron}":`, cronError);
                logger.warn(`[WORKER_SCHEDULER] Desk report generation will not be automatically scheduled. Manual triggers will still work.`);
            }
            // Initialize Desk Report Cleanup Queue
            this.deskReportCleanupQueue = new Bull('desk-report-cleanup', {
                redis: { ...redisService.getRedisConfig(), lazyConnect: false },
                defaultJobOptions: {
                    removeOnComplete: true,
                    removeOnFail: false,
                    attempts: 3,
                    backoff: {
                        type: 'exponential',
                        delay: 5000,
                    },
                },
                settings: {
                    stalledInterval: 10 * 60 * 1000,
                    maxStalledCount: 1,
                },
            });

            this.deskReportCleanupQueue.process(async (job) => {
                logger.info(`[WORKER_SCHEDULER] Processing desk report cleanup job ${job.id}...`);
                try {
                    await deskReportWorker.processCleanupJob(job);
                    logger.info(`[WORKER_SCHEDULER] Desk report cleanup job ${job.id} completed successfully`);
                } catch (error) {
                    logger.error(`[WORKER_SCHEDULER] Desk report cleanup job ${job.id} failed:`, error);
                    throw error;
                }
            });

            try {
                const existingCleanupRepeatable = await this.deskReportCleanupQueue.getRepeatableJobs();
                for (const job of existingCleanupRepeatable) {
                    if (job.id !== 'desk-report-cleanup-repeatable') continue;
                    await this.deskReportCleanupQueue.removeRepeatableByKey(job.key);
                    logger.info(`[WORKER_SCHEDULER] Removed existing desk report cleanup repeatable job (cron: ${job.cron})`);
                }
            } catch (error) {
                logger.debug('[WORKER_SCHEDULER] No existing desk report cleanup repeatable job to remove', error);
            }

            const deskReportCleanupCron = config.deskReportScheduler.cleanupCron;
            logger.info(`[WORKER_SCHEDULER] Scheduling desk report cleanup with cron: "${deskReportCleanupCron}"`);

            try {
                await this.deskReportCleanupQueue.add(
                    { retentionDays: config.deskReportScheduler.retentionDays },
                    {
                        repeat: { cron: deskReportCleanupCron },
                        jobId: 'desk-report-cleanup-repeatable',
                        attempts: 3,
                        backoff: {
                            type: 'exponential',
                            delay: 5000,
                        },
                        removeOnComplete: true,
                    }
                );
                logger.info(`[WORKER_SCHEDULER] Desk report cleanup scheduled via Bull (${deskReportCleanupCron})`);
            } catch (cronError) {
                logger.error(`[WORKER_SCHEDULER] Failed to schedule desk report cleanup with cron "${deskReportCleanupCron}":`, cronError);
                logger.warn(`[WORKER_SCHEDULER] Desk report cleanup will not be automatically scheduled. Manual triggers will still work.`);
            }
        } else {
            logger.info('[WORKER_SCHEDULER] Desk report scheduler is disabled (ENABLE_DESK_REPORT_SCHEDULER=false)');
        }

        // Instagram long-lived token refresh — runs daily at 03:17 UTC
        if (config.enableInstagramTokenRefreshWorker) {
            this.instagramTokenRefreshQueue = new Bull('instagram-token-refresh', { redis: workerRedisConfig });
            this.instagramTokenRefreshQueue.process(async (job) => {
                logger.info(`[WORKER_SCHEDULER] Processing Instagram token refresh job ${job.id}...`);
                try {
                    await instagramTokenRefreshWorker.run();
                    logger.info(`[WORKER_SCHEDULER] Instagram token refresh job ${job.id} completed`);
                } catch (error) {
                    logger.error(`[WORKER_SCHEDULER] Instagram token refresh job ${job.id} failed:`, error);
                    throw error;
                }
            });
            await this.instagramTokenRefreshQueue.add(
                {},
                {
                    repeat: { cron: '17 3 * * *' },
                    jobId: 'instagram-token-refresh-repeatable',
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 5000 },
                    removeOnComplete: true,
                },
            );
            logger.info('[WORKER_SCHEDULER] Instagram token refresh scheduled via Bull (daily at 03:17 UTC)');
        } else {
            logger.info('[WORKER_SCHEDULER] Instagram token refresh worker is disabled (ENABLE_INSTAGRAM_TOKEN_REFRESH_WORKER=false)');
        }
        await this.removeRetiredQueues(workerRedisConfig);

        this.isRunning = true;
        logger.info('[WORKER_SCHEDULER] All workers started');
    }

    /**
     * Queues whose worker was removed. Bull keeps a repeatable job's repeat key
     * and next delayed job in Redis until something deletes them, so drop the
     * whole queue once on startup. Safe to repeat: obliterating an empty queue
     * is a no-op. Remove an entry once every environment has run it.
     */
    private async removeRetiredQueues(redis: Bull.QueueOptions['redis']): Promise<void> {
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

        if (this.recapGenerationQueue) {
            await this.recapGenerationQueue.close();
            this.recapGenerationQueue = null;
        }

        if (this.recapCleanupQueue) {
            await this.recapCleanupQueue.close();
            this.recapCleanupQueue = null;
        }

        if (this.deskReportGenerationQueue) {
            await this.deskReportGenerationQueue.close();
            this.deskReportGenerationQueue = null;
        }

        if (this.deskReportCleanupQueue) {
            await this.deskReportCleanupQueue.close();
            this.deskReportCleanupQueue = null;
        }

        if (this.instagramTokenRefreshQueue) {
            await this.instagramTokenRefreshQueue.close();
            this.instagramTokenRefreshQueue = null;
        }

        this.isRunning = false;
        logger.info('[WORKER_SCHEDULER] Workers stopped');
    }
}

// Export singleton instance
export const workerScheduler = new WorkerScheduler();
