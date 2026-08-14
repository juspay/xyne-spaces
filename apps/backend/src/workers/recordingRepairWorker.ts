import { logger } from '@/utils/logger';
import { recordingRepairQueue } from '@/queues/recordingRepairQueue';
import { recordingRepairService } from '@/services/recordingRepairService';
import { recordingRepairStateService } from '@/services/recordingRepairStateService';

class RecordingRepairWorker {
  private started = false;
  private recoveryTimer: NodeJS.Timeout | null = null;
  private lastCleanupAt = 0;
  private recoveryRunning = false;

  private recover(): void {
    if (this.recoveryRunning) return;
    this.recoveryRunning = true;
    const now = Date.now();
    const cleanupDue = now - this.lastCleanupAt >= 6 * 60 * 60_000;
    if (cleanupDue) this.lastCleanupAt = now;
    void Promise.all([
      recordingRepairQueue.recoverPending(),
      recordingRepairService.recoverPendingArtifacts(),
      recordingRepairStateService.purgeCompleted(),
      ...(cleanupDue ? [recordingRepairService.cleanupStaleObjects(now)] : []),
    ])
      .catch((error) => logger.error('[RecordingRepairWorker] Recovery sweep failed', error))
      .finally(() => {
        this.recoveryRunning = false;
      });
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
