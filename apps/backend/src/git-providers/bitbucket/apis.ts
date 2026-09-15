import { PRMetricsRepository } from "@/database/repositories/pullRequestsRepository";
import { logger } from '@/utils/logger';
import { transformBitbucketDiff } from '@/utils/diffUtils';
import { PullRequestData, BitbucketDuplicatePRError } from '@/types/bitbucket';
import { config } from '@/config/env';

const BASE_URL = config.bitbucket.baseUrl;

export class BitbucketManager {
  constructor(private prMetricsRepository = new PRMetricsRepository()) {}

  /**
   * Creates authenticated headers for Bitbucket API requests
   */
  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const bitbucketUsername = config.bitbucket.apiUsername;
    const bitbucketPassword = config.bitbucket.apiToken;

    if (bitbucketUsername && bitbucketPassword) {
      const authString = Buffer.from(`${bitbucketUsername}:${bitbucketPassword}`).toString(
        'base64'
      );
      headers['Authorization'] = `Basic ${authString}`;
    }

    return headers;
  }

  /**
   * Builds a Bitbucket API URL for pull requests
   */
  private buildPullRequestUrl(projectKey: string, repoSlug: string, prId?: number): string {
    const baseUrl = `${BASE_URL}/projects/${projectKey}/repos/${repoSlug}/pull-requests`;
    return prId ? `${baseUrl}/${prId}` : baseUrl;
  }

    /**
     * Makes an authenticated request to the Bitbucket API
     */
    private async makeRequest<T>(url: string, method: 'GET' | 'POST' | 'PUT', body?: any): Promise<{ data: T; status: number }> {
        logger.info(`${method} ${url}`);

    const response = await fetch(url, {
      method,
      headers: this.getAuthHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });

    const responseData = await response.json();

    if (!response.ok && response.status !== 409) {
      throw new Error(
        `Failed to ${method} ${url}: ${response.status} - ${JSON.stringify(responseData)}`
      );
    }

        return { data: responseData as T, status: response.status };
    }

    async getLatestCommit(projectKey: string, repoSlug: string, branch: string): Promise<{ id: string } | null> {
        try {
            const url = `${BASE_URL}/projects/${projectKey}/repos/${repoSlug}/commits?until=${encodeURIComponent(branch)}&limit=1`;
            const response = await this.makeRequest<{ values: Array<{ id: string }> }>(url, 'GET');
            return response.data.values?.[0] || null;
        } catch (error) {
            logger.error(`[Bitbucket API] Error getting latest commit for ${projectKey}/${repoSlug} on ${branch}:`, { error: error instanceof Error ? error.message : error });
            return null;
        }
    }

    async getDiff(projectKey: string, repoSlug: string, sinceHash: string, untilHash: string): Promise<any[]> {
        try {
            const url = `${BASE_URL}/projects/${projectKey}/repos/${repoSlug}/compare/diff?from=${untilHash}&to=${sinceHash}&contextLines=3`;
            const response = await this.makeRequest<{ diffs: any[] }>(url, 'GET');

            if (!response.data.diffs) {
                return [];
            }

            return response.data.diffs.map((diff: any) => transformBitbucketDiff(diff));
        } catch (error) {
            logger.error(`[Bitbucket API] Error getting diff for ${projectKey}/${repoSlug} between ${sinceHash}..${untilHash}:`, { error: error instanceof Error ? error.message : error });
            return [];
        }
    }

    async getPRDiff(projectKey: string, repoSlug: string, prId: number): Promise<any[]> {
      try {
        const url = `${BASE_URL}/projects/${projectKey}/repos/${repoSlug}/pull-requests/${prId}/diff?contextLines=3`;
        const response = await this.makeRequest<{ diffs: any[] }>(url, 'GET');

        if (!response.data.diffs) return [];

        return response.data.diffs.map((diff: any) => transformBitbucketDiff(diff));
      } catch (error) {
        logger.error(`[Bitbucket API] Error getting PR diff for ${projectKey}/${repoSlug} PR #${prId}:`, { error: error instanceof Error ? error.message : error });
        return [];
      }
    }

    extractPRIdFromUrl(prUrl: string): number | null {
      try {
        const prMatch = prUrl.match(/\/pull-requests\/(\d+)/);
        if (prMatch && prMatch[1]) {
            return parseInt(prMatch[1], 10);
        }
        return null;
      } catch (error) {
        logger.warn(`[Bitbucket API] Failed to extract PR ID from URL: ${prUrl}`);
        return null;
      }
    }

  async raisePr(
    repoUrl: string,
    childExecutionId: string,
    destinationBranchName?: string,
    sourceBranchName?: string,
    projectName?: string,
    repoName?: string,
    ticketTitle?: string,
    ticketDescription?: string,
    xyneId?: string,
    ticketId?: string,
    draft: boolean = false,
  ): Promise<string | undefined> {
    if (!sourceBranchName || !destinationBranchName || !projectName || !repoName) {
      return undefined;
    }

    try {
      const url = this.buildPullRequestUrl(projectName, repoName);

      let prTitle = 'Xyne Generated PR';
      if (xyneId && ticketTitle) {
        prTitle = `feat: ${xyneId} ${ticketTitle}`;
      } else if (xyneId) {
        prTitle = `feat: ${xyneId}`;
      } else if (ticketTitle) {
        prTitle = `feat: ${ticketTitle}`;
      }
      if (draft) {
        prTitle = `[Draft] ${prTitle}`;
      }

      const payload = {
        title: prTitle,
        description: ticketDescription || 'Auto-generated pull request',
        fromRef: {
          id: `refs/heads/${sourceBranchName}`,
          repository: {
            slug: repoName,
            project: {
              key: projectName,
            },
          },
        },
        toRef: {
          id: `refs/heads/${destinationBranchName}`,
          repository: {
            slug: repoName,
            project: {
              key: projectName,
            },
          },
        },
      };

      const response = await this.makeRequest<PullRequestData | BitbucketDuplicatePRError>(
        url,
        'POST',
        payload
      );

      let prId: number;
      let prUrl: string;

      if (response.status === 200 || response.status === 201) {
        const prData = response.data as PullRequestData;
        prId = prData.id;
        prUrl = prData.links?.self?.[0]?.href;

        if (!prId || !prUrl) {
          throw new Error('Invalid PR response from Bitbucket');
        }
      } else if (response.status === 409) {
        const errorData = response.data as BitbucketDuplicatePRError;
        prId = errorData.errors?.[0]?.existingPullRequest?.id;
        prUrl = errorData.errors?.[0]?.existingPullRequest?.links?.self?.[0]?.href;

        if (!prId || !prUrl) {
          throw new Error('Invalid duplicate PR error response from Bitbucket');
        }

        if (ticketDescription) {
          const version = errorData.errors?.[0]?.existingPullRequest?.version;
          if (version === undefined) {
            throw new Error('Missing version in duplicate PR error response');
          }
          await this.updatePrDescription(projectName, repoName, prId, ticketDescription, version);
        }
      } else {
        throw new Error(`Unexpected response status: ${response.status}`);
      }

      await this.prMetricsRepository.insertPRIfNotPresent({
        prId,
        sourceBranchName,
        destinationBranchName,
        childExecutionId,
        prUrl,
        repoName,
        repoUrl,
        ticketId: ticketId
      });

      logger.info(`[Bitbucket-API] PR created/updated: ${prUrl}`);
      logger.debug(`[Bitbucket-API] PR ${prId} inserted with ticketId: ${ticketId || 'fetched from workflow execution'}`);
      
      return prUrl;
    } catch (error) {
      logger.error('[Bitbucket-API] Error raising PR:', error);
      return undefined;
    }
  }

  async updatePrDescription(
    projectKey: string,
    repoSlug: string,
    prId: number,
    description: string,
    version: number
  ) {
    try {
      const url = this.buildPullRequestUrl(projectKey, repoSlug, prId);
      const payload = { description, version };

      await this.makeRequest(url, 'PUT', payload);
      logger.info('[Bitbucket-API] PR description updated successfully');
    } catch (error) {
      logger.error('[Bitbucket-API] Error updating PR description:', error);
    }
  }

  async postBuildStatus(
    commitHash: string,
    state: 'INPROGRESS' | 'SUCCESSFUL' | 'FAILED',
    key: string,
    name: string,
    url: string,
    description: string
  ) {
    try {
      const buildStatusUrl = `${config.bitbucket.baseUrl}/rest/build-status/1.0/commits/${commitHash}`;
      const payload = {
        state,
        key,
        name,
        url,
        description,
      };
      logger.debug('[Bitbucket-API] Posting build status', {
        url: buildStatusUrl,
        state,
        description,
      });

      const response = await fetch(buildStatusUrl, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to post build status: ${response.status} - ${errorText}`);
      }

      logger.info(`[Bitbucket-API] Build status posted: ${state} - ${description}`);
    } catch (error) {
      logger.error('[Bitbucket-API] Error posting build status:', error);
      throw error;
    }
  }

  /**
   * Add user write permission to a specific repository
   * @param projectKey The Bitbucket project key
   * @param repositorySlug The repository slug
   * @param username The Bitbucket username to grant access to
   */
  async addUserWritePermission(
    projectKey: string,
    repositorySlug: string,
    username: string
  ): Promise<{ success: boolean; error?: string }> {
    const url = `${BASE_URL}/projects/${projectKey}/repos/${repositorySlug}/permissions/users?name=${encodeURIComponent(username)}&permission=REPO_WRITE`;

    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        
        if (response.status === 409 && errorText.includes('downgrade your own permissions')) {
          logger.info(`[Bitbucket-API] User ${username} already has higher permissions on ${projectKey}/${repositorySlug}`);
          return { success: true };
        }
        
        logger.error(`[Bitbucket-API] Failed to add user permission: ${response.status} ${response.statusText}`, { errorText });
        return { success: false, error: `Bitbucket API error: ${response.status} ${response.statusText}` };
      }

      logger.info(`[Bitbucket-API] Successfully added REPO_WRITE permission for user ${username} to ${projectKey}/${repositorySlug}`);
      return { success: true };
    } catch (error) {
      logger.error('[Bitbucket-API] Error adding user permission:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}

export const bitbucketManager = new BitbucketManager();
