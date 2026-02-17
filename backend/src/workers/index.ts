import Bull from 'bull';
import { personalizationSyncWorker } from './personalizationSyncWorker';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { runReclusteringFlow } from '@/services/productInsightsPipeline';
import { db } from '@/database/client';

/**
 * Worker Scheduler
 * 
 * Manages all background workers and their schedules
 */
export class WorkerScheduler {
    private isRunning = false;
    private personalizationQueue: Bull.Queue | null = null;
    private productInsightsQueue: Bull.Queue | null = null;

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

        // Initialize Product Insights recluster queue
        const productInsightsRedisConfig = {
            ...redisService.getRedisConfig(),
            lazyConnect: false,
        };
        this.productInsightsQueue = new Bull('product-insights-recluster', {
            redis: productInsightsRedisConfig,
        });

        this.productInsightsQueue.process(async (job) => {
            logger.info(`[PRODUCT_INSIGHTS] Processing recluster job ${job.id}...`);
            try {
                await this.runProductInsightsRecluster();
                logger.info(`[PRODUCT_INSIGHTS] Recluster job ${job.id} completed successfully`);
            } catch (error) {
                logger.error(`[PRODUCT_INSIGHTS] Recluster job ${job.id} failed:`, error);
                throw error;
            }
        });

        await this.productInsightsQueue.add(
            {},
            {
                repeat: { cron: config.productInsights.recluster.cron },
                jobId: 'product-insights-recluster-repeatable',
            },
        );

        logger.info('[WORKER_SCHEDULER] Product insights recluster scheduled via Bull');
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

        if (this.productInsightsQueue) {
            await this.productInsightsQueue.close();
            this.productInsightsQueue = null;
        }

        this.isRunning = false;
        logger.info('[WORKER_SCHEDULER] Workers stopped');
    }

    private async runProductInsightsRecluster(): Promise<void> {
        // TODO(product-insights): Support multiple configured window sizes and run reclustering for each window.
        const { windowDays } = config.productInsights.recluster;
        const toTs = Date.now();
        const fromTs = toTs - windowDays * 24 * 60 * 60 * 1000;

        const projects = await db.project.findMany({ select: { id: true, name: true } });
        if (projects.length === 0) {
            logger.warn('[PRODUCT_INSIGHTS] No projects found; skipping recluster');
            return;
        }

        logger.info('[PRODUCT_INSIGHTS] Starting recluster run for all projects', {
            projectCount: projects.length,
            fromTs,
            toTs,
        });

        for (const project of projects) {
            try {
                logger.info('[PRODUCT_INSIGHTS] Reclustering project', {
                    projectId: project.id,
                    projectName: project.name,
                });
                await runReclusteringFlow({
                    projectId: project.id,
                    fromTs,
                    toTs,
                });
            } catch (error) {
                logger.error('[PRODUCT_INSIGHTS] Reclustering failed for project', {
                    projectId: project.id,
                    projectName: project.name,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }
}

// Export singleton instance
export const workerScheduler = new WorkerScheduler();
