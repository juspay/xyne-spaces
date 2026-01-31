import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';

export class LockService {
  private readonly LOCK_DURATION = config.workflow.lockDurationMs;
  private db = DatabaseClient.getInstance();

  async tryAcquireLock(executionId: string, workerId: string): Promise<boolean> {
    try {
      await this.db.workflowExecutionLock.create({
        data: {
          workflowExecutionId: executionId,
          workerId: workerId,
          expiry: new Date(Date.now() + this.LOCK_DURATION)
        }
      });

      // logger.info(`Lock acquired for execution ${executionId} by worker ${workerId}`);
      return true;

    } catch (error) {
      const existingLock = await this.db.workflowExecutionLock.findUnique({
        where: { workflowExecutionId: executionId }
      });

      if (!existingLock) {
        logger.warn(`Failed to acquire lock for execution ${executionId}: ${error}`);
        return false;
      }

      const now = new Date();
      if (existingLock.expiry > now) {
        logger.debug(`Execution ${executionId} locked by ${existingLock.workerId}, expires at ${existingLock.expiry}`);
        return false;
      }

      try {
        await this.db.$transaction([
          this.db.workflowExecutionLock.delete({
            where: { workflowExecutionId: executionId }
          }),
          this.db.workflowExecutionLock.create({
            data: {
              workflowExecutionId: executionId,
              workerId: workerId,
              expiry: new Date(Date.now() + this.LOCK_DURATION)
            }
          })
        ]);

        logger.info(`Took over expired lock for execution ${executionId}, previous owner: ${existingLock.workerId}`);
        return true;

      } catch (transactionError) {
        logger.warn(`Failed to take over expired lock for execution ${executionId}: ${transactionError}`);
        return false;
      }
    }
  }

  async renewLock(executionId: string, workerId?: string): Promise<boolean> {
    try {
      const whereClause = workerId
        ? {
            workflowExecutionId: executionId,
            workerId: workerId,
            expiry: { gt: new Date() }
          }
        : {
            workflowExecutionId: executionId,
            expiry: { gt: new Date() }
          };

      const result = await this.db.workflowExecutionLock.updateMany({
        where: whereClause,
        data: {
          expiry: new Date(Date.now() + this.LOCK_DURATION),
          updatedAt: new Date()
        }
      });

      const renewed = result.count > 0;
      // if (renewed) {
      //   logger.debug(`Lock renewed for execution ${executionId}`);
      // } else {
      //   logger.warn(`Failed to renew lock for execution ${executionId} - lock may be lost`);
      // }

      return renewed;

    } catch (error) {
      logger.error(`Error renewing lock for execution ${executionId}: ${error}`);
      return false;
    }
  }

  async releaseLock(executionId: string, workerId: string): Promise<void> {
    try {
      const result = await this.db.workflowExecutionLock.deleteMany({
        where: {
          workflowExecutionId: executionId,
          workerId: workerId
        }
      });

      if (result.count > 0) {
        // logger.info(`Lock released for execution ${executionId} by worker ${workerId}`);
      } else {
        logger.warn(`No lock found to release for execution ${executionId} by worker ${workerId}`);
      }

    } catch (error) {
      logger.error(`Error releasing lock for execution ${executionId}: ${error}`);
    }
  }
}