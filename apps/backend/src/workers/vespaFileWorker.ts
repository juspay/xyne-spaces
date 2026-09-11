import Bull from 'bull';
import { IngestionStatus, VespaInsertionStatus } from '@xyne/shared';
import vespaClient from '@/vespa/client';
import { logger } from '@/utils/logger';
import { InsertDocument, fileSchema, VespaSchema } from '@/vespa/src/types';
import { VespaJob, VespaJobType } from '@/zero/vespa-injection/core/types';
import { db } from '@/database/client';
import { NAMESPACE } from '@/vespa/vespaConfig';
import { fetchAndMapBySchema, fetchDataBySchema, mapBySchema, computeCanvasPermissions, VespaOperationType } from '@/zero/vespa-injection/core/mapper';
import { vespaPostIngestHooks } from './vespaPostIngestHooks';
import { superpositionClient } from '@/services/superpositionClient';
import { routePdfToScheduler } from '@/services/ingestion/docling/scheduler/intake';
import { config } from '@/config/env';
import { SubApp } from '@/vespa/src/types';
import { maybeNotifyCollectionIngestionComplete } from '@/services/collectionIngestionNotifier';

export class VespaFileWorker {
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

			// File worker connects to the file-specific queue
			const queueName = process.env.VESPA_FILE_QUEUE_NAME || 'vespa-files';
			this.queue = new Bull<VespaJob>(queueName, {
				redis: redisConfig,
				defaultJobOptions: {
					attempts: 3,
					backoff: {
						type: 'exponential',
						delay: 2000,
					},
				},
				settings: {
					stalledInterval: 30 * 1000,
					maxStalledCount: 1,
				}
			});

			logger.info(`[VESPA_FILE_WORKER] Connected to ${queueName} queue`);

			// Setup the worker to process jobs
			this.setupWorker();

			this.isInitialized = true;
		} catch (error) {
			logger.error('[VESPA_FILE_WORKER] Failed to initialize worker:', error);
			this.isInitialized = false;
		} finally {
			this.isInitializing = false;
		}
	}

	/**
	 * Start the worker
	 */
	async start(): Promise<void> {
		if (!this.isInitialized) {
			await this.initialize();
		}
		logger.info('[VESPA_FILE_WORKER] VespaFileWorker started successfully');
	}

	/**
	 * Set up the worker to process jobs
	 */
	private setupWorker(): void {
		if (!this.queue) {
			logger.error('[VESPA_FILE_WORKER] Cannot setup worker - queue is not available');
			return;
		}

		// Process file jobs with configured concurrency (default: 1 for heavy operations)
		const concurrency = parseInt(process.env.VESPA_FILE_WORKER_CONCURRENCY || '1', 10);
		this.queue.process('*', concurrency, async (job) => {
			return this.processJob(job);
		});

		// Event: Job completed
		this.queue.on('completed', (job) => {
			logger.info(
				`[VESPA_FILE_WORKER] Job ${job.id} completed: ${job.data.schema}/${job.data.docId}`
			);
		});

		// Event: Job failed
		this.queue.on('failed', async (job, err) => {
			// After max retries, record in database
			if (job.attemptsMade >= (job.opts.attempts || 3)) {
				await this.recordFailedJob(job, err);
				logger.warn(
					`[VESPA_FILE_WORKER] Recorded failed job ${job.id} to database after ${job.attemptsMade} failed attempts`
				);
			}
		});
	}

	/**
	 * Record a failed job in the database
	 */
	private async recordFailedJob(job: Bull.Job<VespaJob>, error: Error): Promise<void> {
		// Mark collection item as FAILED
		if (job.data.schema === fileSchema) {
			await this.updateCollectionItemStatus(job.data.docId, job.data.app, IngestionStatus.FAILED);
		}

		try {
			const entityId = job.data.docId;
			const entityType = job.data.schema;
			const userId = job.data.userId || null;
			const workspaceId = job.data.workspaceId;
			if (!workspaceId) {
				throw new Error('workspaceId required: vespa job missing workspaceId');
			}
			await db.vespaInsertionLogs.create({
				data: {
					entityId,
					entityType,
					workspaceId,
					type: VespaOperationType[job.data.jobType],
					status: VespaInsertionStatus.FAILED,
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

			logger.info(`[VESPA_FILE_WORKER] ✓ Recorded failed job ${job.id} in database`);
		} catch (dbError) {
			logger.error(`[VESPA_FILE_WORKER] Failed to record job ${job.id} failure in database:`, dbError);
		}
	}

	/**
	 * Update ingestionStatus for a collection item identified by fileId.
	 * No-op for non-collection file jobs.
	 */
	private async updateCollectionItemStatus(fileId: string, app: SubApp | undefined, status: IngestionStatus): Promise<void> {
		if (app !== SubApp.COLLECTIONS) return;
		try {
			const item = await db.collectionItem.findFirst({
				where: { fileId, isLatest: true },
				select: { id: true },
			});
			if (item) {
				await db.collectionItem.update({
					where: { id: item.id },
					data: { ingestionStatus: status },
				});
				// When a file reaches a terminal state, check whether the whole
				// collection is now done and, if so, notify the owner (fire-and-forget).
				if (status === IngestionStatus.COMPLETED || status === IngestionStatus.FAILED) {
					void maybeNotifyCollectionIngestionComplete(fileId).catch(() => {});
				}
			}
		} catch (err) {
			logger.warn(`[VESPA_FILE_WORKER] Failed to update ingestionStatus for ${fileId}`, {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	/**
	 * Process a single job from the queue
	 */
	private async processJob(job: Bull.Job<VespaJob>): Promise<any> {
		const { schema, docId, jobType, app } = job.data;

		logger.info(
			`[VESPA_FILE_WORKER] Processing ${jobType} job for ${schema}/${docId} (Job ID: ${job.id})`
		);

		if (job.data.nameOnly) {
			logger.info(
				`[VESPA_FILE_WORKER] NAME-ONLY feed for ${schema}/${docId} (Job ID: ${job.id}, priority: ${job.opts?.priority}) — inserting file name/metadata only, skipping content parse`
			);
		}

		try {
			// Route PDFs (collections + chat/ticket attachments) into the async OCR
			// scheduler (if enabled). When routed, the scheduler owns processing —
			// skip synchronous parsing. The name-only feed never parses content, so
			// it must not be routed to the scheduler.
			if (
				jobType === 'feed' &&
				schema === fileSchema &&
				!job.data.nameOnly &&
				(app === SubApp.COLLECTIONS ||
					app === SubApp.CHAT_ATTACHMENT ||
					app === SubApp.TICKET_ATTACHMENT)
			) {
				const routed = await routePdfToScheduler(docId, app);
				if (routed) {
					logger.info(
						`[VESPA_FILE_WORKER] Routed ${docId} (${app}) to async OCR scheduler; skipping sync processing`,
					);
					return;
				}
			}

			// Check if file indexing is enabled
			if (jobType === 'feed' && schema === fileSchema) {
				const isFileIndexingEnabled = await superpositionClient.getBooleanValue(
					'enable_file_indexing',
					config.enableFileIndexing,
				);
				if (!isFileIndexingEnabled) {
					await job.discard();
					throw new Error(`File indexing is disabled. Skipping feed for ${schema}/${docId}`);
				}

				// Mark as processing
				await this.updateCollectionItemStatus(docId, app, IngestionStatus.PROCESSING);
			}

			let mappedData: InsertDocument | Partial<InsertDocument>;

			const preTransformedData = job.data.data;

			if (jobType === 'delete') {
				mappedData = {};
			} else if (preTransformedData) {
				// Use pre-transformed data if available (e.g., from SAM transcripts)
				logger.info(`[VESPA_FILE_WORKER] Using pre-transformed data for ${docId}`);
				mappedData = preTransformedData as InsertDocument;
			} else if (jobType === 'update' && job.data.fields?.length) {
				// Field-scoped partial update: send only the requested fields. Because
				// `chunks` isn't sent, Vespa does not re-embed — this is what keeps the
				// membership fan-out (re-computing canvas ACLs) cheap.
				const fields = job.data.fields;
				if (app === SubApp.CANVAS && fields.length === 1 && fields[0] === 'permissions') {
					// Fast path: canvas ACL refresh — recompute just permissions, skip the
					// content extraction/embedding a full mapCanvas would do.
					mappedData = { permissions: await computeCanvasPermissions(docId) } as Partial<InsertDocument>;
				} else {
					const rawData = await fetchDataBySchema(schema, docId, app);
					if (!rawData) {
						throw new Error(`Data not found for ${schema}/${docId}`);
					}
					const fullDoc = await mapBySchema(schema, rawData, 'feed', app, job.data.workspaceId, job.data.orgId);
					mappedData = Object.fromEntries(
						fields
							.filter((field) => field in fullDoc)
							.map((field) => [field, (fullDoc as Record<string, unknown>)[field]])
					) as Partial<InsertDocument>;
				}
			} else {
				logger.info(
					`[VESPA_FILE_WORKER] Fetching data from database for ${schema}/${docId}${job.data.nameOnly ? ' (name-only)' : ''}`
				);
				mappedData = await fetchAndMapBySchema(
					schema,
					docId,
					jobType,
					app,
					job.data.workspaceId,
					job.data.orgId,
					job.data.nameOnly,
				);
			}

			const handlers: Record<VespaJobType, () => Promise<void>> = {
				feed: () => this.handleFeed(schema, mappedData as InsertDocument),
				update: () => this.handleUpdate(docId, schema, mappedData as InsertDocument),
				delete: () => this.handleDelete(schema, docId),
			};

			const handler = handlers[jobType];
			if (!handler) {
				throw new Error(`Unknown job type: ${jobType}`);
			}

			await handler();

			// Mark as completed after successful feed. The name-only feed indexes just
			// the file name (content not yet parsed), so it must not flip the status
			// to COMPLETED — the later full feed does that.
			if (jobType === 'feed' && schema === fileSchema && !job.data.nameOnly) {
				await this.updateCollectionItemStatus(docId, app, IngestionStatus.COMPLETED);
			}

			// Run post-ingest hooks (non-blocking)
			void vespaPostIngestHooks
				.run({ schema, docId, jobType, mappedData, userId: job.data.userId })
				.catch((error) => {
					logger.error('[VESPA_FILE_WORKER] Post-ingest hook failed', {
						schema,
						docId,
						jobType,
						error: error,
					});
				});
		} catch (error) {
			logger.error(`[VESPA_FILE_WORKER] Failed to process ${jobType} for ${schema}/${docId}:`, error);
			throw error;
		}
	}

	/**
	 * Handle feed operation
	 */
	private async handleFeed(schema: VespaSchema, data: InsertDocument): Promise<void> {
		logger.info(`[VESPA_FILE_WORKER]: feed ${schema}/${data.docId}`);
		const [result] = await vespaClient.crudService.insert([data], schema);
		if (!result.success) {
			throw new Error(`Failed to insert ${data.docId}: ${result.error}`);
		}
	}

	/**
	 * Handle update operation
	 */
	private async handleUpdate(docId: string, schema: VespaSchema, data: Partial<InsertDocument>): Promise<void> {
		logger.info(`[VESPA_FILE_WORKER]: update ${schema}/${docId}`);
		const [result] = await vespaClient.crudService.update([{ docId, fields: data }], schema);
		if (!result.success) {
			throw new Error(`Failed to update ${docId}: ${result.error}`);
		}
	}

	/**
	 * Handle delete operation
	 */
	private async handleDelete(schema: VespaSchema, docId: string): Promise<void> {
		logger.info(`[VESPA_FILE_WORKER]: delete ${schema}/${docId}`);
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
		logger.info('[VESPA_FILE_WORKER] Shutting down...');
		if (this.queue) {
			await this.queue.close();
		}
		logger.info('[VESPA_FILE_WORKER] ✓ Shutdown complete');
	}
}

// Export singleton instance
export const vespaFileWorker = new VespaFileWorker();