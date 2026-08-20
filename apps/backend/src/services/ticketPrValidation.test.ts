// Unit tests for the pure ticket-PR helpers. No DB/provider — safe to run in CI.

import {
  parseBitbucketRepoUrl,
  parseBitbucketPrUrl,
  extractTicketKeyFromTitle,
  computeValidation,
} from './ticketPrValidation';

describe('parseBitbucketRepoUrl', () => {
  it('parses a standard repo URL', () => {
    expect(
      parseBitbucketRepoUrl('https://bitbucket.juspay.net/projects/XYNE/repos/xyne-spaces'),
    ).toEqual({ projectKey: 'XYNE', repoSlug: 'xyne-spaces' });
  });

  it('strips a trailing path and .git suffix', () => {
    expect(
      parseBitbucketRepoUrl('https://bitbucket.juspay.net/projects/XYNE/repos/xyne-spaces.git/browse'),
    ).toEqual({ projectKey: 'XYNE', repoSlug: 'xyne-spaces' });
  });

  it('returns null for a non-Bitbucket URL', () => {
    expect(parseBitbucketRepoUrl('https://github.com/foo/bar')).toBeNull();
    expect(parseBitbucketRepoUrl('')).toBeNull();
  });
});

describe('parseBitbucketPrUrl', () => {
  const PR = 'https://bitbucket.juspay.net/projects/XYNE/repos/xyne-spaces/pull-requests/8594';

  it('parses a canonical PR URL', () => {
    expect(parseBitbucketPrUrl(PR)).toEqual({
      projectKey: 'XYNE',
      repoSlug: 'xyne-spaces',
      prId: 8594,
      prUrl: PR,
    });
  });

  it('strips trailing segments and query/fragment', () => {
    expect(parseBitbucketPrUrl(`${PR}/overview?commentId=12#foo`)?.prUrl).toBe(PR);
  });

  it('returns null for a repo URL without a PR id', () => {
    expect(
      parseBitbucketPrUrl('https://bitbucket.juspay.net/projects/XYNE/repos/xyne-spaces'),
    ).toBeNull();
  });
});

describe('extractTicketKeyFromTitle', () => {
  it.each([
    ['XYNE-123: fix the thing', 'XYNE-123'],
    ['feat: XYNE-123 add the thing', 'XYNE-123'],
    ['fix: XYNE-123: subject', 'XYNE-123'],
    ['xyne-99 lowercase key', 'XYNE-99'],
  ])('extracts %s -> %s', (title, expected) => {
    expect(extractTicketKeyFromTitle(title)).toBe(expected);
  });

  it('returns null when no key is present', () => {
    expect(extractTicketKeyFromTitle('just a random title')).toBeNull();
    expect(extractTicketKeyFromTitle('')).toBeNull();
  });
});

describe('computeValidation', () => {
  it('is valid when the title key matches the ticket', () => {
    expect(
      computeValidation({ ticketXyneId: 'XYNE-123', prTitle: 'XYNE-123: do it' }).state,
    ).toBe('valid');
  });

  it('warns (non-strict) when the title lacks the ticket key', () => {
    const r = computeValidation({ ticketXyneId: 'XYNE-123', prTitle: 'no key here' });
    expect(r.state).toBe('warning');
    expect(r.reason).toBe('missing-ticket-key');
  });

  it('is invalid (strict) when the title lacks the ticket key', () => {
    expect(
      computeValidation({ ticketXyneId: 'XYNE-123', prTitle: 'no key here', strict: true }).state,
    ).toBe('invalid');
  });

  it('is invalid when the ticket is resolved regardless of title', () => {
    const r = computeValidation({
      ticketXyneId: 'XYNE-123',
      prTitle: 'XYNE-123: do it',
      ticketResolved: true,
    });
    expect(r.state).toBe('invalid');
    expect(r.reason).toBe('ticket-resolved');
  });

  it('is invalid on duplicate PRs', () => {
    const r = computeValidation({ ticketXyneId: 'XYNE-123', prTitle: 'XYNE-123', duplicate: true });
    expect(r.state).toBe('invalid');
    expect(r.reason).toBe('duplicate-pr');
  });

  it('is unknown when no title is available', () => {
    expect(computeValidation({ ticketXyneId: 'XYNE-123' }).state).toBe('unknown');
  });
});
