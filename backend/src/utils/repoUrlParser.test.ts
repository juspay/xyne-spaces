import { parseBitbucketRepoUrl } from './repoUrlParser';

describe('parseBitbucketRepoUrl', () => {
  describe('SSH clone URLs (what the webhook stores on pull_requests.repositoryUrl)', () => {
    it('parses an SSH clone URL with a lowercased project key', () => {
      expect(
        parseBitbucketRepoUrl('ssh://git@github.com/example-org/euler-api-txns.git'),
      ).toEqual({ projectKey: 'JBIZ', repoSlug: 'euler-api-txns' });
    });

    it('parses an SSH clone URL with an already-uppercase project key', () => {
      expect(
        parseBitbucketRepoUrl('ssh://git@github.com/example-org/euler-api-txns.git'),
      ).toEqual({ projectKey: 'JBIZ', repoSlug: 'euler-api-txns' });
    });

    // The prod DB held BOTH casings for euler-api-txns; they must resolve identically.
    it('normalises the jbiz/JBIZ casing split to the same result', () => {
      const lower = parseBitbucketRepoUrl('ssh://git@github.com/example-org/euler-api-txns.git');
      const upper = parseBitbucketRepoUrl('ssh://git@github.com/example-org/euler-api-txns.git');
      expect(lower).toEqual(upper);
    });

    it('parses other SSH repos', () => {
      expect(
        parseBitbucketRepoUrl('ssh://git@github.com/example-org/xyne-spaces.git'),
      ).toEqual({ projectKey: 'XYNE', repoSlug: 'xyne-spaces' });
    });

    it('ignores a non-standard port in the SSH host', () => {
      expect(
        parseBitbucketRepoUrl('ssh://git@ssh.bitbucket.juspay.net:7999/jbiz/euler-api-txns.git'),
      ).toEqual({ projectKey: 'JBIZ', repoSlug: 'euler-api-txns' });
    });
  });

  describe('HTTPS clone URLs (/scm)', () => {
    it('parses an HTTPS clone URL and uppercases the key', () => {
      expect(
        parseBitbucketRepoUrl('https://gowthaman@bitbucket.juspay.net/scm/JBIZ/euler-api-txns.git'),
      ).toEqual({ projectKey: 'JBIZ', repoSlug: 'euler-api-txns' });
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
        parseBitbucketRepoUrl('https://bitbucket.example.com/projects/JBIZ/repos/euler-api-txns/browse'),
      ).toEqual({ projectKey: 'JBIZ', repoSlug: 'euler-api-txns' });
    });

    it('parses a browse URL with query params', () => {
      expect(
        parseBitbucketRepoUrl(
          'https://bitbucket.example.com/projects/JBIZ/repos/euler-api-txns/browse?at=refs%2Fheads%2Fmain',
        ),
      ).toEqual({ projectKey: 'JBIZ', repoSlug: 'euler-api-txns' });
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
