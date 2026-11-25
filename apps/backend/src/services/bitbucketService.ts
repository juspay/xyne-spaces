import {
  BitbucketPullRequestsResponse,
  BitbucketCommentsResponse,
  BitbucketActivitiesResponse,
  BitbucketConfig,
  PullRequestData,
} from '../types/bitbucket.js';
import { logger } from '@/utils/logger';
import { PullRequestDataPartial } from '../types/bitbucket';

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

  /**
   * Every file path in the repo (recursive) at the given ref, or the default
   * branch when omitted. Paginates Bitbucket Server's files endpoint and caps
   * the total so a huge monorepo can't unbounded-grow the AI-suggestion input.
   */
  async listFilePaths(ref?: string): Promise<string[]> {
    const { projectKey, repositorySlug } = this.config;
    if (!projectKey || !repositorySlug) {
      throw new Error('projectKey and repositorySlug are required to list files');
    }
    // Bitbucket keys/slugs are [A-Za-z0-9_.-]; anything else (e.g. `..`, `%2F`) is a URL
    // parse artefact, not a repo — reject rather than interpolate into the request path.
    const SAFE_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
    if (!SAFE_SEGMENT.test(projectKey) || !SAFE_SEGMENT.test(repositorySlug)) {
      throw new Error('Invalid Bitbucket project key or repository slug');
    }
    const paths: string[] = [];
    const PAGE = 1000;
    const MAX = 10000;
    let start = 0;
    for (;;) {
      const params = new URLSearchParams({ limit: String(PAGE), start: String(start) });
      if (ref) params.set('at', ref);
      const page = await this.makeRequest<{
        values?: string[];
        isLastPage?: boolean;
        nextPageStart?: number | null;
      }>(`/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repositorySlug)}/files?${params.toString()}`);
      const before = paths.length;
      for (const p of page.values ?? []) paths.push(p);
      if (page.isLastPage || page.nextPageStart == null || paths.length >= MAX || paths.length === before) {
        break;
      }
      start = page.nextPageStart;
    }
    return paths;
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
   */
  private async makeRequest<T>(endpoint: string): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json;charset=UTF-8',
            Authorization: this.getAuthHeader(),
          },
          signal: AbortSignal.timeout(this.REQUEST_TIMEOUT_MS),
        });

        if (response.ok) {
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
        // the Bitbucket server rejects rate-limited requests with a 403 whose
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
}
