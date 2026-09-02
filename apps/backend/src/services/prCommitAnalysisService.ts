import { VcsClient, CommitInfo } from '@/types/vcs';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';

export interface CommitAnalysisInput {
  prId: number;
  prInternalId: string; // PullRequests.id (DB primary key)
  workspaceId: string;
  repositoryUrl: string;
  projectKey: string; // GitHub: owner, Bitbucket: projectKey
  repositorySlug: string; // GitHub: repo, Bitbucket: repoSlug
}

export interface CommitAnalysisResult {
  totalCommits: number;
  botCommits: number; // Commits with at least one bot
  humanCommits: number; // Commits with no bots
  status: 'COMPLETED' | 'FAILED';
  error: string | null;
}

export class PrCommitAnalysisService {
  private db = DatabaseClient.getInstance();

  constructor(private vcsClient: VcsClient) {}

  /**
   * Analyze commits for a merged PR and persist results.
   * Called from async worker after PR merge.
   *
   * Attribution logic:
   * - Parse xyne-bot-author trailer from commit messages
   * - Extract single bot slug per commit (or null for human commits)
   * - Store in Commit table with agentSlug field
   */
  async analyzePullRequestCommits(input: CommitAnalysisInput): Promise<CommitAnalysisResult> {
    const result: CommitAnalysisResult = {
      totalCommits: 0,
      botCommits: 0,
      humanCommits: 0,
      status: 'COMPLETED',
      error: null,
    };

    try {
      // Step 1: Fetch commits from VCS
      const commits = await this.vcsClient.getCommitsForPullRequest(
        input.projectKey,
        input.repositorySlug,
        input.prId,
      );

      result.totalCommits = commits.length;

      if (commits.length === 0) {
        logger.info(`[PRCommitAnalysis] PR #${input.prId} has no commits`);
        return result;
      }

      // Step 2: Process and persist commits
      const { botCommitCount, humanCommitCount } = await this.processCommits(
        commits,
        input.prInternalId,
        input.workspaceId,
        input.repositoryUrl,
      );

      result.botCommits = botCommitCount;
      result.humanCommits = humanCommitCount;

      logger.info(
        `[PRCommitAnalysis] Analyzed PR #${input.prId}: ${result.totalCommits} commits ` +
          `(${result.botCommits} bot, ${result.humanCommits} human)`,
      );

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      result.status = 'FAILED';
      result.error = errorMsg;
      logger.error(`[PRCommitAnalysis] Failed to analyze PR #${input.prId}: ${errorMsg}`, error);
      return result;
    }
  }

  /**
   * Parse xyne-bot-author trailer from commit message
   * Format: "xyne-bot-author: <slug>"
   * Returns: string (bot slug) or null (not a bot commit)
   */
  private parseBotAuthor(message: string): string | null {
    const regex = /xyne-bot-author:\s*(.+?)$/m;
    const match = message.match(regex);
    return match ? match[1].trim() : null;
  }

  /**
   * Process all commits and persist to database
   */
  private async processCommits(
    commits: CommitInfo[],
    pullRequestId: string,
    workspaceId: string,
    repositoryUrl: string,
  ): Promise<{ botCommitCount: number; humanCommitCount: number }> {
    let botCommitCount = 0;
    let humanCommitCount = 0;

    for (const commit of commits) {
      const botSlug = this.parseBotAuthor(commit.message);

      if (botSlug) {
        botCommitCount++;
      } else {
        humanCommitCount++;
      }

      // Store in database with idempotent upsert
      await this.db.commit.upsert({
        where: {
          pullRequestId_commitSha: {
            pullRequestId,
            commitSha: commit.sha,
          },
        },
        create: {
          workspaceId,
          pullRequestId,
          commitSha: commit.sha,
          repositoryUrl,
          agentSlug: botSlug, // Single bot slug or null
          authorName: commit.authorName,
          authorEmail: commit.authorEmail,
          messageHeadline: commit.message.split('\n')[0].substring(0, 300),
          messageBody: commit.message,
          committedAt: commit.committedAt,
        },
        update: {
          // Update if commit was force-pushed
          agentSlug: botSlug,
          messageBody: commit.message,
        },
      });
    }

    logger.debug(`[PRCommitAnalysis] Persisted ${commits.length} commits for PR ${pullRequestId}`);

    return { botCommitCount, humanCommitCount };
  }
}
