import { AppError } from '@/middleware/errorHandler';

const SAFE_GITHUB_SEGMENT = /^[A-Za-z0-9_.-]+$/;

export function isSafeSdlcGitRef(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 255 &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) &&
    !value.includes('..') &&
    !value.includes('//') &&
    !value.endsWith('.') &&
    !value.endsWith('/')
  );
}

/**
 * Convert the repository's scheme-less canonical identity into the only clone
 * shape SDLC V1 permits. `canonicalUrl` deliberately omits the scheme for
 * deduplication, so it must never be forwarded directly to Claw's URL parser.
 */
export function toSdlcGithubCloneUrl(canonicalUrl: unknown): string {
  if (typeof canonicalUrl !== 'string' || !canonicalUrl.trim()) {
    throw new AppError('SDLC repository is missing its canonical GitHub URL', 400);
  }
  const normalized = canonicalUrl.trim().replace(/^https?:\/\//i, '').replace(/\.git$/i, '');
  const segments = normalized.split('/').filter(Boolean);
  if (
    segments.length !== 3 ||
    segments[0]?.toLowerCase() !== 'github.com' ||
    !segments[1] ||
    !segments[2] ||
    !SAFE_GITHUB_SEGMENT.test(segments[1]) ||
    !SAFE_GITHUB_SEGMENT.test(segments[2])
  ) {
    throw new AppError('SDLC V1 requires a public GitHub owner/repository URL', 400);
  }
  return `https://github.com/${segments[1]}/${segments[2]}.git`;
}

export function requireSdlcBaseBranch(branches: unknown): string {
  if (!Array.isArray(branches)) {
    throw new AppError('Repository base branch configuration is invalid', 400);
  }
  const firstBranch = branches[0];
  const branch = typeof firstBranch === 'string' ? firstBranch.trim() || 'main' : 'main';
  if (!isSafeSdlcGitRef(branch)) {
    throw new AppError('Repository base branch is not a valid Git reference', 400);
  }
  return branch;
}
