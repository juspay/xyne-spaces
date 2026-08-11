import { App } from 'octokit';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';

/**
 * GitHub App REST client backed by Octokit.
 * Octokit signs the App JWT, resolves the repo installation, and mints + caches
 * installation access tokens automatically — no manual JWT/token plumbing.
 */
export class GithubAppClient {
  private app: App | null = null;

  /** Lazily build the Octokit App from config (null if App creds aren't set). */
  private getApp(): App | null {
    if (this.app) {
      return this.app;
    }
    const appId = config.github?.appId;
    const b64Key = config.github?.appPrivateKey;
    if (!appId || !b64Key) {
      return null;
    }
    const privateKey = Buffer.from(b64Key, 'base64').toString('utf8');
    this.app = new App({ appId, privateKey });
    return this.app;
  }

  /** Post a comment on an issue as the App. Returns true on success. */
  async postIssueComment(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string
  ): Promise<boolean> {
    const app = this.getApp();
    if (!app) {
      logger.warn('[GitHub-App] appId/privateKey not configured; cannot post comment');
      return false;
    }
    try {
      // Resolve the installation for this repo, then act as that installation.
      const { data: installation } = await app.octokit.rest.apps.getRepoInstallation({
        owner,
        repo,
      });
      const octokit = await app.getInstallationOctokit(installation.id);
      await octokit.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body });
      return true;
    } catch (error) {
      logger.warn(`[GitHub-App] posting comment failed on ${owner}/${repo}#${issueNumber}:`, error);
      return false;
    }
  }
}

export const githubAppClient = new GithubAppClient();
