// Picks the right VCS client (Bitbucket vs GitHub) for the release commit
// analysis flow. Centralised so controller / versionReleaseMappingService /
// releaseNotesService all dispatch the same way.

import { config } from '@/config/env';
import { resolveSecret } from '@/config/secretResolver';
import { logger } from '@/utils/logger';
import { BitbucketService } from '../bitbucketService';
import { GitHubService } from '../githubService';
import { VcsClient } from '../../types/vcs';
import { VCSProviderType } from '@xyne/shared';

// Bitbucket REST base, tolerating a bare host or a full .../rest/api/latest.
export function normalizeBitbucketApiBaseUrl(baseUrl: string | undefined): string {
  if (!baseUrl) {
    throw new Error('BITBUCKET_BASE_URL is not configured');
  }
  return baseUrl.endsWith('/rest/api/latest') ? baseUrl : `${baseUrl}/rest/api/latest`;
}

export async function buildVcsClient(provider: VCSProviderType | null | undefined): Promise<VcsClient> {
  if (provider === VCSProviderType.GITHUB) {
    const githubConfig = config.github;
    const token = await resolveSecret('github-token', githubConfig?.token ?? '');
    if (!token) {
      logger.warn(
        'GitHub VCS provider selected but no token is available (vault has no active version and ' +
        'GITHUB_TOKEN is not set) — anonymous access will hit rate limits (60 req/hr) and 404 on private repos.',
      );
    }
    return new GitHubService({
      token,
      apiUrl: githubConfig?.apiUrl,
    });
  }

  // Default to Bitbucket Server for any other value (including null/undefined,
  // matching the pre-existing behaviour).
  const bitbucketConfig = config.bitbucket;
  return new BitbucketService({
    baseUrl: normalizeBitbucketApiBaseUrl(bitbucketConfig.baseUrl),
    username: bitbucketConfig.apiUsername || '',
    password: bitbucketConfig.password || '',
    token: bitbucketConfig.apiToken || '',
  });
}
