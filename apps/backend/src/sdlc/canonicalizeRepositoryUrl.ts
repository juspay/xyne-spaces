import { AppError } from '@/middleware/errorHandler';

export interface CanonicalRepositoryUrl {
  canonicalUrl: string;
  inferredName: string;
}

const SCP_STYLE_SSH = /^(?:[^@\s]+@)?([^:\s/]+):(.+)$/;

export function canonicalizeRepositoryUrl(rawUrl: string): CanonicalRepositoryUrl {
  const value = rawUrl.trim();
  if (!value) {
    throw new AppError('Repository URL is required', 400);
  }

  let host: string;
  let path: string;
  const scpMatch = value.match(SCP_STYLE_SSH);

  if (scpMatch && !value.includes('://')) {
    host = scpMatch[1];
    path = scpMatch[2];
  } else {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new AppError('Repository URL must be HTTPS or SSH', 400);
    }

    if (!['http:', 'https:', 'ssh:', 'git:'].includes(parsed.protocol)) {
      throw new AppError('Repository URL must be HTTPS or SSH', 400);
    }
    host = parsed.hostname;
    path = parsed.pathname;
  }

  const normalizedPath = path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
  const segments = normalizedPath.split('/').filter(Boolean);
  if (!host || segments.length < 2) {
    throw new AppError('Repository URL must include an owner and repository name', 400);
  }

  const normalizedHost = host.toLowerCase();
  const caseInsensitiveHosts = new Set(['github.com', 'gitlab.com', 'bitbucket.org']);
  const canonicalPath = caseInsensitiveHosts.has(normalizedHost)
    ? segments.join('/').toLowerCase()
    : segments.join('/');

  return {
    canonicalUrl: `${normalizedHost}/${canonicalPath}`,
    inferredName: segments.at(-1)!,
  };
}
