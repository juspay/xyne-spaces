import Bull from 'bull';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';
import { teamIntelligenceReportService } from '@/services/teamIntelligenceReport/reportService';

type TeamIntelligenceReportJobData = {
  reportId: string;
};

class TeamIntelligenceReportQueue {
  private queue: Bull.Queue<TeamIntelligenceReportJobData> | null = null;
  private workerInitialized = false;

  private async ensureQueue(): Promise<Bull.Queue<TeamIntelligenceReportJobData>> {
    if (this.queue) {
      return this.queue;
    }

    this.queue = new Bull<TeamIntelligenceReportJobData>('team-intelligence-reports', {
      redis: {
        ...redisService.getRedisConfig(),
        lazyConnect: false,
      },
      defaultJobOptions: {
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });

    return this.queue;
  }

  async initializeWorker(): Promise<void> {
    const queue = await this.ensureQueue();
    if (this.workerInitialized) {
      return;
    }

    queue.process('generate', async job => {
      await teamIntelligenceReportService.processReport(job.data.reportId);
    });

    queue.on('failed', (job, error) => {
      logger.error('[TEAM_INTELLIGENCE] Queue job failed', {
        jobName: job.name,
        jobId: job.id,
        reportId: job.data.reportId,
        error: error.message,
      });
    });

    queue.on('error', error => {
      logger.error('[TEAM_INTELLIGENCE] Queue error', error);
    });

    this.workerInitialized = true;
    logger.info('[TEAM_INTELLIGENCE] Report queue initialized');
  }

  async enqueueGeneration(reportId: string): Promise<void> {
    const queue = await this.ensureQueue();
    await queue.add(
      'generate',
      { reportId },
      { jobId: `team-intelligence-report-${reportId}` }
    );
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }

    this.workerInitialized = false;
  }
}

export const teamIntelligenceReportQueue = new TeamIntelligenceReportQueue();
