import { logger } from '@/utils/logger';
import { recordingRepairQueue } from '@/queues/recordingRepairQueue';

class RecordingRepairWorker {
  private started = false;
  private recoveryTimer: NodeJS.Timeout | null = null;

  private recover(): void {
    void recordingRepairQueue.recoverPending().catch(error =>
      logger.error('[RecordingRepairWorker] Recovery sweep failed', error),
    );
  }

  start(): void {
    if (this.started) return;
    recordingRepairQueue.startConsumer();
    this.recover();
    this.recoveryTimer = setInterval(() => this.recover(), 60_000);
    this.started = true;
    logger.info('[RecordingRepairWorker] Worker started');
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    this.recoveryTimer = null;
    await recordingRepairQueue.close();
    this.started = false;
  }
}

export const recordingRepairWorker = new RecordingRepairWorker();
