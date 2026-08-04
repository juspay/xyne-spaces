// Parses a Bitbucket Server / Data Center repo URL into projectKey + repoSlug.
// Handles the three forms Bitbucket emits:
//   - HTTPS browse:  https://bitbucket.example.net/projects/KEY/repos/slug/browse
//   - HTTPS clone:   https://user@bitbucket.example.net/scm/KEY/slug.git
//   - SSH clone:     ssh://git@ssh.bitbucket.example.net/key/slug.git
// The project key is normalised to Bitbucket's uppercase convention in all forms,
// so the same repo resolves identically regardless of how the URL was stored.
// Returns null for non-matching URLs so callers can log+skip without throwing.

export function parseBitbucketRepoUrl(url: string): { projectKey: string; repoSlug: string } | null {
  if (!url) return null;

  // HTTPS browse URL: .../projects/<KEY>/repos/<slug>...
  const browse = /\/projects\/([^/]+)\/repos\/([^/.?#]+)/i.exec(url);
  if (browse?.[1] && browse[2]) {
    return { projectKey: browse[1].toUpperCase(), repoSlug: browse[2] };
  }

  // Clone URLs (SSH or HTTPS): the project/repo are the last two path segments,
  // with an optional /scm prefix (HTTPS clone) and an optional .git suffix.
  // SSH carries a lowercased project key, so normalise to Bitbucket's uppercase convention.
  const clone = /(?:\/scm)?\/([^/]+)\/([^/?#]+?)(?:\.git)?\/?(?:[?#].*)?$/i.exec(url);
  if (clone?.[1] && clone[2]) {
    return { projectKey: clone[1].toUpperCase(), repoSlug: clone[2] };
  }

  return null;
}

// Parses a Bitbucket PR URL (.../projects/<KEY>/repos/<slug>/pull-requests/<id>) into
// projectKey + repoSlug + prId. Returns null for non-matching URLs so callers can log+skip.
export function parseBitbucketPrUrl(
  url: string,
): { projectKey: string; repoSlug: string; prId: number } | null {
  if (!url) return null;
  const m = /\/projects\/([^/]+)\/repos\/([^/]+)\/pull-requests\/(\d+)/i.exec(url);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  return { projectKey: m[1].toUpperCase(), repoSlug: m[2], prId: parseInt(m[3], 10) };
}
