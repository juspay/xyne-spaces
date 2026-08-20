// PR Commit Analysis Service
// Unified service for analyzing commit authorship in PRs (GitHub + Bitbucket)

import { VCSProviderType } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';

export interface CommitDetail {
  sha: string;
  author: string;
  authorType: 'Bot' | 'User';
  message: string;
  timestamp: string;
}

export interface CommitAnalysisResult {
  authorshipType: 'BOT' | 'BOT_ASSISTED' | 'HUMAN';
  botCommitCount: number;
  humanCommitCount: number;
  commitDetails: {
    commits: CommitDetail[];
  };
}

interface GitHubCommit {
  sha: string;
  author?: {
    login?: string;
    type?: string;
  };
  commit?: {
    message?: string;
    author?: {
      date?: string;
    };
  };
}

interface BitbucketCommit {
  id: string;
  author?: {
    name?: string;
    emailAddress?: string;
    type?: string;
  };
  message?: string;
  authorTimestamp?: number;
}

interface AnalyzeCommitsParams {
  provider: VCSProviderType;
  // GitHub params
  owner?: string;
  repo?: string;
  prNumber?: number;
  // Bitbucket params
  projectKey?: string;
  repoSlug?: string;
  prId?: number;
}

export class PRCommitAnalysisService {
  /**
   * Analyzes commit authorship for a PR from either GitHub or Bitbucket
   */
  async analyzeCommits(params: AnalyzeCommitsParams): Promise<CommitAnalysisResult | null> {
    try {
      const { provider } = params;

      if (provider === VCSProviderType.GITHUB) {
        return await this.analyzeGitHubCommits(
          params.owner!,
          params.repo!,
          params.prNumber!
        );
      } else if (
        provider === VCSProviderType.BITBUCKET_SERVER ||
        provider === VCSProviderType.BITBUCKET_CLOUD
      ) {
        return await this.analyzeBitbucketCommits(
          params.projectKey!,
          params.repoSlug!,
          params.prId!
        );
      } else {
        logger.warn('[PRCommitAnalysis] Unknown provider type', { provider });
        return null;
      }
    } catch (error) {
      logger.error('[PRCommitAnalysis] Failed to analyze commits', { error, params });
      return null;
    }
  }

  /**
   * Fetch and analyze commits from GitHub PR
   */
  private async analyzeGitHubCommits(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<CommitAnalysisResult | null> {
    try {
      // Fetch commits from GitHub API
      const url = `${config.github.apiUrl}/repos/${owner}/${repo}/pulls/${prNumber}/commits`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${config.github.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });

      if (!response.ok) {
        logger.warn('[PRCommitAnalysis] GitHub API failed', {
          status: response.status,
          statusText: response.statusText,
          owner,
          repo,
          prNumber,
        });
        return null;
      }

      const commits = (await response.json()) as GitHubCommit[];

      // Analyze commits
      return this.classifyCommits(
        commits.map(commit => this.normalizeGitHubCommit(commit))
      );
    } catch (error) {
      logger.error('[PRCommitAnalysis] Error fetching GitHub commits', {
        error,
        owner,
        repo,
        prNumber,
      });
      return null;
    }
  }

  /**
   * Fetch and analyze commits from Bitbucket PR
   */
  private async analyzeBitbucketCommits(
    projectKey: string,
    repoSlug: string,
    prId: number
  ): Promise<CommitAnalysisResult | null> {
    try {
      // Fetch commits from Bitbucket API
      const url = `${config.bitbucket.baseUrl}/rest/api/1.0/projects/${projectKey}/repos/${repoSlug}/pull-requests/${prId}/commits`;
      const authHeader = 'Basic ' + Buffer.from(
        `${config.bitbucket.apiUsername}:${config.bitbucket.apiToken}`
      ).toString('base64');

      const response = await fetch(url, {
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        logger.warn('[PRCommitAnalysis] Bitbucket API failed', {
          status: response.status,
          statusText: response.statusText,
          projectKey,
          repoSlug,
          prId,
        });
        return null;
      }

      const data = (await response.json()) as { values?: BitbucketCommit[] };
      const commits: BitbucketCommit[] = data.values || [];

      // Analyze commits
      return this.classifyCommits(
        commits.map(commit => this.normalizeBitbucketCommit(commit))
      );
    } catch (error) {
      logger.error('[PRCommitAnalysis] Error fetching Bitbucket commits', {
        error,
        projectKey,
        repoSlug,
        prId,
      });
      return null;
    }
  }

  /**
   * Normalize GitHub commit to common format
   */
  private normalizeGitHubCommit(commit: GitHubCommit): CommitDetail {
    return {
      sha: commit.sha || 'unknown',
      author: commit.author?.login || 'unknown',
      authorType: this.isGitHubBotCommit(commit) ? 'Bot' : 'User',
      message: commit.commit?.message || '',
      timestamp: commit.commit?.author?.date || new Date().toISOString(),
    };
  }

  /**
   * Normalize Bitbucket commit to common format
   */
  private normalizeBitbucketCommit(commit: BitbucketCommit): CommitDetail {
    return {
      sha: commit.id || 'unknown',
      author: commit.author?.name || commit.author?.emailAddress || 'unknown',
      authorType: this.isBitbucketBotCommit(commit) ? 'Bot' : 'User',
      message: commit.message || '',
      timestamp: commit.authorTimestamp
        ? new Date(commit.authorTimestamp).toISOString()
        : new Date().toISOString(),
    };
  }

  /**
   * Detect if a GitHub commit is by a bot
   */
  private isGitHubBotCommit(commit: GitHubCommit): boolean {
    // Primary: Check author.type field
    if (commit.author?.type === 'Bot') return true;

    // Secondary: Check username patterns
    const login = commit.author?.login?.toLowerCase() || '';
    if (login.endsWith('[bot]')) return true;

    // Tertiary: Check configured bot username
    const botUsername = config.github.botUsername;
    if (botUsername && commit.author?.login === botUsername) return true;

    return false;
  }

  /**
   * Detect if a Bitbucket commit is by a bot
   */
  private isBitbucketBotCommit(commit: BitbucketCommit): boolean {
    // Primary: Check author.type field (SERVICE = service account)
    if (commit.author?.type === 'SERVICE') return true;

    // Secondary: Check email patterns
    const email = commit.author?.emailAddress || '';
    if (email.endsWith('@bot.xyne.ai')) return true;

    // Tertiary: Check configured bot username (optional)
    const botUsername = config.bitbucket.botUsername;
    if (botUsername && commit.author?.name === botUsername) return true;

    return false;
  }

  /**
   * Classify commits and generate analysis result
   */
  private classifyCommits(commits: CommitDetail[]): CommitAnalysisResult {
    const totalCount = commits.length;
    const botCount = commits.filter(c => c.authorType === 'Bot').length;
    const humanCount = totalCount - botCount;

    // Classification logic (strict mode)
    let authorshipType: 'BOT' | 'BOT_ASSISTED' | 'HUMAN';
    if (botCount === totalCount && totalCount > 0) {
      authorshipType = 'BOT'; // 100% bot commits
    } else if (botCount > 0 && humanCount > 0) {
      authorshipType = 'BOT_ASSISTED'; // Mixed
    } else {
      authorshipType = 'HUMAN'; // 0 bot commits or all human
    }

    return {
      authorshipType,
      botCommitCount: botCount,
      humanCommitCount: humanCount,
      commitDetails: {
        commits,
      },
    };
  }
}

// Singleton instance
export const prCommitAnalysisService = new PRCommitAnalysisService();
