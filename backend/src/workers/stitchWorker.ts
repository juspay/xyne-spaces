import { logger } from '@/utils/logger';
import { recordingStitchQueue } from '@/queues/recordingStitchQueue';

/**
 * Stitch Worker
 *
 * Consumes the `recording-stitch` queue: downloads a recording's HLS segments
 * from storage, remuxes them into a single MP4 (ffmpeg), and uploads it back
 * (logic in callRecordingService.stitchRecording).
 *
 * Runs as its own worker so the CPU/disk-heavy ffmpeg work is isolated and can
 * scale independently. Deploy a dedicated stitch node by enabling ONLY
 * ENABLE_STITCH_WORKER on that deployment. The API never registers a consumer
 * (enqueue is producer-only), so ffmpeg never runs in the API process.
 */
export class StitchWorker {
  private static instance: StitchWorker;
  private started = false;

  private constructor() {}

  public static getInstance(): StitchWorker {
    if (!StitchWorker.instance) {
      StitchWorker.instance = new StitchWorker();
    }
    return StitchWorker.instance;
  }

  public start(): void {
    if (this.started) {
      logger.warn('[StitchWorker] Worker already running');
      return;
    }

    logger.info('[StitchWorker] Starting worker');
    recordingStitchQueue.startConsumer();
    this.started = true;
    logger.info('[StitchWorker] Worker started successfully');
  }

  public async stop(): Promise<void> {
    if (!this.started) return;
    await recordingStitchQueue.close();
    this.started = false;
    logger.info('[StitchWorker] Worker stopped');
  }
}

export const stitchWorker = StitchWorker.getInstance();
