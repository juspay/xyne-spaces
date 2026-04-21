import Bull from 'bull';
import { logger } from '@/utils/logger';
import { VespaJob } from '@/zero/vespa-injection/core/types';
import { db } from '@/database/client';
import { registerVespaBackfillQueueMetrics } from '@/services/otel/vespaMetrics';

class VespaQueue {
	private queues: Map<string, Bull.Queue<VespaJob>> = new Map();
	private isInitialized = false;
	private isInitializing = false;

	constructor() {
	}

	async initialize(): Promise<void> {
		// Prevent concurrent initialization attempts
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

			const queueNames = (process.env.VESPA_QUEUE_NAMES || 'vespa-ingestion')
				.split(',')
				.map(n => n.trim())
				.filter(Boolean);

			const bullOptions = {
				redis: redisConfig,
				defaultJobOptions: {
					attempts: 3,
					backoff: {
						type: 'exponential',
						delay: 2000,
					},
				},
				settings: {
					stalledInterval: 30 * 1000,    // 30 seconds
					maxStalledCount: 1,            // Max stalled jobs before failing
				}
			};
			this.setupEventListeners();
			for (const name of queueNames) {
				this.queues.set(name, new Bull<VespaJob>(name, bullOptions));
			}

			this.isInitialized = true;
			logger.info(`✓ VespaQueue initialized for all schemas (queues: ${queueNames.join(', ')})`);

			for (const name of queueNames) {
				registerVespaBackfillQueueMetrics(name, () => this.getStats(name));
			}
		} catch (error) {
			logger.error('Failed to initialize vespa queue:', error);
			this.isInitialized = false;
		} finally {
			this.isInitializing = false;
		}
	}

	getQueue(queueName: string): Bull.Queue<VespaJob> | undefined {
		return this.queues.get(queueName);
	}

	get isReady(): boolean {
		return this.isInitialized && this.queues.size > 0;
	}

	/**
	 * Set up event listeners for queue monitoring
	 */
	private setupEventListeners(): void {
		if (!this.queues.size) return;

	}


	/**
	 * Add a job to the queue
	 */
	async addJob(vespaJob: VespaJob): Promise<Bull.Job<VespaJob>[]> {
		if (this.queues.size === 0 || !this.isInitialized) {
			throw new Error('Vespa queue not initialized Properly');
		}

		const { schema, jobType, docId } = vespaJob;
		try {
			const jobData: VespaJob = vespaJob;
			const jobOpts = { priority: jobType === 'delete' ? 1 : 5 };

			const jobs = await Promise.all(
				[...this.queues.values()].map(q => q.add(`vespa-${schema}`, jobData, jobOpts))
			);

			logger.info(`Queue vespa ingestion job successfully ${schema}/${jobType}/${docId}`)
			return jobs;
		} catch (error) {
			logger.error(
				`Failed to add Vespa job: ${schema}/${jobType}/${docId}`,
				error
			);
			throw error;
		}
	}

	/**
	 * Get queue statistics
	 */
	async getStats(queueName: string) {
		const q = this.queues.get(queueName);
		if (!q) {
			logger.warn(`Queue '${queueName}' not found. Available: ${[...this.queues.keys()].join(', ')}`);
			return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, total: 0 };
		}

		const [waiting, active, completed, failed, delayed] = await Promise.all([
			q.getWaitingCount(),
			q.getActiveCount(),
			q.getCompletedCount(),
			q.getFailedCount(),
			q.getDelayedCount(),
		]);

		return {
			waiting,
			active,
			completed,
			failed,
			delayed,
			total: waiting + active + completed + failed + delayed,
		};
	}

	/**
	 * Get main queue jobs with pagination and state filter
	 */
	async getJobs(
		page: number = 1,
		limit: number = 10,
		state: 'waiting' | 'active' | 'delayed' | 'completed' | 'failed' | 'all' = 'failed',
		queueName: string
	) {
		const q = this.queues.get(queueName);
		if (!q) {
			logger.warn(`Queue '${queueName}' not found. Available: ${[...this.queues.keys()].join(', ')}`);
			return { jobs: [], total: 0, page, limit, totalPages: 0 };
		}
		let jobs: any[] = [];

		if (state === 'all') {
			const [waiting, active, delayed, completed, failed] = await Promise.all([
				q.getWaiting(),
				q.getActive(),
				q.getDelayed(),
				q.getCompleted(),
				q.getFailed(),
			]);
			jobs = [
				...waiting.map(job => ({ ...job, state: 'waiting' })),
				...active.map(job => ({ ...job, state: 'active' })),
				...delayed.map(job => ({ ...job, state: 'delayed' })),
				...completed.map(job => ({ ...job, state: 'completed' })),
				...failed.map(job => ({ ...job, state: 'failed' })),
			];
		} else {
			let stateJobs: any[] = [];
			switch (state) {
				case 'waiting':
					stateJobs = await q.getWaiting();
					break;
				case 'active':
					stateJobs = await q.getActive();
					break;
				case 'delayed':
					stateJobs = await q.getDelayed();
					break;
				case 'completed':
					stateJobs = await q.getCompleted();
					break;
				case 'failed':
					stateJobs = await q.getFailed();
					break;
			}
			jobs = stateJobs.map(job => ({ ...job, state }));
		}

		const total = jobs.length;
		const totalPages = Math.ceil(total / limit);
		const start = (page - 1) * limit;
		const end = start + limit;

		const paginatedJobs = jobs.slice(start, end).map((job) => ({
			id: job.id,
			state: job.state,
			data: job.data,
			failedReason: job.failedReason,
			stacktrace: job.stacktrace,
			attemptsMade: job.attemptsMade,
			timestamp: job.timestamp,
			processedOn: job.processedOn,
			finishedOn: job.finishedOn,
		}));

		return {
			jobs: paginatedJobs,
			total,
			page,
			limit,
			totalPages,
			state,
		};
	}

	/**
 * Retry all failed jobs from Queue
 */
	async retryAllFailedJobs(queueName: string) {
		const q = this.queues.get(queueName);
		if (!q) {
			logger.warn(`Queue '${queueName}' not found. Available: ${[...this.queues.keys()].join(', ')}`);
			return { success: 0, failed: 0, errors: [`Queue '${queueName}' does not exist`], total: 0 };
		}

		const failedJobs = await q.getFailed();
		let success = 0;
		let failed = 0;
		const errors: string[] = [];

		logger.info(`🔄 Retrying ${failedJobs.length} failed jobs from Queue...`);

		logger.info(`✓ Queue retry complete: ${success} succeeded, ${failed} failed`);
		return { success, failed, errors, total: failedJobs.length };
	}

	/**
	 * Get failed jobs from database with pagination
	 */
	async getFailedJobsFromDB(
		page: number = 1,
		limit: number = 10,
		filters?: {
			entityType?: string;
			userId?: string;
			resolved?: boolean;
		}
	) {
		const skip = (page - 1) * limit;

		const where: any = {};
		if (filters?.entityType) {
			where.entityType = filters.entityType;
		}
		if (filters?.userId) {
			where.userId = filters.userId;
		}
		if (filters?.resolved !== undefined) {
			where.resolvedAt = filters.resolved ? { not: null } : null;
		}

		const [jobs, total] = await Promise.all([
			db.vespaInsertionLogs.findMany({
				where,
				skip,
				take: limit,
				orderBy: { createdAt: 'desc' },
			}),
			db.vespaInsertionLogs.count({ where }),
		]);

		return {
			jobs,
			total,
			page,
			limit,
			totalPages: Math.ceil(total / limit),
		};
	}

	/**
	 * Retry failed jobs from database
	 */
	async retryFailedJobsFromDB(failedJobIds: string[]) {
		let success = 0;
		let failed = 0;
		const errors: string[] = [];

		for (const failedJobId of failedJobIds) {
			try {
				const failedJob = await db.vespaInsertionLogs.findUnique({
					where: { id: failedJobId },
				});

				if (!failedJob) {
					failed++;
					errors.push(`Failed job ${failedJobId} not found`);
					continue;
				}

				if (failedJob.resolvedAt) {
					failed++;
					errors.push(`Failed job ${failedJobId} already resolved`);
					continue;
				}

				// Extract job data from errorDetails
				const errorDetails = failedJob.errorDetails as any;
				const jobData = errorDetails?.jobData;

				if (!jobData) {
					failed++;
					errors.push(`Failed job ${failedJobId} missing job data`);
					continue;
				}

				// Re-add the job to the queue
				await this.addJob(jobData);

				// Update retry count
				await db.vespaInsertionLogs.update({
					where: { id: failedJobId },
					data: {
						retryCount: { increment: 1 },
					},
				});

				success++;
				logger.info(`✓ Re-queued failed job ${failedJobId}`);
			} catch (error) {
				failed++;
				const errorMsg = error instanceof Error ? error.message : 'Unknown error';
				errors.push(`Failed job ${failedJobId}: ${errorMsg}`);
				logger.error(`Failed to retry failed job ${failedJobId}:`, error);
			}
		}

		return { success, failed, errors };
	}

	/**
	 * Mark failed jobs as resolved
	 */
	async resolveFailedJobs(failedJobIds: string[]) {
		try {
			const result = await db.vespaInsertionLogs.updateMany({
				where: {
					id: { in: failedJobIds },
					resolvedAt: null,
				},
				data: {
					resolvedAt: new Date(),
				},
			});

			logger.info(`✓ Resolved ${result.count} failed jobs`);
			return { success: result.count };
		} catch (error) {
			logger.error('Failed to resolve failed jobs:', error);
			throw error;
		}
	}

	/**
	 * Clear all jobs from queue (use with caution!)
	 */
	async clearQueue(): Promise<void> {
		if (this.queues.size === 0) {
			logger.warn(':warning: Vespa queue not initialized');
			return;
		}

		await Promise.all([...this.queues.values()].map(q => q.empty()));
		logger.warn(':warning: Vespa queues cleared');
	}

	/**
	 * Gracefully close the queue
	 */
	async close(): Promise<void> {
		if (this.queues.size === 0) {
			logger.info('VespaQueue already closed or never initialized');
		} else {
			await Promise.all([...this.queues.values()].map(q => q.close()));
			logger.info('VespaQueue closed');
		}
	}
}

// Export singleton instance
export const vespaQueue = new VespaQueue();