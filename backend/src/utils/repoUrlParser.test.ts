import { parseBitbucketRepoUrl } from './repoUrlParser';

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
