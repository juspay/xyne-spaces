import { logger } from '@/utils/logger';
import { config } from '@/config/env';

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
  owner: string;
  repo: string;
  token?: string;
  apiUrl?: string;
}

export class GitHubService {
  private config: GitHubServiceConfig;
  private graphqlUrl: string;

  constructor(config: GitHubServiceConfig) {
    this.config = config;
    this.graphqlUrl = `${config.apiUrl}/graphql`;
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
}

export const createGitHubService = (owner: string, repo: string): GitHubService => {
  return new GitHubService({
    owner,
    repo,
    token: config.github?.token,
    apiUrl: config.github?.apiUrl,
  });
};
