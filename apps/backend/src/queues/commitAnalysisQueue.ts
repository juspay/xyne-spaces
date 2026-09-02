import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { PrCommitAnalysisService } from '@/services/prCommitAnalysisService';
import { GitHubService } from '@/services/githubService';
import { BitbucketService } from '@/services/bitbucketService';
import { config } from '@/config/env';
import { DatabaseClient } from '@/database/client';
import { runAsServiceActor } from '@/database/tenant/context';

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
        redis: redisService.getRedisConfig(),
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: true,
          removeOnFail: false,
          timeout: 60000, // 60 seconds max per job
        },
      });

      this.setupProcessor();
      this.setupEventListeners();

      this.isInitialized = true;
      logger.info('[COMMIT-ANALYSIS] CommitAnalysisQueue initialized successfully');
    } catch (error) {
      logger.error('[COMMIT-ANALYSIS] Failed to initialize commit analysis queue:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  private setupProcessor(): void {
    if (!this.queue) return;

    this.queue.process(async (job) => {
      const { workspaceId, prId, prInternalId, repositoryUrl, projectKey, repositorySlug, vcsProvider } =
        job.data;

      logger.info(`[COMMIT-ANALYSIS] Processing PR #${prId} (${vcsProvider})`);

      try {
        // Run within workspace context
        await runAsServiceActor('commit-analysis-worker', workspaceId, async () => {
          const db = DatabaseClient.getInstance();

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

          const analysisService = new PrCommitAnalysisService(vcsClient);

          // Analyze commits
          const result = await analysisService.analyzePullRequestCommits({
            prId,
            prInternalId,
            workspaceId,
            repositoryUrl,
            projectKey,
            repositorySlug,
          });

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
            `[COMMIT-ANALYSIS] Completed PR #${prId}: ${result.totalCommits} commits ` +
              `(${result.botCommits} bot, ${result.humanCommits} human)`,
          );
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`[COMMIT-ANALYSIS] Failed to analyze PR #${prId}:`, error);

        // Mark as failed in database
        const db = DatabaseClient.getInstance();
        await db.pullRequests.update({
          where: { id: prInternalId },
          data: {
            commitAnalysisStatus: 'FAILED',
            commitAnalysisError: errorMsg,
            commitAnalyzedAt: new Date(),
          },
        });

        throw error; // Bull will retry based on attempts config
      }
    });
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('completed', (job) => {
      logger.debug(`[COMMIT-ANALYSIS] Job ${job.id} completed`);
    });

    this.queue.on('failed', (job, err) => {
      logger.error(`[COMMIT-ANALYSIS] Job ${job?.id} failed:`, err);
    });

    this.queue.on('error', (error) => {
      logger.error('[COMMIT-ANALYSIS] Queue error:', error);
    });
  }

  async enqueueAnalysis(data: CommitAnalysisJobData): Promise<void> {
    if (!this.queue) {
      throw new Error('CommitAnalysisQueue not initialized');
    }

    await this.queue.add(data, {
      jobId: `pr-${data.prInternalId}-${Date.now()}`, // Unique job ID
    });

    logger.info(`[COMMIT-ANALYSIS] Enqueued analysis for PR #${data.prId}`);
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.isInitialized = false;
    }
  }
}

export const commitAnalysisQueue = new CommitAnalysisQueue();
