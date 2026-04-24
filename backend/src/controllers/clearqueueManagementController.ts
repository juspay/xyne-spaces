import { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { stageEtaDeadlineQueue } from '@/queues/stageEtaDeadlineQueue';
import { etaDeadlineQueue } from '@/queues/etaDeadlineQueue';

const QUEUE_MAP: Record<string, any> = {
  'stage-eta-deadline': stageEtaDeadlineQueue,
  'eta-deadline': etaDeadlineQueue,
};

interface RepeatableJob {
  name: string;
  key: string;
  cron: string;
  next: number;
}

export class ClearqueueManagementController {
  static async getQueueStats(req: Request, res: Response) {
    try {
      const { queueName } = req.params;
      const queueInstance = QUEUE_MAP[queueName];

      if (!queueInstance) {
        return res.status(404).json({
          success: false,
          error: `Unknown queue: ${queueName}. Available: ${Object.keys(QUEUE_MAP).join(', ')}`
        });
      }

      if (!queueInstance.isReady) {
        await queueInstance.initialize();
      }

      const queue = queueInstance.getQueue();

      const [waiting, active, delayed, completed, failed, repeatableJobs] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getDelayedCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getRepeatableJobs(),
      ]);

      res.json({
        success: true,
        queue: queueName,
        counts: {
          waiting,
          active,
          delayed,
          completed,
          failed,
          total: waiting + active + delayed + completed + failed,
        },
        repeatableJobs: repeatableJobs.map((j: RepeatableJob) => ({
          name: j.name,
          key: j.key,
          cron: j.cron,
          next: new Date(j.next).toISOString(),
        })),
      });
      return;
    } catch (error) {
      logger.error('[QUEUE-MGMT] Error getting queue stats:', error);
      res.status(500).json({ success: false, error: String(error) });
      return;
    }
  }

  static async clearQueue(req: Request, res: Response) {
    try {
      const { queueName } = req.params;
      const { repeatableOnly = false } = req.body;
      const queueInstance = QUEUE_MAP[queueName];

      if (!queueInstance) {
        return res.status(404).json({
          success: false,
          error: `Unknown queue: ${queueName}. Available: ${Object.keys(QUEUE_MAP).join(', ')}`
        });
      }

      if (!queueInstance.isReady) {
        await queueInstance.initialize();
      }

      const queue = queueInstance.getQueue();
      const results: Record<string, number | string[]> = {};

      // Remove repeatable jobs
      const repeatableJobs = await queue.getRepeatableJobs();
      for (const job of repeatableJobs) {
        await queue.removeRepeatableByKey(job.key);
      }
      results.repeatableJobsRemoved = repeatableJobs.length;
      results.removedJobKeys = repeatableJobs.map((j: RepeatableJob) => j.key);

      if (!repeatableOnly) {
        // Clean all job states
        const [completed, waiting, active, delayed, failed] = await Promise.all([
          queue.clean(0, 'completed'),
          queue.clean(0, 'wait'),
          queue.clean(0, 'active'),
          queue.clean(0, 'delayed'),
          queue.clean(0, 'failed'),
        ]);

        results.completedRemoved = completed.length;
        results.waitingRemoved = waiting.length;
        results.activeRemoved = active.length;
        results.delayedRemoved = delayed.length;
        results.failedRemoved = failed.length;
      }

      res.json({
        success: true,
        queue: queueName,
        results,
      });
      return;
    } catch (error) {
      logger.error('[QUEUE-MGMT] Error clearing queue:', error);
      res.status(500).json({ success: false, error: String(error) });
      return;
    }
  }

  static async getAllStats(_req: Request, res: Response) {
    try {
      const results: Record<string, any> = {};

      for (const [name, queueInstance] of Object.entries(QUEUE_MAP)) {
        try {
          if (!queueInstance.isReady) {
            await queueInstance.initialize();
          }
          const queue = queueInstance.getQueue();

          const [waiting, active, delayed, repeatableJobs] = await Promise.all([
            queue.getWaitingCount(),
            queue.getActiveCount(),
            queue.getDelayedCount(),
            queue.getRepeatableJobs(),
          ]);

          results[name] = {
            waiting,
            active,
            delayed,
            repeatableJobsCount: repeatableJobs.length,
            repeatableJobs: repeatableJobs.map((j: RepeatableJob) => ({
              name: j.name,
              cron: j.cron,
              next: new Date(j.next).toISOString(),
            })),
          };
        } catch (err) {
          results[name] = { error: String(err) };
        }
      }

      res.json({ success: true, queues: results });
    } catch (error) {
      logger.error('[QUEUE-MGMT] Error getting all stats:', error);
      res.status(500).json({ success: false, error: String(error) });
    }
  }
}
