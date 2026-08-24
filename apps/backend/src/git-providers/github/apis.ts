import axios, { AxiosError } from 'axios';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import type { IGitProvider, GitDiffFile, GithubConfig } from '../types';

// GitHub login / repo name: alphanumerics, '-', '_', '.' (no path separators).
const GITHUB_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;
// Abbreviated or full git object id.
const GIT_SHA_PATTERN = /^[0-9a-f]{7,64}$/i;
// Strip control characters (incl. CR/LF) so user-derived text can't forge log lines.
const sanitizeForLog = (value: string): string =>
  value.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 200);

export class GithubManager implements IGitProvider {
  private readonly config: GithubConfig;

  constructor() {
    this.config = {
      token: config.github.token,
      apiUrl: config.github.apiUrl || 'https://api.github.com',
    };
  }

  /**
   * Extract PR ID from GitHub PR URL
   * Supports: https://github.com/owner/repo/pull/123
   *           https://github.com/owner/repo/pull/123/files
   *           git@github.com:owner/repo.git (not a PR URL, returns null)
   */
  extractPRIdFromUrl(prUrl: string): number | null {
    try {
      // Clean up the URL
      const cleanUrl = prUrl.replace(/\/+$/, '').replace(/\/files$/, '').replace(/\/commits$/, '');
      const match = cleanUrl.match(/\/pull\/(\d+)$/);
      if (match) {
        return parseInt(match[1], 10);
      }
      return null;
    } catch (error) {
      logger.error('[GithubManager] Error extracting PR ID from URL:', prUrl, error);
      return null;
    }
  }

  /**
   * Parse repository owner and name from various GitHub URL formats
   */
  parseRepoFromUrl(repoUrl: string): { owner: string; repo: string } | null {
    try {
      // SSH format: git@github.com:owner/repo.git
      const sshMatch = repoUrl.match(/git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
      if (sshMatch) {
        return { owner: sshMatch[1], repo: sshMatch[2] };
      }

      // HTTPS format: https://github.com/owner/repo.git or https://github.com/owner/repo
      const httpsMatch = repoUrl.match(/https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/.*)?$/);
      if (httpsMatch) {
        return { owner: httpsMatch[1], repo: httpsMatch[2] };
      }

      // GitHub Enterprise SSH format: git@github.enterprise.com:owner/repo.git
      const gheSshMatch = repoUrl.match(/git@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/);
      if (gheSshMatch && this.isGitHubUrl(repoUrl)) {
        return { owner: gheSshMatch[1], repo: gheSshMatch[2] };
      }

      // GitHub Enterprise HTTPS format
      const gheHttpsMatch = repoUrl.match(/https:\/\/[^/]+\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/.*)?$/);
      if (gheHttpsMatch && this.isGitHubUrl(repoUrl)) {
        return { owner: gheHttpsMatch[1], repo: gheHttpsMatch[2] };
      }

      return null;
    } catch (error) {
      logger.error('[GithubManager] Error parsing repo from URL:', repoUrl, error);
      return null;
    }
  }

  private isGitHubUrl(url: string): boolean {
    return url.includes('github.com') || url.includes('github.');
  }

  private getHeaders() {
    return {
      'Authorization': `Bearer ${this.config.token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'xyne-spaces',
    };
  }

  /**
   * Post a commit status (the GitHub counterpart of Bitbucket's build status).
   * Shows up on the PR checks list under `context`; branch protection can require it.
   * Description is capped at 140 chars by the API.
   *
   * owner/repo/sha originate from webhook payloads: they are allow-list validated
   * before being placed in the request path, and only encoded segments are logged.
   */
  async postCommitStatus(
    owner: string,
    repo: string,
    commitSha: string,
    state: 'pending' | 'success' | 'failure' | 'error',
    context: string,
    description: string,
    targetUrl?: string,
  ): Promise<void> {
    if (!GITHUB_NAME_PATTERN.test(owner) || !GITHUB_NAME_PATTERN.test(repo)) {
      throw new Error('Invalid GitHub owner/repo for commit status');
    }
    if (!GIT_SHA_PATTERN.test(commitSha)) {
      throw new Error('Invalid commit SHA for commit status');
    }
    const safeOwner = encodeURIComponent(owner);
    const safeRepo = encodeURIComponent(repo);
    const safeSha = encodeURIComponent(commitSha);
    const url = `${this.config.apiUrl}/repos/${safeOwner}/${safeRepo}/statuses/${safeSha}`;
    const safeDescription = sanitizeForLog(description);
    const payload = {
      state,
      context,
      description: description.length > 140 ? `${description.slice(0, 137)}...` : description,
      ...(targetUrl && { target_url: targetUrl }),
    };
    logger.debug('[GitHub-API] Posting commit status', {
      owner: safeOwner,
      repo: safeRepo,
      sha: safeSha,
      state,
      context,
      description: safeDescription,
    });
    try {
      await axios.post(url, payload, { headers: this.getHeaders() });
      logger.info('[GitHub-API] Commit status posted', {
        owner: safeOwner,
        repo: safeRepo,
        sha: safeSha,
        state,
        context,
        description: safeDescription,
      });
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('[GitHub-API] Error posting commit status:', {
        status: axiosError.response?.status,
        data: axiosError.response?.data,
        message: axiosError.message,
      });
      throw error;
    }
  }

  /**
   * Raise a pull request on GitHub
   */
  async raisePr(
    repoUrl: string,
    _executionId: string,
    baseBranch: string,
    headBranch: string,
    projectName: string,
    repoName: string,
    title: string,
    description: string,
    xyneId?: string,
    ticketId?: string,
    draft: boolean = false,
  ): Promise<string | undefined> {
    if (!baseBranch || !headBranch || !projectName || !repoName) {
        logger.error('[BitbucketManager] Missing required parameters to create PR:', {
          baseBranch,
          headBranch,
          projectName,
          repoName
        });
      return undefined;
    }
    const repo = this.parseRepoFromUrl(repoUrl);
    if (!repo) {
      logger.error('[GithubManager] Could not parse repository from URL:', repoUrl);
      return undefined;
    }

    // Use provided projectName/repoName if available, otherwise use parsed values
    const owner = projectName || repo.owner;
    const repoSlug = repoName || repo.repo;

    const prBody = this.formatPrDescription(description, xyneId, ticketId);

    try {
      logger.info(`[GithubManager] Creating PR: ${headBranch} → ${baseBranch} in ${owner}/${repoSlug}`);

      const response = await axios.post(
        `${this.config.apiUrl}/repos/${owner}/${repoSlug}/pulls`,
        {
          title,
          body: prBody,
          head: headBranch,
          base: baseBranch,
          draft,
        },
        { headers: this.getHeaders() }
      );

      const prUrl = response.data.html_url;
      logger.info(`[GithubManager] Successfully created PR: ${prUrl}`);
      return prUrl;
    } catch (error) {
      const axiosError = error as AxiosError;

      // Handle duplicate PR error (422 with "A pull request already exists")
      if (axiosError.response?.status === 422) {
        const errorMessage = JSON.stringify(axiosError.response.data);
        if (errorMessage.includes('already exists') || errorMessage.includes('A pull request')) {
          logger.info('[GithubManager] PR already exists, fetching existing PR URL');
          const existingPr = await this.findExistingPr(owner, repoSlug, headBranch);
          if (existingPr) {
            return existingPr;
          }
        }
      }

      logger.error('[GithubManager] Failed to create PR:', axiosError.response?.data || axiosError.message);
      return undefined;
    }
  }

  /**
   * Find an existing open PR for a given branch
   */
  private async findExistingPr(owner: string, repo: string, headBranch: string): Promise<string | undefined> {
    try {
      const response = await axios.get(
        `${this.config.apiUrl}/repos/${owner}/${repo}/pulls`,
        {
          headers: this.getHeaders(),
          params: {
            head: `${owner}:${headBranch}`,
            state: 'open',
          },
        }
      );

      if (response.data.length > 0) {
        return response.data[0].html_url;
      }
      return undefined;
    } catch (error) {
      logger.error('[GithubManager] Error finding existing PR:', error);
      return undefined;
    }
  }

  private formatPrDescription(description: string, xyneId?: string, ticketId?: string): string {
    let formatted = description;

    if (ticketId) {
      formatted += `\n\nRelated to: ${ticketId}`;
    }

    if (xyneId) {
      formatted += `\n\nGenerated by: Xyne (${xyneId})`;
    }

    return formatted;
  }

  /**
   * Update PR description on GitHub
   */
  async updatePrDescription(
    projectKey: string,
    repoSlug: string,
    prId: number,
    description: string
  ): Promise<void> {
    try {
      await axios.patch(
        `${this.config.apiUrl}/repos/${projectKey}/${repoSlug}/pulls/${prId}`,
        {
          body: description,
        },
        { headers: this.getHeaders() }
      );
      logger.info(`[GithubManager] Updated PR description for PR #${prId}`);
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('[GithubManager] Failed to update PR description:', axiosError.response?.data || axiosError.message);
      throw error;
    }
  }

  /**
   * Get diff for a specific PR
   */
  async getPRDiff(projectKey: string, repoSlug: string, prId: number): Promise<GitDiffFile[]> {
    try {
      logger.info(`[GithubManager] Fetching PR files for PR #${prId} in ${projectKey}/${repoSlug}`);

      // GitHub's PR files endpoint returns the list of changed files
      const response = await axios.get(
        `${this.config.apiUrl}/repos/${projectKey}/${repoSlug}/pulls/${prId}/files`,
        { headers: this.getHeaders() }
      );

      const files = response.data;
      const gitDiffFiles: GitDiffFile[] = files.map((file: any) => this.convertGithubFileToGitDiff(file));

      logger.info(`[GithubManager] Fetched ${gitDiffFiles.length} files for PR #${prId}`);
      return gitDiffFiles;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('[GithubManager] Failed to fetch PR diff:', axiosError.response?.data || axiosError.message);
      return [];
    }
  }

  /**
   * Get diff between two commits
   */
  async getDiff(
    projectKey: string,
    repoSlug: string,
    sinceHash: string,
    untilHash: string
  ): Promise<GitDiffFile[]> {
    try {
      logger.info(`[GithubManager] Fetching diff between ${sinceHash} and ${untilHash}`);

      // GitHub's compare endpoint
      const response = await axios.get(
        `${this.config.apiUrl}/repos/${projectKey}/${repoSlug}/compare/${sinceHash}...${untilHash}`,
        { headers: this.getHeaders() }
      );

      const files = response.data.files || [];
      const gitDiffFiles: GitDiffFile[] = files.map((file: any) => this.convertGithubFileToGitDiff(file));

      logger.info(`[GithubManager] Fetched ${gitDiffFiles.length} files from diff`);
      return gitDiffFiles;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('[GithubManager] Failed to fetch diff:', axiosError.response?.data || axiosError.message);
      return [];
    }
  }

  /**
   * Get latest commit on a branch
   */
  async getLatestCommit(
    projectKey: string,
    repoSlug: string,
    branch: string
  ): Promise<{ id: string } | null> {
    try {
      logger.info(`[GithubManager] Fetching latest commit on branch ${branch}`);

      const response = await axios.get(
        `${this.config.apiUrl}/repos/${projectKey}/${repoSlug}/commits/${branch}`,
        {
          headers: this.getHeaders(),
          params: { per_page: 1 },
        }
      );

      const commit = response.data;
      return { id: commit.sha };
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('[GithubManager] Failed to fetch latest commit:', axiosError.response?.data || axiosError.message);
      return null;
    }
  }

  /**
   * Convert GitHub file format to our internal GitDiffFile format
   */
  private convertGithubFileToGitDiff(file: any): GitDiffFile {
    // Map GitHub status to our type
    let type: 'add' | 'delete' | 'modify' | 'rename';
    switch (file.status) {
      case 'added':
        type = 'add';
        break;
      case 'removed':
        type = 'delete';
        break;
      case 'renamed':
        type = 'rename';
        break;
      case 'modified':
      case 'changed':
      default:
        type = 'modify';
        break;
    }

    // Parse the patch to create hunks
    const hunks = this.parsePatch(file.patch || '');

    return {
      oldPath: file.previous_filename || file.filename,
      newPath: file.filename,
      type,
      hunks,
    };
  }

  /**
   * Parse a unified diff patch into hunks
   */
  private parsePatch(patch: string): Array<{ oldStart: number; oldLines: number; newStart: number; newLines: number; content: string }> {
    if (!patch) {
      return [];
    }

    const hunks: Array<{ oldStart: number; oldLines: number; newStart: number; newLines: number; content: string }> = [];
    const lines = patch.split('\n');

    let currentHunk: { oldStart: number; oldLines: number; newStart: number; newLines: number; content: string } | null = null;

    for (const line of lines) {
      // Hunk header: @@ -oldStart,oldLines +newStart,newLines @@
      const hunkMatch = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
      if (hunkMatch) {
        if (currentHunk) {
          hunks.push(currentHunk);
        }
        currentHunk = {
          oldStart: parseInt(hunkMatch[1], 10),
          oldLines: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
          newStart: parseInt(hunkMatch[3], 10),
          newLines: hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1,
          content: line + '\n',
        };
      } else if (currentHunk) {
        currentHunk.content += line + '\n';
      }
    }

    if (currentHunk) {
      hunks.push(currentHunk);
    }

    return hunks;
  }
}

// Export singleton instance
export const githubManager = new GithubManager();
