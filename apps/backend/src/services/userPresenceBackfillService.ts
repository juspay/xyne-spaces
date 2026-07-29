import { db } from '@/database/client';
import { logger } from '@/utils/logger';

export interface PresenceBackfillConfig {
  batchSize: number;
  sleepMs: number;
}

export interface PresenceBackfillResult {
  total: number;
  updated: number;
  skipped: number;
  startTime: string;
  endTime: string;
}

const DEFAULT_CONFIG: PresenceBackfillConfig = {
  batchSize: 100,
  sleepMs: 1000,
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Backfills the four presence display columns (statusEmoji, statusContent,
 * statusExpiryAt, lastActiveAt) from user_presence into the users table.
 *
 * This is a one-time migration helper. After it runs, the mutator dual-write
 * keeps both tables in sync going forward.
 * NOTE: Run `prisma generate` before deploying so the User model includes
 * the new columns (statusEmoji, statusContent, statusExpiryAt, lastActiveAt).
 */
export class UserPresenceBackfillService {
  async backfillPresenceToUsers(
    config: Partial<PresenceBackfillConfig> = {},
  ): Promise<PresenceBackfillResult> {
    const { batchSize, sleepMs } = { ...DEFAULT_CONFIG, ...config };
    const startTime = new Date();

    logger.info(
      `[PRESENCE-BACKFILL] Starting — batchSize=${batchSize}, sleepMs=${sleepMs}`,
    );

    let total = 0;
    let updated = 0;
    let skipped = 0;
    let cursor: string | undefined;

    while (true) {
      const batch = await db.userPresence.findMany({
        take: batchSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: {
          id: true,
          userId: true,
          statusEmoji: true,
          statusContent: true,
          statusExpiryAt: true,
          lastActiveAt: true,
          notificationsPausedUntil: true,
          assignmentUnavailableUntil: true,
        },
        orderBy: { id: 'asc' },
      });

      if (batch.length === 0) break;

      cursor = batch[batch.length - 1]!.id;
      total += batch.length;

      for (const presence of batch) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await db.user.update({
            where: { id: presence.userId },
            data: {
              statusEmoji: presence.statusEmoji,
              statusContent: presence.statusContent,
              statusExpiryAt: presence.statusExpiryAt,
              lastActiveAt: presence.lastActiveAt,
              notificationsPausedUntil: presence.notificationsPausedUntil,
              assignmentUnavailableUntil: presence.assignmentUnavailableUntil,
            },
          });
          updated++;
        } catch (err) {
          logger.error(
            `[PRESENCE-BACKFILL] Failed to update user ${presence.userId}:`,
            err,
          );
          skipped++;
        }
      }

      logger.info(
        `[PRESENCE-BACKFILL] Progress: ${total} processed, ${updated} updated, ${skipped} skipped`,
      );

      if (sleepMs > 0) await sleep(sleepMs);
    }

    const endTime = new Date();
    logger.info(
      `[PRESENCE-BACKFILL] Complete — total: ${total}, updated: ${updated}, skipped: ${skipped}, duration: ${endTime.getTime() - startTime.getTime()}ms`,
    );

    return {
      total,
      updated,
      skipped,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    };
  }
}

export const userPresenceBackfillService = new UserPresenceBackfillService();
