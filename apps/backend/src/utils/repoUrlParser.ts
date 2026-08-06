// Parses a Bitbucket Server / Data Center repo URL into projectKey + repoSlug.
// Handles the three forms Bitbucket emits:
//   - HTTPS browse:  https://bitbucket.example.net/projects/KEY/repos/slug/browse
//   - HTTPS clone:   https://user@bitbucket.example.net/scm/KEY/slug.git
//   - SSH clone:     ssh://git@ssh.bitbucket.example.net/key/slug.git
// The project key is normalised to Bitbucket's uppercase convention in all forms,
// so the same repo resolves identically regardless of how the URL was stored.
// Returns null for non-matching URLs so callers can log+skip without throwing.

// Parses a Bitbucket Server PR URL into its structured reference. Accepts any
// variant (trailing /overview, query params, fragments) and normalizes casing
// (uppercase project key, lowercase slug). This canonical form is what we store
// in our own tables (pr_thread_links), so exact-equality is safe THERE. It does
// NOT necessarily match pull_requests.prUrl — that column holds Bitbucket's raw
// self href (bitbucketWebhookService), whose casing can diverge; match it
// case-insensitively. prId is per-repository in Bitbucket — never unique alone.
export function parseBitbucketPrUrl(url: string): {
  prUrl: string; // canonical: https://<host>/projects/<KEY>/repos/<slug>/pull-requests/<id>
  prId: number;
  projectKey: string;
  repositorySlug: string;
  hostname: string; // lowercased, no userinfo/trailing dot — for host allowlist checks
} | null {
  if (!url) return null;

  // URL() gives a normalized origin: lowercased host, no userinfo — so a
  // pasted `https://user@HOST/...` can't leak credentials or dodge matching.
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }

  const match = /\/projects\/([^/]+)\/repos\/([^/]+)\/pull-requests\/(\d+)/.exec(parsedUrl.pathname);
  if (!match) return null;

  // Normalize casing to Bitbucket's own conventions (uppercase project key,
  // lowercase slug) so the same repo resolves identically regardless of how the
  // pasted link was cased. Note: pull_requests.prUrl stores the raw webhook self
  // href, which may not be canonicalized — match that column case-insensitively.
  const projectKey = match[1].toUpperCase();
  const repositorySlug = match[2].toLowerCase();
  const prIdRaw = match[3];

  return {
    prUrl: `${parsedUrl.origin}/projects/${projectKey}/repos/${repositorySlug}/pull-requests/${prIdRaw}`,
    prId: parseInt(prIdRaw, 10),
    projectKey,
    repositorySlug,
    hostname: parsedUrl.hostname.toLowerCase().replace(/\.$/, ''),
  };
}

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
