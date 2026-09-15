import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { ChangeEntry, PullRequestInfo } from '../types/bitbucket';
import { VcsClient } from '../types/vcs';

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
  // owner/repo are used by the legacy GraphQL review-thread methods. The
  // release-flow methods (added later in this file) take owner/repo as call-site
  // arguments, mirroring BitbucketService.
  owner?: string;
  repo?: string;
  token?: string;
  apiUrl?: string;
}

export class GitHubService implements VcsClient {
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

  // Browser host derived from the API URL: api.github.com → github.com;
  // GitHub Enterprise https://<host>/api/v3 → https://<host>.
  private webBaseUrl(): string {
    const apiUrl = this.config.apiUrl ?? 'https://api.github.com';
    if (/^https?:\/\/api\.github\.com\/?$/.test(apiUrl)) {
      return 'https://github.com';
    }
    return apiUrl.replace(/\/api\/v3\/?$/, '').replace(/\/+$/, '');
  }

  buildCommitFileUrl(owner: string, repo: string, commitId: string, _filePath: string): string {
    // No reliable file anchor for a commit view on GitHub — link to the commit.
    return `${this.webBaseUrl()}/${owner}/${repo}/commit/${commitId}`;
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

  // ─── Release-flow REST helpers (VcsClient) ────────────────────────────────
  // The four methods below mirror BitbucketService so the commit-analysis
  // pipeline can be driven against GitHub by swapping the client.

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

  // Map GitHub file status → ChangeEntry.type so downstream code (ChangeDetector,
  // diffParser) stays provider-agnostic.
  private mapGitHubFileStatus(
    status: string,
  ): 'ADD' | 'MODIFY' | 'DELETE' | 'RENAME' | 'COPY' | 'MOVE' {
    switch (status) {
      case 'added': return 'ADD';
      case 'removed': return 'DELETE';
      case 'renamed': return 'RENAME';
      case 'copied': return 'COPY';
      case 'modified':
      case 'changed':
      default: return 'MODIFY';
    }
  }

  private pathToChangeEntry(filename: string, previousFilename: string | undefined, status: string): ChangeEntry {
    const components = filename.split('/');
    const name = components[components.length - 1];
    const extMatch = name?.match(/\.([^.]+)$/);
    const entry: ChangeEntry = {
      path: {
        components,
        name,
        extension: extMatch ? extMatch[1] : undefined,
        toString: filename,
      },
      type: this.mapGitHubFileStatus(status),
    };
    if (previousFilename) {
      const prevComponents = previousFilename.split('/');
      entry.srcPath = { components: prevComponents, toString: previousFilename };
      entry.dstPath = { components, toString: filename };
    }
    return entry;
  }

  async getMergedPullRequest(
    owner: string,
    repo: string,
    commitHash: string,
    branch?: string,
  ): Promise<PullRequestInfo | null> {
    try {
      type GitHubPullForCommit = {
        number: number;
        title: string;
        body: string | null;
        state: 'open' | 'closed';
        merged_at: string | null;
        html_url: string;
        user: { login: string; id: number; email?: string | null };
        base: { ref: string };
      };

      const prs = await this.restRequest<GitHubPullForCommit[]>(
        `/repos/${owner}/${repo}/commits/${commitHash}/pulls`,
      );

      logger.info(
        `GitHub: found ${prs.length} PR(s) for commit ${commitHash} in ${owner}/${repo}`,
      );

      if (prs.length === 0) return null;

      const merged = prs.filter(pr => pr.merged_at != null);
      if (merged.length === 0) {
        logger.info(`No merged PRs for commit ${commitHash} (found ${prs.length} unmerged)`);
        return null;
      }

      // Only PRs targeting the supplied branch; fall back to main/master
      // (logged) when none, so a release-branch commit isn't mis-attributed.
      let relevant: GitHubPullForCommit[];
      if (branch) {
        relevant = merged.filter(pr => pr.base.ref === branch);
        if (relevant.length === 0) {
          relevant = merged.filter(pr => pr.base.ref === 'main' || pr.base.ref === 'master');
          if (relevant.length > 0) {
            logger.warn(
              `GitHub: no merged PR targets branch ${branch} for commit ${commitHash}; ` +
              `falling back to ${relevant.length} main/master PR(s)`,
            );
          }
        }
      } else {
        relevant = merged;
      }
      if (relevant.length === 0) {
        logger.info(`No relevant merged PRs for commit ${commitHash} on branch ${branch}`);
        return null;
      }

      relevant.sort(
        (a, b) => new Date(b.merged_at!).getTime() - new Date(a.merged_at!).getTime(),
      );

      const pr = relevant[0];
      return {
        id: pr.number,
        title: pr.title,
        description: pr.body ?? '',
        state: 'MERGED',
        url: pr.html_url,
        mergedAt: pr.merged_at!,
        author: {
          displayName: pr.user.login,
          id: pr.user.id,
          emailAddress: pr.user.email ?? '',
        },
      };
    } catch (error) {
      logger.error(`GitHub: failed to fetch PRs for commit ${commitHash}:`, error as Error);
      return null;
    }
  }

  async getCommitChanges(owner: string, repo: string, commitId: string): Promise<ChangeEntry[]> {
    type GitHubCommitFile = {
      filename: string;
      previous_filename?: string;
      status: string;
    };
    type GitHubCommitResponse = { files?: GitHubCommitFile[] };

    const data = await this.restRequest<GitHubCommitResponse>(
      `/repos/${owner}/${repo}/commits/${commitId}`,
    );
    const files = data.files ?? [];
    return files.map(f => this.pathToChangeEntry(f.filename, f.previous_filename, f.status));
  }

  async getCommitsBetween(
    owner: string,
    repo: string,
    sinceCommitId: string,
    untilCommitId: string,
    _branch?: string,
  ): Promise<string[]> {
    // compare API paginates commits[] (max 250/page); page through via
    // total_commits so long release ranges aren't silently truncated.
    type GitHubCompareResponse = { total_commits: number; commits: Array<{ sha: string }> };

    try {
      const ids: string[] = [];
      const PER_PAGE = 250;
      for (let page = 1; ; page++) {
        const data = await this.restRequest<GitHubCompareResponse>(
          `/repos/${owner}/${repo}/compare/${sinceCommitId}...${untilCommitId}?per_page=${PER_PAGE}&page=${page}`,
        );
        ids.push(...data.commits.map(c => c.sha));
        if (ids.length >= data.total_commits || data.commits.length === 0) break;
      }
      logger.info(
        `GitHub: found ${ids.length} commit(s) between ${sinceCommitId}..${untilCommitId} in ${owner}/${repo}`,
      );
      // Match Bitbucket's contract: include the since-commit at the tail.
      return [...ids, sinceCommitId];
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        `GitHub: failed to fetch commits between ${sinceCommitId} and ${untilCommitId} in ${owner}/${repo}: ${msg}`,
      );
      throw error;
    }
  }

  async getFileDiff(owner: string, repo: string, commitId: string, filePath: string): Promise<string> {
    try {
      type GitHubCommitFile = {
        filename: string;
        patch?: string;
      };
      type GitHubCommitResponse = { files?: GitHubCommitFile[] };

      const data = await this.restRequest<GitHubCommitResponse>(
        `/repos/${owner}/${repo}/commits/${commitId}`,
      );
      const file = (data.files ?? []).find(f => f.filename === filePath);
      if (!file) {
        logger.warn(`GitHub: file ${filePath} not in commit ${commitId}`);
        return '';
      }
      // `patch` is GitHub's unified-diff body without the `--- a/foo` / `+++ b/foo`
      // headers diffParser expects, so synthesize them.
      const patch = file.patch ?? '';
      if (!patch) return '';
      return `--- a/${filePath}\n+++ b/${filePath}\n${patch}\n`;
    } catch (error) {
      logger.error(`GitHub: failed to fetch diff for ${filePath} in ${commitId}:`, error as Error);
      throw error;
    }
  }

  /**
   * Fetch all commits for a pull request (for bot attribution tracking)
   * Returns full commit messages for Co-authored-by parsing
   */
  async getCommitsForPullRequest(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<Array<{
    sha: string;
    authorName: string;
    authorEmail: string;
    message: string;
    committedAt: Date;
  }>> {
    try {
      const commits: Array<{
        sha: string;
        commit: {
          author: { name: string; email: string; date: string };
          message: string;
        };
      }> = [];

      const PER_PAGE = 100;
      let page = 1;

      // Fetch all pages
      while (true) {
        const url = `/repos/${owner}/${repo}/pulls/${prNumber}/commits?per_page=${PER_PAGE}&page=${page}`;
        const data = await this.restRequest<typeof commits>(url);

        commits.push(...data);

        // Last page reached
        if (data.length < PER_PAGE) break;
        page++;
      }

      logger.info(`GitHub: fetched ${commits.length} commit(s) for PR #${prNumber} in ${owner}/${repo}`);

      return commits.map((c) => ({
        sha: c.sha,
        authorName: c.commit.author.name,
        authorEmail: c.commit.author.email,
        message: c.commit.message, // FULL message for Co-authored-by parsing
        committedAt: new Date(c.commit.author.date),
      }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`GitHub: failed to fetch commits for PR #${prNumber} in ${owner}/${repo}: ${msg}`);
      throw error;
    }
  }
}

export const createGitHubService = (owner: string, repo: string): GitHubService => {
  return new GitHubService({
    owner,
    repo,
    token: config.github?.token,
    apiUrl: config.github?.apiUrl,
  });
};
