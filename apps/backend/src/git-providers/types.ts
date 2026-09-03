// Shared types for Git providers (GitHub, Bitbucket, etc.)

export interface GitDiffFile {
  oldPath: string;
  newPath: string;
  type: 'add' | 'delete' | 'modify' | 'rename';
  hunks: Array<{
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    content: string;
  }>;
}

export interface IGitProvider {
  /**
   * Extract PR ID from a pull request URL
   * GitHub: https://github.com/owner/repo/pull/123 → 123
   * Bitbucket: https://bitbucket.org/projects/PROJ/repos/repo/pull-requests/123 → 123
   */
  extractPRIdFromUrl(prUrl: string): number | null;

  /**
   * Raise a pull request
   * Returns the PR URL if successful
   */
  raisePr(
    repoUrl: string,
    executionId: string,
    baseBranch: string|undefined,
    headBranch: string|undefined,
    projectName: string|undefined,
    repoName: string|undefined,
    title: string|undefined,
    description: string,
    xyneId?: string,
    ticketId?: string,
    draft?: boolean,
  ): Promise<string | undefined>;

  /**
   * Update PR description
   */
  updatePrDescription(
    projectKey: string,
    repoSlug: string,
    prId: number,
    description: string,
    version?: number
  ): Promise<void>;

  /**
   * Get diff for a specific PR
   */
  getPRDiff(projectKey: string, repoSlug: string, prId: number): Promise<GitDiffFile[]>;

  /**
   * Get diff between two commits
   */
  getDiff(
    projectKey: string,
    repoSlug: string,
    sinceHash: string,
    untilHash: string
  ): Promise<GitDiffFile[]>;

  /**
   * Get latest commit on a branch
   */
  getLatestCommit(
    projectKey: string,
    repoSlug: string,
    branch: string
  ): Promise<{ id: string } | null>;
}

/**
 * Parsed repository information from a repo URL
 */
export interface ParsedRepoInfo {
  owner: string; // GitHub: owner, Bitbucket: project key
  repo: string;  // Repository name/slug
  projectName?: string; // Bitbucket project name
  repoName?: string;    // Bitbucket repo name
}

/**
 * Configuration for GitHub API
 */
export interface GithubConfig {
  token: string;
  apiUrl: string; // https://api.github.com or GHE instance
}

/**
 * Configuration for Bitbucket API
 */
export interface BitbucketConfig {
  username: string;
  password: string;
  baseUrl: string;
  token?: string;
}
