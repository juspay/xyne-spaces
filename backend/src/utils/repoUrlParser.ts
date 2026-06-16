// Parses a Bitbucket Server / Data Center repo URL into projectKey + repoSlug.
// Returns null for non-matching URLs so callers can log+skip without throwing.

export function parseBitbucketRepoUrl(url: string): { projectKey: string; repoSlug: string } | null {
  if (!url) return null;
  const match = /\/projects\/([^/]+)\/repos\/([^/.?#]+)/i.exec(url);
  if (!match) return null;
  const [, projectKey, repoSlug] = match;
  if (!projectKey || !repoSlug) return null;
  return { projectKey, repoSlug };
}
