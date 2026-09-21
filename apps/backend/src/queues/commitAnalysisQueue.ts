import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { PrCommitAnalysisService } from '@/services/prCommitAnalysisService';
import { GitHubService } from '@/services/githubService';
import { BitbucketService } from '@/services/bitbucketService';
import { config } from '@/config/env';
import { DatabaseClient } from '@/database/client';
import { CommitAnalysisStatus } from '@/types/vcs';

export type VcsProvider = 'github' | 'bitbucket';

export interface CommitAnalysisJobData {
  workspaceId: string;
  prId: number;
  prInternalId: string; // PullRequests.id
  repositoryUrl: string;
  projectKey: string; // GitHub: owner, Bitbucket: projectKey
  repositorySlug: string; // GitHub: repo, Bitbucket: repoSlug
  vcsProvider: VcsProvider;
}

class CommitAnalysisQueue {
  private queue: Bull.Queue<CommitAnalysisJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) {
      return;
    }

    this.isInitializing = true;

    try {
      this.queue = new Bull<CommitAnalysisJobData>('commit-analysis', {
        redis: {
          ...redisService.getRedisConfig(),
          lazyConnect: false,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: true,
          removeOnFail: true,
          timeout: 180000,
        },
      });

      this.setupEventListeners();

      this.isInitialized = true;
      logger.info('[COMMIT-ANALYSIS] CommitAnalysisQueue initialized successfully (producer)');
    } catch (error) {
      logger.error('[COMMIT-ANALYSIS] Failed to initialize commit analysis queue:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Process a job (called by the worker)
   */
  async processJob(job: Bull.Job<CommitAnalysisJobData>): Promise<void> {
    logger.info(`[COMMIT-ANALYSIS] Job picked up by worker: ${job.id}`);

    const { prId, prInternalId, repositoryUrl, projectKey, repositorySlug, vcsProvider } = job.data;

    logger.info(`[COMMIT-ANALYSIS] Processing PR #${prId} (${vcsProvider}) - jobId: ${job.id}`);

    const db = DatabaseClient.getInstance();

    try {
      logger.info(`[COMMIT-ANALYSIS] Creating VCS client (${vcsProvider})`);

      // Select VCS client based on provider
      const vcsClient =
        vcsProvider === 'github'
          ? new GitHubService({
              token: config.github?.token,
              apiUrl: config.github?.apiUrl,
            })
          : new BitbucketService({
              baseUrl: config.bitbucket?.baseUrl || '',
              username: config.bitbucket?.apiUsername,
              password: config.bitbucket?.password,
              token: config.bitbucket?.apiToken,
            });

      logger.info(`[COMMIT-ANALYSIS] VCS client created, initializing analysis service`);
      const analysisService = new PrCommitAnalysisService(vcsClient);

      logger.info(`[COMMIT-ANALYSIS] Calling analyzePullRequestCommits for PR #${prId}`);
      // Analyze commits
      const result = await analysisService.analyzePullRequestCommits({
        prId,
        prInternalId,
        workspaceId: job.data.workspaceId,
        repositoryUrl,
        projectKey,
        repositorySlug,
      });

      logger.info(`[COMMIT-ANALYSIS] Analysis complete for PR #${prId}, updating database`);

      // Update PR with results
      await db.pullRequests.update({
        where: { id: prInternalId },
        data: {
          botCommitCount: result.botCommits,
          humanCommitCount: result.humanCommits,
          commitAnalysisStatus: result.status,
          commitAnalysisError: result.error,
          commitAnalyzedAt: new Date(),
        },
      });

      logger.info(
        `[COMMIT-ANALYSIS] Completed PR #${String(prId).replace(/[\r\n]/g, '')}: ${result.totalCommits} commits ` +
          `(${result.botCommits} bot, ${result.humanCommits} human)`,
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error).substring(0, 500);
      logger.error(`[COMMIT-ANALYSIS] Failed to analyze PR #${prId}: ${errorMsg}`);

      // Mark as failed in database
      await db.pullRequests.update({
        where: { id: prInternalId },
        data: {
          commitAnalysisStatus: CommitAnalysisStatus.FAILED,
          commitAnalysisError: errorMsg,
          commitAnalyzedAt: new Date(),
        },
      });

      throw error; // Bull will retry based on attempts config
    }
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('completed', (job) => {
      logger.info(`[COMMIT-ANALYSIS] ✅ Job ${job.id} completed successfully`);
    });

    this.queue.on('failed', (job, err) => {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[COMMIT-ANALYSIS] ❌ Job ${job?.id} failed: ${errorMsg}`);
    });

    this.queue.on('error', (error) => {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[COMMIT-ANALYSIS] ⚠️ Queue error: ${errorMsg}`);
    });

    this.queue.on('active', (job) => {
      logger.info(`[COMMIT-ANALYSIS] 🔄 Job ${job.id} became active`);
    });

    this.queue.on('stalled', (job) => {
      logger.warn(`[COMMIT-ANALYSIS] ⏸️ Job ${job.id} stalled`);
    });

    this.queue.on('waiting', (jobId) => {
      logger.info(`[COMMIT-ANALYSIS] ⏳ Job ${jobId} is waiting`);
    });
  }

  async enqueueAnalysis(data: CommitAnalysisJobData): Promise<void> {
    if (!this.queue) {
      throw new Error('CommitAnalysisQueue not initialized');
    }

    await this.queue.add(data, {
      jobId: `pr-${data.prInternalId}-${Date.now()}`, // Unique job ID
    });

    logger.info(`[COMMIT-ANALYSIS] Enqueued analysis for PR #${String(data.prId).replace(/[\r\n]/g, '')}`);
  }

  getQueue(): Bull.Queue<CommitAnalysisJobData> {
    if (!this.queue) {
      throw new Error('[COMMIT-ANALYSIS] Queue not initialized');
    }
    return this.queue;
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.isInitialized = false;
    }
  }
}

export const commitAnalysisQueue = new CommitAnalysisQueue();
