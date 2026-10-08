import { SDLC_GITHUB_HOST } from '@xyne/shared';
import type { VcsProvider } from './types';
import { VcsProviderError } from './types';

export function repositoryHost(raw: string): string {
  const value = raw.trim();
  let host = '';
  const scp = value.match(/^[^@\s/]+@([^:\s/]+):/);
  if (scp && !value.includes('://')) {
    host = scp[1]!;
  } else if (value.includes('://')) {
    try {
      host = new URL(value).hostname;
    } catch {
      host = '';
    }
  } else {
    host = value.split('/')[0] ?? '';
  }
  // Bitbucket Data Center serves SSH from a separate `ssh.` host.
  host = host.toLowerCase().replace(/^ssh\./, '');
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(host)) {
    throw new VcsProviderError('INVALID_REPOSITORY_URL', 'Enter a valid repository link', 400);
  }
  return host;
}

export function providerForHost(host: string): VcsProvider {
  return host === SDLC_GITHUB_HOST ? 'GITHUB' : 'BITBUCKET_SERVER';
}
