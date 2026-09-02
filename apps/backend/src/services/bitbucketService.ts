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
  private readonly MAX_RETRIES = 5;
  private readonly BASE_DELAY_MS = 1000;
  private readonly MAX_DELAY_MS = 30000;
  // Bound outbound calls so a hung upstream can't pin analysis/webhooks.
  private readonly REQUEST_TIMEOUT_MS = 30000;

  constructor(config: BitbucketConfig) {
    this.config = config;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  buildCommitFileUrl(projectKey: string, repositorySlug: string, commitId: string, filePath: string): string {
    // config.baseUrl is the REST API base (…/rest/api/latest). Strip the REST
    // segment to get the browser host, then use Bitbucket's commit-diff shape.
    const webBase = this.config.baseUrl.replace(/\/rest\/.*$/, '').replace(/\/+$/, '');
    return `${webBase}/projects/${projectKey}/repos/${repositorySlug}/commits/${commitId}#${filePath}`;
  }

  private getRetryDelay(attempt: number): number {
    // Exponential backoff: baseDelay * 2^attempt, capped at maxDelay
    const exponentialDelay = this.BASE_DELAY_MS * Math.pow(2, attempt);
    const cappedDelay = Math.min(exponentialDelay, this.MAX_DELAY_MS);
    // Add jitter (±25%) to avoid thundering herd
    const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1);
    return Math.floor(cappedDelay + jitter);
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
   * Make authenticated request to Bitbucket API with exponential backoff retry
   * @param endpoint - API endpoint
   * @param responseType - Response type: 'json' (default) or 'text'
   */
  private async makeRequest<T>(endpoint: string, responseType: 'json' | 'text' = 'json'): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;
    const acceptHeader = responseType === 'text' ? 'text/plain' : 'application/json;charset=UTF-8';

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            Accept: acceptHeader,
            Authorization: this.getAuthHeader(),
          },
          signal: AbortSignal.timeout(this.REQUEST_TIMEOUT_MS),
        });

        if (response.ok) {
          if (responseType === 'text') {
            return (await response.text()) as T;
          }
          return (await response.json()) as T;
        }

        // Read the body once — needed both for rate-limit detection and error context.
        let bodyText = '';
        try {
          bodyText = await response.text();
        } catch {
          // ignore body-read failure
        }

        // Handle rate limiting. Besides the standard 429, the WAF in front of
        // bitbucket.juspay.net rejects rate-limited requests with a 403 whose
        // body says "you've exceeded the Rate limit Number in WAF" — treat that
        // as retryable too, or a burst of paginated calls fails the whole run.
        const isWafRateLimit = response.status === 403 && /rate ?limit/i.test(bodyText);
        if (response.status === 429 || isWafRateLimit) {
          const retryAfter = response.headers.get('Retry-After');
          const delayMs = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : this.getRetryDelay(attempt);

          logger.warn(
            `Bitbucket API rate limited (${response.status}${isWafRateLimit ? ' WAF' : ''}) ` +
            `on attempt ${attempt + 1}/${this.MAX_RETRIES}. Retrying after ${delayMs}ms...`
          );

          await this.sleep(delayMs);
          lastError = new Error(`Bitbucket API rate limit: ${response.status}`);
          continue; // Retry
        }

        // For other errors, throw immediately with the URL so callers know
        // exactly which endpoint failed (404 in particular is opaque without it).
        throw new Error(
          `Bitbucket API error: ${response.status} ${response.statusText} for ${url}` +
          (bodyText ? ` — body: ${bodyText.slice(0, 200)}` : ''),
        );
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Retry network errors/timeouts only (429 handled above).
        const isTimeout = (error as Error)?.name === 'TimeoutError' || (error as Error)?.name === 'AbortError';
        if (isTimeout || error instanceof TypeError || (error as Error).message?.includes('fetch')) {
          if (attempt < this.MAX_RETRIES - 1) {
            const delayMs = this.getRetryDelay(attempt);
            logger.warn(
              `${isTimeout ? `Request timed out after ${this.REQUEST_TIMEOUT_MS}ms` : 'Network error'} ` +
              `on attempt ${attempt + 1}/${this.MAX_RETRIES} (url=${url}). Retrying after ${delayMs}ms...`,
              lastError
            );
            await this.sleep(delayMs);
            continue;
          }
        }

        throw error;
      }
    }

    // Exhausted all retries
    logger.error('Bitbucket API request failed after max retries:', lastError);
    throw lastError || new Error('Bitbucket API request failed after max retries');
  }

  /**
   * Helper to fetch all pages of a paginated response
   */
  // Hard stop for runaway pagination, applied per fetchAllPages call (each
  // paginated fetch gets its own budget): a single vendored/bulk commit can carry
  // 20k+ changed files; without a cap, paging it exhausts the WAF request budget
  // (~400-500 req/window) and fails the whole analysis. Results past the cap are
  // dropped with a warn — analysis on such commits is best-effort by design.
  // Effective caps: /changes @1000 → 25k files per commit; /commits @50 → 1,250.
  private readonly MAX_PAGES_PER_FETCH = 25;

  private async fetchAllPages<
    T extends { values: unknown[]; isLastPage: boolean; nextPageStart?: number | null },
  >(initialEndpoint: string, limit = 50): Promise<T['values'] extends Array<infer U> ? U[] : never> {
    const allValues: unknown[] = [];
    let start = 0;
    let hasMore = true;
    let pages = 0;

    const separator = initialEndpoint.includes('?') ? '&' : '?';

    while (hasMore) {
      // The server clamps `limit` to its per-endpoint max; the loop follows
      // isLastPage/nextPageStart, so a clamp just means more (smaller) pages.
      const endpoint = `${initialEndpoint}${separator}start=${start}&limit=${limit}`;
      const response = await this.makeRequest<T>(endpoint);

      allValues.push(...response.values);
      pages++;

      if (response.isLastPage) {
        hasMore = false;
      } else if (pages >= this.MAX_PAGES_PER_FETCH) {
        logger.warn(
          `Bitbucket pagination truncated at ${pages} pages (${allValues.length} items) for ${initialEndpoint} — remaining results dropped`
        );
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
    const endpoint = `/projects/${projectKey}/repos/${repositorySlug}/commits/${commitHash}/pull-requests`;

    try {
      const pullRequests = await this.fetchAllPages<BitbucketPullRequestsResponse>(endpoint);
      return pullRequests as PullRequestData[];
    } catch (error) {
      // No pull requests found for this commit (not an error, just empty result)
      logger.info(`No pull requests found for merge commit ${commitHash}`);
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
      // limit=1000 (the server's ceiling for /changes): a 21k-file bulk commit is
      // ~22 requests instead of ~430 at the default 50 — the difference between
      // fitting inside the WAF request budget and tripping it mid-run.
      return await this.fetchAllPages<BitbucketChangesResponse>(endpoint, 1000);
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
    // Some Bitbucket deployments sit behind a WAF that 403s any URL containing
    // ".env" (a common secret-scan probe), which breaks per-file diffs for env
    // files. Fetch those from the whole-commit diff (file path not in the URL, so
    // WAF-safe) and slice out the file. Also the fallback for any blocked path.
    if (filePath.includes('.env')) {
      return this.getFileDiffFromCommitDiff(projectKey, repositorySlug, commitId, filePath);
    }
    const endpoint = `/projects/${projectKey}/repos/${repositorySlug}/commits/${commitId}/diff/${filePath}?contextLines=0`;
    try {
      return await this.makeRequest<string>(endpoint, 'text');
    } catch (error) {
      logger.warn(`Per-file diff failed for ${filePath} in ${commitId}; falling back to whole-commit diff`);
      return this.getFileDiffFromCommitDiff(projectKey, repositorySlug, commitId, filePath);
    }
  }

  // Whole-commit diff (no file path in the URL → WAF-safe), returning only the
  // section for `filePath` in the same unified format the per-file endpoint
  // yields, so DiffParser handles it unchanged. '' if the file isn't present.
  private async getFileDiffFromCommitDiff(
    projectKey: string,
    repositorySlug: string,
    commitId: string,
    filePath: string,
  ): Promise<string> {
    const full = await this.makeRequest<string>(
      `/projects/${projectKey}/repos/${repositorySlug}/commits/${commitId}/diff?contextLines=0`,
      'text',
    );
    for (const section of full.split(/^diff --git /m)) {
      const firstLine = section.split('\n', 1)[0];
      // standard `a/… b/…`; some Bitbucket Server emits `src://… dst://…`
      if (firstLine.endsWith(` b/${filePath}`) || firstLine.endsWith(`dst://${filePath}`)) {
        return `diff --git ${section}`;
      }
    }
    return '';
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
      description: pr.description,
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

      logger.info(
        `Found ${commitIds.length} commit(s) between ${sinceCommitId} and ${untilCommitId}${branch ? ` on branch ${branch}` : ''} in ${projectKey}/${repositorySlug}`
      );

      return [...commitIds, sinceCommitId];
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        `Failed to fetch commits between ${sinceCommitId} and ${untilCommitId} in ${projectKey}/${repositorySlug}` +
        (branch ? ` (branch=${branch})` : '') +
        `: ${msg}`,
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
        },
        signal: AbortSignal.timeout(this.REQUEST_TIMEOUT_MS),
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

  /**
   * Fetch all commits for a pull request (for bot attribution tracking)
   * Returns full commit messages for Co-authored-by parsing
   */
  async getCommitsForPullRequest(
    projectKey: string,
    repositorySlug: string,
    prId: number,
  ): Promise<Array<{
    sha: string;
    authorName: string;
    authorEmail: string;
    message: string;
    committedAt: Date;
  }>> {
    try {
      const commits: Array<{
        id: string;
        author: {
          displayName: string;
          emailAddress: string;
        };
        message: string;
        authorTimestamp: number;
      }> = [];

      let start = 0;
      const LIMIT = 100;

      // Fetch all pages
      while (true) {
        const endpoint = `/rest/api/latest/projects/${projectKey}/repos/${repositorySlug}/pull-requests/${prId}/commits?limit=${LIMIT}&start=${start}`;
        const url = `${this.config.baseUrl}${endpoint}`;

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'Authorization': this.getAuthHeader(),
          },
          signal: AbortSignal.timeout(this.REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `Bitbucket: failed to fetch commits for PR #${prId} in ${projectKey}/${repositorySlug}: ` +
            `${response.status} ${response.statusText} — ${errorText}`,
          );
        }

        const data = await response.json() as {
          values: typeof commits;
          isLastPage: boolean;
          nextPageStart?: number;
        };

        commits.push(...data.values);

        if (data.isLastPage) break;
        start = data.nextPageStart ?? start + data.values.length;
      }

      logger.info(
        `Bitbucket: fetched ${commits.length} commit(s) for PR #${prId} in ${projectKey}/${repositorySlug}`,
      );

      return commits.map((c) => ({
        sha: c.id,
        authorName: c.author.displayName,
        authorEmail: c.author.emailAddress,
        message: c.message, // FULL message for Co-authored-by parsing
        committedAt: new Date(c.authorTimestamp),
      }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        `Bitbucket: failed to fetch commits for PR #${prId} in ${projectKey}/${repositorySlug}: ${msg}`,
      );
      throw error;
    }
  }
}
