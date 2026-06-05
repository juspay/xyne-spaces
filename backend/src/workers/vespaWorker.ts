import Bull from 'bull';
import vespaClient from '@/vespa/client';
import { logger } from '@/utils/logger';
import { InsertDocument, samTranscriptSchema, VespaSchema } from '@/vespa/src/types';
import { VespaJob, VespaJobType } from '@/zero/vespa-injection/core/types';
import { db } from '@/database/client';
import { NAMESPACE } from '@/vespa/vespaConfig';
import { fetchAndMapBySchema, VespaOperationType } from '@/zero/vespa-injection/core/mapper';
import { vespaPostIngestHooks } from './vespaPostIngestHooks';

export class VespaWorker {
	private queue: Bull.Queue<VespaJob> | null = null;
	private isInitialized = false;
	private isInitializing = false;
	private namespace: string;

	constructor(namespace: string = NAMESPACE) {
		this.namespace = namespace;
	}

	async initialize(): Promise<void> {
		// Prevent concurrent initialization attempts
		if (this.isInitialized || this.isInitializing) {
			return;
		}

		this.isInitializing = true;

		try {
			// Redis configuration from environment
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

			// Worker connects to the EXISTING queue created by the API server
			// Multiple Bull instances with the same name share the same Redis queue
			// The API server (vespaBullQueue) is the producer, worker is the consumer
			const queueName = process.env.VESPA_WORKER_QUEUE_NAME || 'vespa-ingestion';
			this.queue = new Bull<VespaJob>(queueName, {
				redis: redisConfig,
				defaultJobOptions: {
					attempts: 3,           // Retry failed jobs 3 times
					backoff: {
						type: 'exponential',
						delay: 2000,
					},
				},
				settings: {
					stalledInterval: 30 * 1000,    // 30 seconds
					maxStalledCount: 1,            // Max stalled jobs before failing
				}
			});

			logger.info(`[VESPA_WORKER] Connected to existing ${queueName} queue in Redis`);

			// Setup the worker to process jobs
			this.setupWorker();

			this.isInitialized = true;
		} catch (error) {
			logger.error('[VESPA_WORKER] Failed to initialize worker:', error);
			this.isInitialized = false;
		} finally {
			this.isInitializing = false;
		}
	}

	/**
	 * Start the worker (called explicitly from worker.ts)
	 */
	async start(): Promise<void> {
		// Initialize if not already done
		if (!this.isInitialized) {
			await this.initialize();
		}

		logger.info('[VESPA_WORKER] VespaWorker started successfully and ready to process jobs');
	}

	/**
	 * Set up the worker to process jobs
	 */
	private setupWorker(): void {
		if (!this.queue) {
			logger.error('[VESPA_WORKER] Cannot setup worker - queue is not available');
			return;
		}

		// Process all jobs with a single queue processor to ensure only one job at a time across all schemas
		this.queue.process('*', 1, async (job) => {
			return this.processJob(job);
		});

		// Event: Job completed
		this.queue.on('completed', (job) => {
			logger.info(
				`[VESPA_WORKER] Job ${job.id} completed: ${job.data.schema}/${job.data.docId}`
			);
		});

		// Event: Job failed
		this.queue.on('failed', async (job, err) => {

			// After max retries, record in database
			if (job.attemptsMade >= (job.opts.attempts || 3)) {
				await this.recordFailedJob(job, err);
				logger.warn(
					`[VESPA_WORKER] Recorded failed job ${job.id} to database after ${job.attemptsMade} failed attempts`
				);
			}
		});
	}

	/**
	 * Record a failed job in the database
	 */
	private async recordFailedJob(job: Bull.Job<VespaJob>, error: Error): Promise<void> {
		try {
			const entityId = job.data.docId;
			const entityType = job.data.schema;
			const userId = job.data.userId || null;
			await db.vespaInsertionLogs.create({
				data: {
					entityId,
					entityType,
					type: VespaOperationType[job.data.jobType],
					status: 'FAILED',
					namespace: this.namespace,
					errorMessage: `Job ${job.id} failed after ${job.attemptsMade} attempts: ${error.message}`,
					errorDetails: JSON.stringify({
						jobId: job.id,
						jobName: job.name,
						jobType: job.data.jobType,
						attemptsMade: job.attemptsMade,
						error: error.message,
						stack: error.stack,
						jobData: job.data,
						timestamp: Date.now(),
					}),
					userId,
					retryCount: job.attemptsMade || 0,
					createdAt: new Date(),
				},
			});

			logger.info(`[VESPA_WORKER] ✓ Recorded failed job ${job.id} in database`);
		} catch (dbError) {
			logger.error(`[VESPA_WORKER] Failed to record job ${job.id} failure in database:`, dbError);
		}
	}

	/**
	 * Process a single job from the queue
	 */
	private async processJob(job: Bull.Job<VespaJob>): Promise<any> {
		const { schema, docId, jobType, app } = job.data;

		logger.info(
			`[VESPA_WORKER] Processing ${jobType} job for ${schema}/${docId} (Job ID: ${job.id}, Job Name: ${job.name})`
		);

		try {
			let mappedData: InsertDocument | Partial<InsertDocument>;

			const isSamTranscript = schema === samTranscriptSchema;
			const preTransformedData = job.data.data;

			if (jobType === 'delete') {
				mappedData = {};
			} else if (isSamTranscript) {
				if (!preTransformedData) {
					throw new Error(`SAM transcript job ${job.id} is missing pre-transformed data. Expected job.data.data to be populated.`);
				}
				logger.info(`[VESPA_WORKER] Using pre-transformed data for SAM transcript ${docId}`);
				mappedData = preTransformedData as InsertDocument;
			} else {
				logger.info(`[VESPA_WORKER] Fetching data from database for ${schema}/${docId}`);
				mappedData = await fetchAndMapBySchema(schema, docId, jobType, app, job.data.workspaceId, job.data.orgId);
			}

			const handlers: Record<VespaJobType, () => Promise<void>> = {
				feed: () => this.handleFeed(schema, mappedData as InsertDocument),
				update: () => this.handleUpdate(docId, schema, mappedData as InsertDocument),
				delete: () => this.handleDelete(schema, docId),
			}
			const handler = handlers[jobType];
			if (!handler) {
				throw new Error(`Unknown job type: ${jobType}`);
			}

			await handler();

			void vespaPostIngestHooks
				.run({ schema, docId, jobType, mappedData, userId: job.data.userId })
				.catch((error) => {
					logger.error('[VESPA_WORKER] Post-ingest hook failed', {
						schema,
						docId,
						jobType,
						error: error instanceof Error ? error.message : String(error),
					});
				});
		} catch (error) {
			logger.error(`[VESPA_WORKER] Failed to process ${jobType} for ${schema}/${docId}:`, error);
			throw error;
		}
	}

	private async handleFeed(
		schema: VespaSchema,
		data: InsertDocument,
	): Promise<void> {
		logger.info(`[Vespa-Worker]: queue ${schema} insert ${schema}/${data.docId}`);
		const [result] = await vespaClient.crudService.insert([data], schema);
		if (!result.success) {
			throw new Error(`Failed to insert ${data.docId}: ${result.error}`);
		}
	}

	private async handleUpdate(
		docId: string,
		schema: VespaSchema,
		data: Partial<InsertDocument>,
	): Promise<void> {
		logger.info(`[Vespa-Worker]: queue ${schema} update ${schema}/${docId}`);
		const [result] = await vespaClient.crudService.update([{ docId, fields: data }], schema);
		if (!result.success) {
			throw new Error(`Failed to update ${docId}: ${result.error}`);
		}
	}

	private async handleDelete(schema: VespaSchema, docId: string): Promise<void> {
		logger.info(`[Vespa-Worker]: queue ${schema} delete ${schema}/${docId}`);
		await vespaClient.crudService.delete(docId, schema);
	}

	/**
	 * Get worker statistics
	 */
	async getStats(): Promise<{ queue: any }> {
		if (!this.queue) {
			return {
				queue: {
					waiting: 0,
					active: 0,
					completed: 0,
					failed: 0,
					delayed: 0,
					total: 0,
				},
			};
		}

		const [waiting, active, completed, failed, delayed] = await Promise.all([
			this.queue.getWaitingCount(),
			this.queue.getActiveCount(),
			this.queue.getCompletedCount(),
			this.queue.getFailedCount(),
			this.queue.getDelayedCount(),
		]);

		return {
			queue: {
				waiting,
				active,
				completed,
				failed,
				delayed,
				total: waiting + active + completed + failed + delayed,
			},
		};
	}

	/**
	 * Gracefully shutdown the worker
	 */
	async shutdown(): Promise<void> {
		logger.info('[VESPA_WORKER] Shutting down VespaWorker...');
		if (this.queue) {
			await this.queue.close();
		}
		await vespaClient.crudService.close();
		logger.info('[VESPA_WORKER] ✓ VespaWorker shut down');
	}
}

// Export singleton instance
export const vespaWorker = new VespaWorker();
