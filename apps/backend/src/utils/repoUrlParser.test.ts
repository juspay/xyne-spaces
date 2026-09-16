import { parseBitbucketPrUrl, parseBitbucketRepoUrl, parseGitHubRepoUrl } from './repoUrlParser';

describe('parseBitbucketPrUrl', () => {
  it('parses a canonical PR URL', () => {
    expect(
      parseBitbucketPrUrl('https://bitbucket.example.com/projects/XYNE/repos/xyne-spaces/pull-requests/8594')
    ).toEqual({
      prUrl: 'https://bitbucket.example.com/projects/XYNE/repos/xyne-spaces/pull-requests/8594',
      prId: 8594,
      projectKey: 'XYNE',
      repositorySlug: 'xyne-spaces',
      hostname: 'bitbucket.example.com',
    });
  });

  it('canonicalizes URL variants with trailing segments and query params', () => {
    expect(
      parseBitbucketPrUrl('https://bitbucket.example.com/projects/EULER/repos/euler-api/pull-requests/12/overview?commentId=9')
    ).toEqual({
      prUrl: 'https://bitbucket.example.com/projects/EULER/repos/euler-api/pull-requests/12',
      prId: 12,
      projectKey: 'EULER',
      repositorySlug: 'euler-api',
      hostname: 'bitbucket.example.com',
    });
  });

  it('normalizes casing to Bitbucket conventions (uppercase key, lowercase slug/host)', () => {
    expect(
      parseBitbucketPrUrl('https://BITBUCKET.example.com/projects/xyne/repos/Xyne-Spaces/pull-requests/7')
    ).toEqual({
      prUrl: 'https://bitbucket.example.com/projects/XYNE/repos/xyne-spaces/pull-requests/7',
      prId: 7,
      projectKey: 'XYNE',
      repositorySlug: 'xyne-spaces',
      hostname: 'bitbucket.example.com',
    });
  });

  it('strips userinfo from the canonical URL', () => {
    expect(
      parseBitbucketPrUrl('https://user:pass@bitbucket.example.com/projects/XYNE/repos/xyne-spaces/pull-requests/9')?.prUrl
    ).toBe('https://bitbucket.example.com/projects/XYNE/repos/xyne-spaces/pull-requests/9');
  });

  it('returns null for non-PR URLs and garbage', () => {
    expect(parseBitbucketPrUrl('https://bitbucket.example.com/projects/XYNE/repos/xyne-spaces/commits/abc')).toBeNull();
    expect(parseBitbucketPrUrl('not a url')).toBeNull();
    expect(parseBitbucketPrUrl('')).toBeNull();
  });
});

describe('parseBitbucketRepoUrl', () => {
  describe('SSH clone URLs (what the webhook stores on pull_requests.repositoryUrl)', () => {
    it('parses an SSH clone URL with a lowercased project key', () => {
      expect(
        parseBitbucketRepoUrl('ssh://git@ssh.bitbucket.example.com/eng/sample-service.git'),
      ).toEqual({ projectKey: 'ENG', repoSlug: 'sample-service' });
    });

    it('parses an SSH clone URL with an already-uppercase project key', () => {
      expect(
        parseBitbucketRepoUrl('ssh://git@ssh.bitbucket.example.com/ENG/sample-service.git'),
      ).toEqual({ projectKey: 'ENG', repoSlug: 'sample-service' });
    });

    // Real deployments have held BOTH casings for the same repo; they must resolve identically.
    it('normalises the eng/ENG casing split to the same result', () => {
      const lower = parseBitbucketRepoUrl('ssh://git@ssh.bitbucket.example.com/eng/sample-service.git');
      const upper = parseBitbucketRepoUrl('ssh://git@ssh.bitbucket.example.com/ENG/sample-service.git');
      expect(lower).toEqual(upper);
    });

    it('parses other SSH repos', () => {
      expect(
        parseBitbucketRepoUrl('ssh://git@ssh.bitbucket.example.com/xyne/xyne-spaces.git'),
      ).toEqual({ projectKey: 'XYNE', repoSlug: 'xyne-spaces' });
    });

    it('ignores a non-standard port in the SSH host', () => {
      expect(
        parseBitbucketRepoUrl('ssh://git@ssh.bitbucket.example.com:7999/eng/sample-service.git'),
      ).toEqual({ projectKey: 'ENG', repoSlug: 'sample-service' });
    });
  });

  describe('HTTPS clone URLs (/scm)', () => {
    it('parses an HTTPS clone URL and uppercases the key', () => {
      expect(
        parseBitbucketRepoUrl('https://devuser@bitbucket.example.com/scm/ENG/sample-service.git'),
      ).toEqual({ projectKey: 'ENG', repoSlug: 'sample-service' });
    });
  });

  describe('HTTPS browse URLs (what Application.repoUrl is configured with)', () => {
    it('parses a browse URL', () => {
      expect(
        parseBitbucketRepoUrl('https://bitbucket.example.com/projects/XYNE/repos/xyne-spaces'),
      ).toEqual({ projectKey: 'XYNE', repoSlug: 'xyne-spaces' });
    });

    it('normalises a mixed-case browse project key to uppercase (consistent with the clone paths)', () => {
      expect(
        parseBitbucketRepoUrl('https://bitbucket.example.com/projects/Xyne/repos/xyne-spaces'),
      ).toEqual({ projectKey: 'XYNE', repoSlug: 'xyne-spaces' });
    });

    it('parses a browse URL with a /browse suffix', () => {
      expect(
        parseBitbucketRepoUrl('https://bitbucket.example.com/projects/ENG/repos/sample-service/browse'),
      ).toEqual({ projectKey: 'ENG', repoSlug: 'sample-service' });
    });

    it('parses a browse URL with query params', () => {
      expect(
        parseBitbucketRepoUrl(
          'https://bitbucket.example.com/projects/ENG/repos/sample-service/browse?at=refs%2Fheads%2Fmain',
        ),
      ).toEqual({ projectKey: 'ENG', repoSlug: 'sample-service' });
    });
  });

  describe('invalid inputs return null', () => {
    it.each(['', 'garbage', 'not-a-url', 'https://example.com'])('returns null for %p', (input) => {
      expect(parseBitbucketRepoUrl(input)).toBeNull();
    });

    it('returns null for null/undefined', () => {
      expect(parseBitbucketRepoUrl(null as unknown as string)).toBeNull();
      expect(parseBitbucketRepoUrl(undefined as unknown as string)).toBeNull();
    });
  });
});

describe('parseGitHubRepoUrl', () => {
  it('parses an https github.com URL', () => {
    expect(parseGitHubRepoUrl('https://github.com/juspay/xyne-spaces')).toEqual({
      owner: 'juspay',
      repo: 'xyne-spaces',
    });
  });

  it('strips a trailing .git', () => {
    expect(parseGitHubRepoUrl('https://github.com/juspay/xyne-spaces.git')).toEqual({
      owner: 'juspay',
      repo: 'xyne-spaces',
    });
  });

  it('parses a scheme-less URL', () => {
    expect(parseGitHubRepoUrl('github.com/juspay/xyne-spaces')).toEqual({
      owner: 'juspay',
      repo: 'xyne-spaces',
    });
  });

  it('parses a www.github.com URL', () => {
    expect(parseGitHubRepoUrl('https://www.github.com/juspay/xyne-spaces')).toEqual({
      owner: 'juspay',
      repo: 'xyne-spaces',
    });
  });

  it('parses a GHE-style host', () => {
    expect(parseGitHubRepoUrl('https://github.acme.com/owner/repo')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('parses scp-like SSH clone syntax', () => {
    expect(parseGitHubRepoUrl('git@github.com:juspay/xyne-spaces.git')).toEqual({
      owner: 'juspay',
      repo: 'xyne-spaces',
    });
  });

  it('ignores extra path segments, query and fragment', () => {
    expect(parseGitHubRepoUrl('https://github.com/juspay/xyne-spaces/tree/main?tab=readme#top')).toEqual({
      owner: 'juspay',
      repo: 'xyne-spaces',
    });
  });

  it('rejects lookalike hosts (host anchoring)', () => {
    expect(parseGitHubRepoUrl('https://notgithub.com/owner/repo')).toBeNull();
    expect(parseGitHubRepoUrl('https://github.com.evil.io/owner/repo')).toBeNull();
    expect(parseGitHubRepoUrl('https://evil.com/github.com/owner/repo')).toBeNull();
  });

  it('rejects URLs without owner/repo', () => {
    expect(parseGitHubRepoUrl('https://github.com/')).toBeNull();
    expect(parseGitHubRepoUrl('https://github.com/onlyowner')).toBeNull();
  });

  it('returns null for empty/garbage input', () => {
    expect(parseGitHubRepoUrl('')).toBeNull();
    expect(parseGitHubRepoUrl('garbage')).toBeNull();
    expect(parseGitHubRepoUrl(null as unknown as string)).toBeNull();
  });
});
