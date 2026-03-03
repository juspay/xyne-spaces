import {
  BitbucketPullRequestsResponse,
  BitbucketCommentsResponse,
  BitbucketActivitiesResponse,
  BitbucketConfig,
  PullRequestData,
} from '../types/bitbucket.js';
import { logger } from '@/utils/logger';
import {
  PullRequestDataPartial,
  BitbucketChangesResponse,
  ChangeEntry,
  BitbucketCommitsResponse,
  PullRequestInfo,
} from '../types/bitbucket';

export class BitbucketService {
  private config: BitbucketConfig;

  constructor(config: BitbucketConfig) {
    this.config = config;
  }

  /**
   * Get authorization header for API requests
   */
  private getAuthHeader(): string {
    if (this.config.token) {
      return `Bearer ${this.config.token}`;
    } else if (this.config.username && this.config.password) {
      const credentials = Buffer.from(`${this.config.username}:${this.config.password}`).toString(
        'base64'
      );
      return `Basic ${credentials}`;
    }
    throw new Error('No authentication credentials provided');
  }

  /**
   * Make authenticated request to Bitbucket API
   * @param endpoint - API endpoint
   * @param responseType - Response type: 'json' (default) or 'text'
   */
  private async makeRequest<T>(endpoint: string, responseType: 'json' | 'text' = 'json'): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;
    const acceptHeader = responseType === 'text' ? 'text/plain' : 'application/json;charset=UTF-8';

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: acceptHeader,
          Authorization: this.getAuthHeader(),
        },
      });

      if (!response.ok) {
        throw new Error(`Bitbucket API error: ${response.status} ${response.statusText}`);
      }

      if (responseType === 'text') {
        return (await response.text()) as T;
      }
      return (await response.json()) as T;
    } catch (error) {
      logger.error('Error making Bitbucket API request:', error as Error);
      throw error;
    }
  }

  /**
   * Helper to fetch all pages of a paginated response
   */
  private async fetchAllPages<
    T extends { values: unknown[]; isLastPage: boolean; nextPageStart?: number | null },
  >(initialEndpoint: string): Promise<T['values'] extends Array<infer U> ? U[] : never> {
    const allValues: unknown[] = [];
    let start = 0;
    const limit = 50;
    let hasMore = true;

    const separator = initialEndpoint.includes('?') ? '&' : '?';

    while (hasMore) {
      const endpoint = `${initialEndpoint}${separator}start=${start}&limit=${limit}`;
      const response = await this.makeRequest<T>(endpoint);

      allValues.push(...response.values);

      if (response.isLastPage) {
        hasMore = false;
      } else {
        start = response.nextPageStart ?? start + limit;
      }
    }

    return allValues as T['values'] extends Array<infer U> ? U[] : never;
  }

  /**
   * Get pull requests from Bitbucket
   */
  async getPullRequests(
    state?: 'OPEN' | 'MERGED' | 'DECLINED' | 'ALL',
    limit: number = 50,
    start: number = 0
  ): Promise<BitbucketPullRequestsResponse> {
    let endpoint = `/projects/${this.config.projectKey}/repos/${this.config.repositorySlug}/pull-requests?limit=${limit}&start=${start}`;

    if (state) {
      endpoint += `&state=${state}`;
    }

    return this.makeRequest<BitbucketPullRequestsResponse>(endpoint);
  }

  /**
   * Get activities for a specific pull request
   */
  async getPullRequestActivities(
    pullRequestId: number,
    limit: number = 100,
    start: number = 0
  ): Promise<BitbucketActivitiesResponse> {
    const endpoint = `/projects/${this.config.projectKey}/repos/${this.config.repositorySlug}/pull-requests/${pullRequestId}/activities?limit=${limit}&start=${start}`;
    return this.makeRequest<BitbucketActivitiesResponse>(endpoint);
  }

  /**
   * Get comments for a specific pull request
   */
  async getPullRequestComments(
    pullRequestId: number,
    limit: number = 100,
    start: number = 0
  ): Promise<BitbucketCommentsResponse> {
    const endpoint = `/projects/${this.config.projectKey}/repos/${this.config.repositorySlug}/pull-requests/${pullRequestId}/comments?limit=${limit}&start=${start}`;
    return this.makeRequest<BitbucketCommentsResponse>(endpoint);
  }

  /**
   * Get pull requests from the last N days with comment counts
   */
  async getPullRequestsFromLastDays(days: number = 3): Promise<PullRequestDataPartial[]> {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - days);
    const cutoffTime = threeDaysAgo.getTime();

    const allPullRequests: PullRequestDataPartial[] = [];
    let start = 0;
    const limit = 50;
    let hasMore = true;

    while (hasMore) {
      try {
        // Get pull requests for all states
        const response = await this.getPullRequests('ALL', limit, start);

        // Filter PRs from the last 3 days
        const recentPRs = response.values.filter((pr) => pr.createdDate >= cutoffTime);

        // Get comment counts for each PR
        for (const pr of recentPRs) {
          // Use comment count from PR properties (more reliable than separate API calls)
          const totalComments = pr.properties?.commentCount || 0;

          // Map status to the required format
          let status: PullRequestData['status'];
          switch (pr.state) {
            case 'OPEN':
              status = totalComments > 0 ? 'Commented' : 'Pending';
              break;
            case 'MERGED':
              status = 'Merged';
              break;
            case 'DECLINED':
              status = 'Rejected';
              break;
            default:
              status = 'Pending';
          }

          // Build repository URL
          const repositoryURL =
            pr.links.self[0]?.href?.replace('/pull-requests/' + pr.id, '') ||
            `${this.config.baseUrl}/projects/${this.config.projectKey}/repos/${this.config.repositorySlug}`;

          allPullRequests.push({
            pr_id: pr.id,
            branchName: pr.fromRef.displayId,
            sourceBranchName: pr.fromRef.displayId,
            destinationBranchName: pr.toRef.displayId,
            date: new Date(pr.createdDate).toISOString(),
            numberOfComments: totalComments,
            repositoryURL: repositoryURL,
            status: status,
          });
        }

        // Check if we need to fetch more
        if (response.isLastPage) {
          hasMore = false;
        } else {
          start = response.nextPageStart || start + limit;
        }
      } catch (error) {
        logger.error('Error fetching pull requests:', error as Error);
        hasMore = false;
      }
    }

    // Sort by date (newest first)
    return allPullRequests.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  /**
   * Get all pull requests for a specific merge commit hash
   * Handles pagination automatically
   *
   * @param projectKey - Project key
   * @param repositorySlug - Repository slug
   * @param commitHash - Merge commit SHA
   * @param state - Optional state filter ('OPEN', 'MERGED', 'DECLINED', 'ALL')
   * @returns Array of pull requests with this merge commit hash
   */
  async getPullRequestsForCommit(
    projectKey: string,
    repositorySlug: string,
    commitHash: string,
  ): Promise<PullRequestData[]> {
    let endpoint = `/projects/${projectKey}/repos/${repositorySlug}/commits/${commitHash}/pull-requests`;

    try {
      const pullRequests = await this.fetchAllPages<BitbucketPullRequestsResponse>(endpoint);
      return pullRequests as PullRequestData[];
    } catch (error) {
      // No pull requests found for this commit (not an error, just empty result)
      console.log(`No pull requests found for merge commit ${commitHash}`);
      return [];
    }
  }

  /**
   * Get changes for a specific commit
   * Bitbucket Server uses /commits/{commitId}/changes endpoint
   * Returns file paths and change types (no line counts)
   *
   * @param projectKey - Project key
   * @param repositorySlug - Repository slug
   * @param commitId - Commit SHA
   * @returns Array of change entries
   */
  async getCommitChanges(
    projectKey: string,
    repositorySlug: string,
    commitId: string
  ): Promise<ChangeEntry[]> {
    const endpoint = `/projects/${projectKey}/repos/${repositorySlug}/commits/${commitId}/changes`;

    try {
      return await this.fetchAllPages<BitbucketChangesResponse>(endpoint);
    } catch (error) {
      logger.error(`Failed to fetch changes for commit ${commitId}:`, error as Error);
      throw error;
    }
  }

  /**
   * Get raw diff for a specific file in a commit
   * Uses the commit diff endpoint which shows changes introduced by the commit
   *
   * @param projectKey - Project key
   * @param repositorySlug - Repository slug
   * @param commitId - Commit SHA
   * @param filePath - Path to the file
   * @returns Raw git-style diff as string
   */
  async getFileDiff(
    projectKey: string,
    repositorySlug: string,
    commitId: string,
    filePath: string
  ): Promise<string> {
    // Use the commit diff endpoint - shows diff for this specific commit
    // The contextLines parameter adds context around changes
    const endpoint = `/projects/${projectKey}/repos/${repositorySlug}/commits/${commitId}/diff/${filePath}?contextLines=0`;

    try {
      return await this.makeRequest<string>(endpoint, 'text');
    } catch (error) {
      logger.error(`Failed to fetch diff for ${filePath} in commit ${commitId}:`, error as Error);
      throw error;
    }
  }


  async getMergedPullRequest(
    projectKey: string,
    repositorySlug: string,
    commitHash: string,
    branch?: string
  ): Promise<PullRequestInfo | null> {
    const allPRs = await this.getPullRequestsForCommit(
      projectKey,
      repositorySlug,
      commitHash,
    );

    logger.info(
      `Found ${allPRs.length} PR(s) for commit ${commitHash} in ${projectKey}/${repositorySlug}`
    );

    if (allPRs.length === 0) {
      return null;
    }
    const mergedPRs = allPRs.filter((pr) => pr.state === 'MERGED');
    if (mergedPRs.length === 0) {
      logger.info(
        `No merged PRs found for commit ${commitHash} (found ${allPRs.length} PR(s) in other states)`
      );
      return null;
    }

    const relevantPRs = mergedPRs.filter((pr) => {
      const targetBranch = pr.toRef.displayId;
      // TODO: branch name should be as per project
      if (!branch || targetBranch === branch || targetBranch === 'main') {
        return true;
      }

      return false;
    });

    if (relevantPRs.length === 0) {
      logger.info(
        `No relevant PRs found for commit ${commitHash} on branch ${branch} (filtered from ${allPRs.length} total)`
      );
      return null;
    }

    relevantPRs.sort((a, b) => {
      const aTarget = a.toRef.displayId;
      const bTarget = b.toRef.displayId;

      // Prefer PRs targeting the current branch over main
      if (branch) {
        const aIsTargetBranch = aTarget === branch;
        const bIsTargetBranch = bTarget === branch;
        if (aIsTargetBranch && !bIsTargetBranch) return -1;
        if (!aIsTargetBranch && bIsTargetBranch) return 1;
      }
      return b.createdDate - a.createdDate;
    });

    const pr = relevantPRs[0];

    return {
      id: pr.id,
      title: pr.title,
      state: pr.state,
      url: pr.links.self[0]?.href || '',
      mergedAt: new Date(pr.updatedDate).toISOString(),
      author: {
        displayName: pr.author.user.displayName,
        id: pr.author.user.id,
        emailAddress: pr.author.user.emailAddress,
      },
    };
  }

  /**
   * Get all commits between two commit IDs
   * Handles pagination automatically
   *
   * @param projectKey - Project key
   * @param repositorySlug - Repository slug
   * @param sinceCommitId - Starting commit ID (exclusive - not included in results)
   * @param untilCommitId - Ending commit ID (inclusive - included in results)
   * @param branch - Optional branch/ref to fetch commits from (e.g., 'refs/heads/main')
   * @returns Array of commit IDs between the two commits
   */

  async getCommitsBetween(
    projectKey: string,
    repositorySlug: string,
    sinceCommitId: string,
    untilCommitId: string,
    branch?: string
  ): Promise<string[]> {
    let endpoint = `/projects/${projectKey}/repos/${repositorySlug}/commits?since=${sinceCommitId}&until=${untilCommitId}`;

    if (branch) {
      endpoint += `&at=${encodeURIComponent(branch)}`;
    }

    try {
      const commits = await this.fetchAllPages<BitbucketCommitsResponse>(endpoint);
      const commitIds = commits.map((commit) => commit.id);

      console.log(
        `Found ${commitIds.length} commit(s) between ${sinceCommitId} and ${untilCommitId}${branch ? ` on branch ${branch}` : ''} in ${projectKey}/${repositorySlug}`
      );

      return [...commitIds, sinceCommitId];
    } catch (error) {
      logger.error(
        `Failed to fetch commits between ${sinceCommitId} and ${untilCommitId}:`,
        error as Error
      );
      throw error;
    }
  }

  /* Add user write permission to a specific repository
 * @param projectKey The Bitbucket project key
 * @param repositorySlug The repository slug
 * @param username The Bitbucket username to grant access to
 */
  async addUserWritePermission(
    projectKey: string,
    repositorySlug: string,
    username: string
  ): Promise<{ success: boolean; error?: string }> {
    const endpoint = `/rest/api/latest/projects/${projectKey}/repos/${repositorySlug}/permissions/users?name=${encodeURIComponent(username)}&permission=REPO_WRITE`;
    const url = `${this.config.baseUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Accept': 'application/json;charset=UTF-8',
          'Authorization': this.getAuthHeader(),
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`Failed to add user permission: ${response.status} ${response.statusText}`, { errorText });
        return { success: false, error: `Bitbucket API error: ${response.status} ${response.statusText}` };
      }

      logger.info(`Successfully added REPO_WRITE permission for user ${username} to ${projectKey}/${repositorySlug}`);
      return { success: true };
    } catch (error) {
      logger.error('Error adding user permission:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}
