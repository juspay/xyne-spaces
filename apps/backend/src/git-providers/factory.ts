import { logger } from '@/utils/logger';
import { BitbucketManager } from './bitbucket/apis';
import { GithubManager } from './github/apis';
import type { IGitProvider } from './types';

/**
 * Detect if a repository URL is GitHub
 */
function isGitHubUrl(repoUrl: string): boolean {
  // Check for github.com or github enterprise patterns
  if (repoUrl.includes('github.com')) {
    return true;
  }
  
  // Check for github enterprise (github.xxx.xxx patterns)
  if (repoUrl.match(/github\.[a-z0-9-]+\.[a-z]+/i)) {
    return true;
  }
  
  return false;
}

/**
 * Get the appropriate Git provider for a repository URL
 */
export function getGitProvider(repoUrl: string): IGitProvider {
  if (isGitHubUrl(repoUrl)) {
    logger.info(`[getGitProvider] Detected GitHub repository: ${repoUrl}`);
    return new GithubManager();
  }
  
  logger.info(`[getGitProvider] Using Bitbucket provider for: ${repoUrl}`);
  return new BitbucketManager();
}

/**
 * Singleton instances for reuse
 */
let bitbucketManagerInstance: BitbucketManager | null = null;
let githubManagerInstance: GithubManager | null = null;

/**
 * Get singleton BitbucketManager instance
 */
export function getBitbucketManager(): BitbucketManager {
  if (!bitbucketManagerInstance) {
    bitbucketManagerInstance = new BitbucketManager();
  }
  return bitbucketManagerInstance;
}

/**
 * Get singleton GithubManager instance
 */
export function getGithubManager(): GithubManager {
  if (!githubManagerInstance) {
    githubManagerInstance = new GithubManager();
  }
  return githubManagerInstance;
}