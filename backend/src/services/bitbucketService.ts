import {
  BitbucketPullRequestsResponse,
  BitbucketCommentsResponse,
  BitbucketConfig,
  PullRequestData,
  PullRequestDataPartial
} from '../types/bitbucket.js';
import {logger} from '@/utils/logger';

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
      const credentials = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
      return `Basic ${credentials}`;
    }
    throw new Error('No authentication credentials provided');
  }

  /**
   * Make authenticated request to Bitbucket API
   */
  private async makeRequest<T>(endpoint: string): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json;charset=UTF-8',
          'Authorization': this.getAuthHeader(),
        }
      });

      if (!response.ok) {
        throw new Error(`Bitbucket API error: ${response.status} ${response.statusText}`);
      }

      return await response.json() as T;
    } catch (error) {
      logger.error('Error making Bitbucket API request:', error);
      throw error;
    }
  }

  /**
   * Get pull requests from Bitbucket
   */
  async getPullRequests(
    state?: 'OPEN' | 'MERGED' | 'DECLINED' | 'ALL',
    limit: number = 50,
    start: number = 0
  ): Promise<BitbucketPullRequestsResponse> {
    let endpoint = `/rest/api/latest/projects/${this.config.projectKey}/repos/${this.config.repositorySlug}/pull-requests?limit=${limit}&start=${start}`;

    if (state) {
      endpoint += `&state=${state}`;
    }

    return this.makeRequest<BitbucketPullRequestsResponse>(endpoint);
  }

  /**
   * Get comments for a specific pull request
   */
  async getPullRequestComments(
    pullRequestId: number,
    limit: number = 100,
    start: number = 0
  ): Promise<BitbucketCommentsResponse> {
    const endpoint = `/rest/api/latest/projects/${this.config.projectKey}/repos/${this.config.repositorySlug}/pull-requests/${pullRequestId}/comments?limit=${limit}&start=${start}`;
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
        const recentPRs = response.values.filter(pr => pr.createdDate >= cutoffTime);

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
          const repositoryURL = pr.links.self[0]?.href?.replace('/pull-requests/' + pr.id, '') ||
                              `${this.config.baseUrl}/projects/${this.config.projectKey}/repos/${this.config.repositorySlug}`;

          allPullRequests.push({
            pr_id: pr.id,
            branchName: pr.fromRef.displayId,
            sourceBranchName: pr.fromRef.displayId,
            destinationBranchName: pr.toRef.displayId,
            date: new Date(pr.createdDate).toISOString(),
            numberOfComments: totalComments,
            repositoryURL: repositoryURL,
            status: status
          });
        }

        // Check if we need to fetch more
        if (response.isLastPage) {
          hasMore = false;
        } else {
          start = response.nextPageStart || start + limit;
        }
      } catch (error) {
        logger.error('Error fetching pull requests:', error);
        hasMore = false;
      }
    }

    // Sort by date (newest first)
    return allPullRequests.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }
}
