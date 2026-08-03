import { logger } from '@/utils/logger';
import {
  roomCurationQueue,
  ROOM_CURATION_ROOM_JOB,
  ROOM_CURATION_TICK_JOB,
  RoomCurationJobData,
} from '@/queues/roomCurationQueue';
import { curateRoom, findDueRoomIds } from '@/services/roomCurationService';

class RoomCurationWorker {
  private isInitialized = false;

  async start(): Promise<void> {
    if (this.isInitialized) return;

    await roomCurationQueue.initialize();

    if (!roomCurationQueue.isReady) {
      logger.warn('[ROOM-CURATION-WORKER] Queue unavailable — cadence-based curation disabled');
      return;
    }

    const queue = roomCurationQueue.getQueue();

    queue.process(ROOM_CURATION_TICK_JOB, async () => {
      return this.processTickJob();
    });

    queue.process(ROOM_CURATION_ROOM_JOB, async (job) => {
      return this.processRoomJob(job.data);
    });

    // Scheduled here rather than in initialize() so only a process that actually
    // consumes the tick can create it.
    await roomCurationQueue.scheduleRepeatableJob();

    this.isInitialized = true;
    logger.info('[ROOM-CURATION-WORKER] Started, ready to process jobs');
  }

  private async processTickJob(): Promise<void> {
    const dueRoomIds = await findDueRoomIds();
    logger.info(`[ROOM-CURATION-WORKER] Scheduler tick: ${dueRoomIds.length} room(s) due`);
    for (const roomId of dueRoomIds) {
      await roomCurationQueue.enqueueRoom(roomId);
    }
  }

  private async processRoomJob(data: RoomCurationJobData): Promise<void> {
    const { roomId } = data;
    if (!roomId) {
      logger.warn('[ROOM-CURATION-WORKER] Received a curate-room job without a roomId — skipping');
      return;
    }

    logger.info(`[ROOM-CURATION-WORKER] Curating room ${roomId}...`);
    await curateRoom(roomId, data.force ?? false);
    logger.info(`[ROOM-CURATION-WORKER] Curation completed for room ${roomId}`);
  }

  async shutdown(): Promise<void> {
    await roomCurationQueue.close();
    this.isInitialized = false;
    logger.info('[ROOM-CURATION-WORKER] Shut down');
  }
}

export const roomCurationWorker = new RoomCurationWorker();
