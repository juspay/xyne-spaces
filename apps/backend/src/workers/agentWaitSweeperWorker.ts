import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { restartWikiRuns, sweepParkedAgentSteps } from '@/bypassAcl/agentWaitSweeper';

const JOB = 'sweep-agent-waits';
const EVERY_15_MINUTES = '*/15 * * * *';

/** Ends workflow agent steps whose claw result was lost, then restarts Wiki runs that failed in a window. */
class AgentWaitSweeperWorker {
  private queue: Bull.Queue | null = null;
  private running = false;

  async start(): Promise<void> {
    if (this.queue) return;
    this.queue = new Bull('agent-wait-sweeper', {
      redis: { ...redisService.getRedisConfig(), lazyConnect: false },
      defaultJobOptions: { removeOnComplete: true, removeOnFail: true },
    });
    this.queue.on('error', (error) => logger.error('[AGENT-WAIT-SWEEPER] Queue error:', error));
    this.queue.process(JOB, async () => {
      if (this.running) return;
      this.running = true;
      try {
        // Fail dead steps first, so a run they end can be restarted in the same tick.
        await sweepParkedAgentSteps();
        await restartWikiRuns();
      } finally {
        this.running = false;
      }
    });
    await this.queue.add(JOB, {}, { repeat: { cron: EVERY_15_MINUTES }, jobId: `${JOB}-repeatable` });
    logger.info('[AGENT-WAIT-SWEEPER] Started (every 15 minutes)');
  }

  async stop(): Promise<void> {
    await this.queue?.close();
    this.queue = null;
  }
}

export const agentWaitSweeperWorker = new AgentWaitSweeperWorker();
