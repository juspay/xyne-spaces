import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { resolveSecret } from '@/config/secretResolver';

export interface GitHubComment {
  id: number;
  body: string;
  user: {
    login: string;
    id: number;
  };
  created_at: string;
  updated_at: string;
  html_url: string;
  path?: string;
  line?: number;
}

export interface ReviewThreadComment {
  id: string;
  body: string;
  author: { login: string } | null;
  createdAt: string;
  url: string;
  path: string;
  line: number | null;
}

export interface ReviewThread {
  id: string;
  isResolved: boolean;
  resolvedBy: { login: string } | null;
  path: string;
  line: number;
  startLine: number | null;
  diffSide: 'LEFT' | 'RIGHT';
  comments: {
    nodes: ReviewThreadComment[];
  };
}

export interface ReviewThreadsGraphQLResponse {
  repository: {
    pullRequest: {
      id: string;
      number: number;
      reviewThreads: {
        totalCount: number;
        nodes: ReviewThread[];
      };
    };
  };
}

interface GitHubServiceConfig {
  // owner/repo are used by the GraphQL review-thread methods; listRepoTree takes
  // them as call-site arguments.
  owner?: string;
  repo?: string;
  token?: string;
  apiUrl?: string;
}

export class GitHubService {
  private config: GitHubServiceConfig;
  private graphqlUrl: string;
  private restBaseUrl: string;
  private readonly MAX_RETRIES = 5;
  private readonly BASE_DELAY_MS = 1000;
  private readonly MAX_DELAY_MS = 30000;
  // Bound outbound calls so a hung upstream can't pin analysis/webhooks.
  private readonly REQUEST_TIMEOUT_MS = 30000;

  constructor(config: GitHubServiceConfig) {
    this.config = config;
    const apiUrl = config.apiUrl ?? 'https://api.github.com';
    this.graphqlUrl = `${apiUrl}/graphql`;
    this.restBaseUrl = apiUrl;
  }

  private getAuthHeader(): string | undefined {
    if (this.config.token) {
      return `Bearer ${this.config.token}`;
    }
    return undefined;
  }

  private async makeGraphQLRequest<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const authHeader = this.getAuthHeader();
    if (authHeader) {
      headers.Authorization = authHeader;
    }

    try {
      const response = await fetch(this.graphqlUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(this.REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`GitHub GraphQL API error: ${response.status} ${response.statusText}`);
      }

      const result = (await response.json()) as { data: T; errors?: Array<{ message: string }> };

      if (result.errors) {
        throw new Error(`GitHub GraphQL errors: ${result.errors.map(e => e.message).join(', ')}`);
      }

      return result.data;
    } catch (error) {
      logger.error('Error making GitHub GraphQL request:', error as Error);
      throw error;
    }
  }

  async getPullRequestReviewThreads(pullRequestNumber: number): Promise<ReviewThread[]> {
    const query = `
      query($owner: String!, $repo: String!, $prNumber: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $prNumber) {
            reviewThreads(first: 100) {
              nodes {
                id
                isResolved
                resolvedBy { login }
                path
                line
                startLine
                diffSide
                comments(first: 50) {
                  nodes {
                    id
                    body
                    author { login }
                    createdAt
                    url
                    path
                    line
                  }
                }
              }
            }
          }
        }
      }
    `;

    const response = await this.makeGraphQLRequest<ReviewThreadsGraphQLResponse>(query, {
      owner: this.config.owner,
      repo: this.config.repo,
      prNumber: pullRequestNumber,
    });

    return response.repository.pullRequest.reviewThreads.nodes;
  }

  async getUnresolvedReviewThreads(pullRequestNumber: number): Promise<ReviewThread[]> {
    const threads = await this.getPullRequestReviewThreads(pullRequestNumber);
    return threads.filter(thread => !thread.isResolved);
  }

  async getUnresolvedPullRequestComments(pullRequestNumber: number): Promise<GitHubComment[]> {
    const unresolvedThreads = await this.getUnresolvedReviewThreads(pullRequestNumber);

    return unresolvedThreads.flatMap(thread =>
      thread.comments.nodes.map(comment => ({
        id: parseInt(comment.id.replace('PRRC_', ''), 10) || 0,
        body: comment.body,
        user: {
          login: comment.author?.login || 'unknown',
          id: 0,
        },
        created_at: comment.createdAt,
        updated_at: comment.createdAt,
        html_url: comment.url,
        path: thread.path,
        line: thread.line,
      }))
    );
  }

  // ─── REST helpers ─────────────────────────────────────────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getRetryDelay(attempt: number): number {
    const exp = this.BASE_DELAY_MS * Math.pow(2, attempt);
    const capped = Math.min(exp, this.MAX_DELAY_MS);
    const jitter = capped * 0.25 * (Math.random() * 2 - 1);
    return Math.floor(capped + jitter);
  }

  private async restRequest<T>(
    path: string,
    accept: string = 'application/vnd.github+json',
  ): Promise<T> {
    const url = `${this.restBaseUrl}${path}`;
    const headers: Record<string, string> = {
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const auth = this.getAuthHeader();
    if (auth) headers.Authorization = auth;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(this.REQUEST_TIMEOUT_MS),
        });

        if (res.ok) {
          if (accept === 'application/vnd.github.diff' || accept === 'text/plain') {
            return (await res.text()) as T;
          }
          return (await res.json()) as T;
        }

        // GitHub: 403 with `X-RateLimit-Remaining: 0` is also rate-limit (not 429).
        const remaining = res.headers.get('x-ratelimit-remaining');
        const isRateLimited =
          res.status === 429 || (res.status === 403 && remaining === '0');

        if (isRateLimited) {
          const reset = res.headers.get('x-ratelimit-reset');
          const retryAfter = res.headers.get('retry-after');
          let delayMs: number;
          if (retryAfter) {
            delayMs = parseInt(retryAfter, 10) * 1000;
          } else if (reset) {
            delayMs = Math.max(0, parseInt(reset, 10) * 1000 - Date.now()) + 1000;
          } else {
            delayMs = this.getRetryDelay(attempt);
          }
          logger.warn(
            `GitHub API rate limited on attempt ${attempt + 1}/${this.MAX_RETRIES}. ` +
            `Retrying after ${delayMs}ms (url=${url})`,
          );
          await this.sleep(delayMs);
          lastError = new Error(`GitHub API rate limit: ${res.status}`);
          continue;
        }

        let bodyText = '';
        try { bodyText = await res.text(); } catch { /* ignore */ }
        throw new Error(
          `GitHub API error: ${res.status} ${res.statusText} for ${url}` +
          (bodyText ? ` — body: ${bodyText.slice(0, 200)}` : ''),
        );
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        // timeouts are retryable, like transient network failures
        const isTimeout = (error as Error)?.name === 'TimeoutError' || (error as Error)?.name === 'AbortError';
        if (isTimeout || error instanceof TypeError || (error as Error).message?.includes('fetch')) {
          if (attempt < this.MAX_RETRIES - 1) {
            const delayMs = this.getRetryDelay(attempt);
            logger.warn(
              `${isTimeout ? `Request timed out after ${this.REQUEST_TIMEOUT_MS}ms` : 'Network error'} ` +
              `on attempt ${attempt + 1}/${this.MAX_RETRIES} (url=${url}). Retrying after ${delayMs}ms.`,
              lastError,
            );
            await this.sleep(delayMs);
            continue;
          }
        }
        throw error;
      }
    }

    logger.error('GitHub API request failed after max retries:', lastError);
    throw lastError || new Error('GitHub API request failed after max retries');
  }

  // Every file path in the repo tree at the given ref (recursive, blobs only).
  async listRepoTree(owner: string, repo: string, ref: string): Promise<string[]> {
    const data = await this.restRequest<{
      tree?: { path: string; type: string }[];
      truncated?: boolean;
    }>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    );
    if (data.truncated) {
      // GitHub caps recursive trees (~100k entries / 7MB); the list is partial.
      logger.warn('[GitHubService] repo tree truncated, file list is partial', { owner, repo, ref });
    }
    return (data.tree ?? []).filter(entry => entry.type === 'blob').map(entry => entry.path);
  }

}

export const createGitHubService = async (owner: string, repo: string): Promise<GitHubService> => {
  return new GitHubService({
    owner,
    repo,
    token: await resolveSecret('github-token', config.github?.token),
    apiUrl: config.github?.apiUrl,
  });
};
