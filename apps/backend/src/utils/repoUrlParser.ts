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

// Parses a GitHub repo URL (github.com or GHE) into owner + repo, accepting
// https, scheme-less, ssh:// and scp-like forms. Host-anchored via URL parsing
// so lookalikes (notgithub.com, github.com.evil.io) never match.
export function parseGitHubRepoUrl(url: string): { owner: string; repo: string } | null {
  if (!url) return null;
  let candidate = url.trim();

  // scp-like SSH (git@host:owner/repo.git) isn't URL-parseable — normalise it.
  const scpLike = /^git@([^:/\s]+):(.+)$/.exec(candidate);
  if (scpLike) candidate = `ssh://git@${scpLike[1]}/${scpLike[2]}`;
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) candidate = `https://${candidate}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  // github.com / www / GHE (github.<domain>), but not github.com.<lookalike>
  const host = parsed.hostname.toLowerCase();
  const isGheHost = host.startsWith('github.') && !host.startsWith('github.com.');
  if (host !== 'github.com' && host !== 'www.github.com' && !isGheHost) {
    return null;
  }

  const [owner, repoSegment] = parsed.pathname.split('/').filter(Boolean);
  const repo = repoSegment?.replace(/\.git$/i, '');
  if (!owner || !repo) return null;
  return { owner, repo };
}
