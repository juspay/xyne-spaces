/**
 * "A gap repair is polling this account right now", shared through Redis: repairs run in the stream
 * worker, manual fetches in another worker. A manual fetch that sees it stops (it would only read
 * the same data again); a repair never waits for a manual fetch. The flag expires on its own, so a
 * crashed worker cannot leave it set.
 */
import { redisService } from '@/services/redisService';

const key = (sourceId: string) => `x:gap-repair:${sourceId}`;
/** Longer than any repair takes (polls are capped); only matters if a worker dies mid-repair. */
const FLAG_TTL_S = 30 * 60;

export interface XRepairFlag {
  set(sourceId: string): Promise<void>;
  clear(sourceId: string): Promise<void>;
}

export const redisRepairFlag: XRepairFlag = {
  set: async (sourceId) => {
    await redisService.set(key(sourceId), '1', FLAG_TTL_S);
  },
  clear: (sourceId) => redisService.del(key(sourceId)),
};

export const isXGapRepairRunning = (sourceId: string): Promise<boolean> => redisService.exists(key(sourceId));

/** Shown when a manual fetch is refused because a repair is reading the same account. */
export const X_REPAIR_RUNNING_MESSAGE =
  'X is catching up on missed messages for this account. Try "Fetch from X" again in a few minutes.';
