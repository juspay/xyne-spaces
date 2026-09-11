import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';

/**
 * Where the tickets sitting on one retired stage should land. Fully resolved at prepare
 * time and carried in the job payload because the old Stage row no longer exists by the
 * time this job runs — the client's `board.update` deleted it as part of committing the
 * new configuration, so nothing can be re-derived from the board itself.
 */
export interface BoardConfigCopyTicketRemap {
  oldStageId: string;
  oldStageName: string;
  newStageId: string;
  newStageName: string;
  newStageEta: number | null;
  newStageStatusV2: string;
  futureStagesEtaHours: number;
}

/** A custom field present on both boards, whose existing ticket values must follow the new form. */
export interface BoardConfigCopyFieldRepoint {
  oldFieldId: string;
  newFieldId: string;
}

/**
 * Ticket-level work only. Board configuration (stages, transitions, form binding, roles,
 * metadata) is committed by the dashboard through the ordinary Zero mutators before this
 * job is ever enqueued — see boardConfigCopyService.prepareCopy. Everything here is work
 * whose cost scales with the number of tickets on the board.
 */
export interface BoardConfigCopyJobData {
  targetBoardId: string;
  workspaceId: string;
  actorUserId: string;
  ticketRemap: BoardConfigCopyTicketRemap[];
  fieldRepoints: BoardConfigCopyFieldRepoint[];
  // Both null when custom fields weren't part of this copy; required together otherwise.
  targetOldFormId: string | null;
  clonedFormId: string | null;
  // Object-storage path of the pre-copy snapshot, carried so the job result can surface it.
  snapshotPath: string;
}

export interface BoardConfigCopySummary {
  batches: number;
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
  failedTicketIds: string[];
  fieldValuesRepointed: number;
  snapshotPath?: string;
  warnings: string[];
}

class BoardConfigCopyQueue {
  private queue: Bull.Queue<BoardConfigCopyJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) return;
    this.isInitializing = true;

    try {
      this.queue = new Bull<BoardConfigCopyJobData>('board-config-copy', {
        redis: {
          ...redisService.getRedisConfig(),
          lazyConnect: false,
        },
        defaultJobOptions: {
          attempts: 1,
          removeOnComplete: 50,
          removeOnFail: 100,
        },
        settings: {
          lockDuration: 600000, // 10 min — auto-renewed while the processor is active
          stalledInterval: 60000, // 1 min
          maxStalledCount: 1,
        },
      });

      this.setupEventListeners();
      this.isInitialized = true;
      logger.info('[BOARD-CONFIG-COPY-QUEUE] Initialized');
    } catch (err) {
      logger.error('[BOARD-CONFIG-COPY-QUEUE] Failed to initialize:', err);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * jobId is always the target board id, so at most one copy can run per target
   * board at a time and the frontend can always re-derive the job id to poll status.
   */
  async addJob(data: BoardConfigCopyJobData): Promise<{ enqueued: boolean; reason?: string }> {
    if (!this.queue || !this.isInitialized) {
      throw new Error('[BOARD-CONFIG-COPY-QUEUE] Queue not initialized');
    }

    const existing = await this.queue.getJob(data.targetBoardId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'waiting' || state === 'active' || state === 'delayed') {
        logger.info(
          `[BOARD-CONFIG-COPY-QUEUE] Job already in progress for targetBoardId=${data.targetBoardId} state=${state}`,
        );
        return { enqueued: false, reason: `A copy is already ${state} for this board` };
      }
      // Stale completed/failed job for this board id — clear it before re-queuing so the
      // deterministic jobId can be reused and the status endpoint reflects the new run.
      await existing.remove();
    }

    await this.queue.add(data, { jobId: data.targetBoardId });
    logger.info(`[BOARD-CONFIG-COPY-QUEUE] Enqueued job targetBoardId=${data.targetBoardId}`);
    return { enqueued: true };
  }

  getQueue(): Bull.Queue<BoardConfigCopyJobData> {
    if (!this.queue) {
      throw new Error('[BOARD-CONFIG-COPY-QUEUE] Queue not initialized — call initialize() first');
    }
    return this.queue;
  }

  get isReady(): boolean {
    return this.isInitialized && this.queue !== null;
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, err) => {
      logger.error(
        `[BOARD-CONFIG-COPY-QUEUE] Job ${job.id} failed targetBoardId=${job.data.targetBoardId}:`,
        err,
      );
    });

    this.queue.on('stalled', job => {
      logger.warn(`[BOARD-CONFIG-COPY-QUEUE] Job ${job.id} stalled targetBoardId=${job.data.targetBoardId}`);
    });

    this.queue.on('error', err => {
      logger.error('[BOARD-CONFIG-COPY-QUEUE] Queue error:', err);
    });
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.isInitialized = false;
      logger.info('[BOARD-CONFIG-COPY-QUEUE] Closed');
    }
  }
}

export const boardConfigCopyQueue = new BoardConfigCopyQueue();
