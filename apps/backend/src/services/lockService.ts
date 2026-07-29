import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';

const LOCK_TTL_SECONDS = Math.ceil(config.workflow.lockDurationMs / 1000);
const LOCK_KEY_PREFIX = 'workflow:lock:';

export class LockService {
  private lockKey(executionId: string): string {
    return `${LOCK_KEY_PREFIX}${executionId}`;
  }

  async setLock(executionId: string, workerId: string): Promise<boolean> {
    const result =await redisService.set(this.lockKey(executionId), workerId, LOCK_TTL_SECONDS);
    return result;
  }

  async renewLock(executionId: string): Promise<boolean> {
    try {
      const client = redisService.getClient();
      const result = await client.expire(this.lockKey(executionId), LOCK_TTL_SECONDS);
      return result === 1;
    } catch (error) {
      logger.error(`Error renewing lock for execution ${executionId}: ${error}`);
      return false;
    }
  }

  async releaseLock(executionId: string): Promise<void> {
    try {
      await redisService.del(this.lockKey(executionId));
    } catch (error) {
      logger.error(`Error releasing lock for execution ${executionId}: ${error}`);
    }
  }

  async getLockOwner(executionId: string): Promise<string | null> {
    return redisService.get(this.lockKey(executionId));
  }

  async getExpiredExecutionIds(runningIds: string[]): Promise<string[]> {
    if (runningIds.length === 0) return [];
    try {
      const client = redisService.getClient();
      const keys = runningIds.map(id => this.lockKey(id));
      const values = await client.mget(...keys);
      return runningIds.filter((_, i) => values[i] === null);
    } catch (error) {
      logger.error(`Error checking lock expiry for running executions: ${error}`);
      return [];
    }
  }
}
