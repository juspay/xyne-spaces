import Bull from 'bull';
import { logger } from '@/utils/logger';
import { VespaJob } from '@/zero/vespa-injection/core/types';
import { db } from '@/database/client';
import { registerVespaBackfillQueueMetrics } from '@/services/otel/vespaMetrics';
import { fileSchema, SubApp } from '@/vespa/src/types';
import { config } from '@/config/env';

class VespaQueue {
	private queues: Map<string, Bull.Queue<VespaJob>> = new Map();
	private isInitialized = false;
	private isInitializing = false;

	// Global registry of every queue created by ANY VespaQueue instance (live + backfill),
	// keyed by queue name. Queue names are globally unique, so this lets monitoring
	// (stats/jobs/retry) resolve any queue regardless of which producer owns it.
	private static globalRegistry: Map<string, Bull.Queue<VespaJob>> = new Map();

	/** All queue names known across every VespaQueue instance. */
	static getRegisteredQueueNames(): string[] {
		return [...VespaQueue.globalRegistry.keys()];
	}

	/** Resolve any queue by name from the global registry (live or backfill). */
	static getRegisteredQueue(queueName: string): Bull.Queue<VespaJob> | undefined {
		return VespaQueue.globalRegistry.get(queueName);
	}

	/**
	 * @param queueNamesOverride  explicit queue names this producer fans out to.
	 *                            When omitted, falls back to VESPA_QUEUE_NAMES (live flow).
	 * @param fileQueueNameOverride  queue that receives file-schema jobs.
	 *                               When omitted, falls back to VESPA_FILE_QUEUE_NAME.
	 */
	constructor(
		private queueNamesOverride?: string[],
		private fileQueueNameOverride?: string,
	) {
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

			const queueNames = (this.queueNamesOverride && this.queueNamesOverride.length)
				? this.queueNamesOverride
				: (process.env.VESPA_QUEUE_NAMES || 'vespa-ingestion,vespa-files')
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
				const q = new Bull<VespaJob>(name, bullOptions);
				this.queues.set(name, q);
				VespaQueue.globalRegistry.set(name, q);   // expose for cross-instance monitoring
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
		// Resolve globally so any queue (live or backfill) is reachable from any instance
		return VespaQueue.globalRegistry.get(queueName);
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
	 * Add a job to the appropriate queue(s) based on schema type
	 * - File schemas go only to vespa-files queue
	 * - Non-file schemas go to all queues EXCEPT vespa-files (broadcast to vespa-ingestion, vespa-ingestion-kube, etc.)
	 */
	async addJob(vespaJob: VespaJob): Promise<Bull.Job<VespaJob>[]> {
		if (this.queues.size === 0 || !this.isInitialized) {
			throw new Error('Vespa queue not initialized Properly');
		}

		const { schema, jobType, docId } = vespaJob;
		const fileQueueName = this.fileQueueNameOverride || process.env.VESPA_FILE_QUEUE_NAME || 'vespa-files';
		
		try {
			const jobData: VespaJob = vespaJob;
			// Name-only feeds insert just the file name (no content parse) so the file
			// is searchable in cmd+K within seconds — they get the top priority so they
			// jump ahead of every queued heavy feed. KB (collection) feed jobs get the
			// next-highest priority among feeds. Lower number = higher priority in BullMQ.
			const isNameOnlyFeed = jobType === 'feed' && vespaJob.nameOnly === true;
			const isKbFeed = jobType === 'feed' && vespaJob.app === SubApp.COLLECTIONS;
			const feedPriority = isNameOnlyFeed
				? config.fileNameOnlyFeed.queuePriority
				: isKbFeed
					? config.kbIngestion.queuePriority
					: 5;
			const jobOpts = { priority: jobType === 'delete' ? 1 : feedPriority };
			if (isKbFeed) {
				logger.info(
					`[KB_PRIORITY] Prioritizing KB file feed ${schema}/${docId} with queue priority ${jobOpts.priority} (lower = higher)`
				);
			}
			
			let targetQueues: Bull.Queue<VespaJob>[];

			if (schema === fileSchema) {
				// File jobs → only file queue
				const fq = this.queues.get(fileQueueName);
				if (!fq) {
					throw new Error(`File queue '${fileQueueName}' not found. Available queues: ${[...this.queues.keys()].join(', ')}`);
				}
				targetQueues = [fq];
			} else {
				// Non-file jobs → all queues EXCEPT file queue (broadcast behavior)
				targetQueues = [...this.queues.entries()]
					.filter(([name, _]) => name !== fileQueueName)
					.map(([_, queue]) => queue);
				
				if (targetQueues.length === 0) {
					throw new Error(`No non-file queues available. File queue: '${fileQueueName}', Available: ${[...this.queues.keys()].join(', ')}`);
				}
			}

			// Broadcast to all target queues
			const jobs = await Promise.all(
				targetQueues.map(q => q.add(`vespa-${schema}`, jobData, jobOpts))
			);

			const queueNames = targetQueues.map(q => q.name);
			logger.info(`Queued ${schema} job to ${targetQueues.length} queue(s) (${queueNames.join(', ')}): ${schema}/${jobType}/${docId}`);
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
		const q = VespaQueue.globalRegistry.get(queueName);
		if (!q) {
			logger.warn(`Queue '${queueName}' not found. Available: ${VespaQueue.getRegisteredQueueNames().join(', ')}`);
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
	 * Stats for EVERY registered queue (live + backfill), keyed by queue name.
	 * Convenience for dashboards that want to show all queues at once.
	 */
	async getAllStats(): Promise<Record<string, Awaited<ReturnType<VespaQueue['getStats']>>>> {
		const names = VespaQueue.getRegisteredQueueNames();
		const entries = await Promise.all(
			names.map(async (name) => [name, await this.getStats(name)] as const)
		);
		return Object.fromEntries(entries);
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
		const q = VespaQueue.globalRegistry.get(queueName);
		if (!q) {
			logger.warn(`Queue '${queueName}' not found. Available: ${VespaQueue.getRegisteredQueueNames().join(', ')}`);
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
		const q = VespaQueue.globalRegistry.get(queueName);
		if (!q) {
			logger.warn(`Queue '${queueName}' not found. Available: ${VespaQueue.getRegisteredQueueNames().join(', ')}`);
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
			// Drop this instance's queues from the global registry to avoid stale references
			for (const name of this.queues.keys()) {
				VespaQueue.globalRegistry.delete(name);
			}
			logger.info('VespaQueue closed');
		}
	}
}

// Live ingestion producer — fans out to VESPA_QUEUE_NAMES (unchanged behavior)
export const vespaQueue = new VespaQueue();

// Dedicated BACKFILL producer for backfill + migration so heavy backfill load never lands
// in the live queues. Mirrors the live normal/file split (vespa-ingestion / vespa-files):
//   - non-file backfill jobs → vespa-backfill-normal
//   - file-schema backfill jobs → vespa-backfill-file
// Both names are overridable via env. Drained by dedicated backfill worker pods that set
// VESPA_WORKER_QUEUE_NAME to one of these queue names.
const backfillQueueNames = (process.env.VESPA_BACKFILL_QUEUE_NAMES || 'vespa-backfill-normal,vespa-backfill-file')
	.split(',')
	.map(n => n.trim())
	.filter(Boolean);
const backfillFileQueueName = process.env.VESPA_BACKFILL_FILE_QUEUE_NAME || 'vespa-backfill-file';
export const vespaBackfillQueue = new VespaQueue(backfillQueueNames, backfillFileQueueName);