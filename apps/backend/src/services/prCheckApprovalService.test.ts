jest.mock('@/config/env', () => ({
  config: {
    backendUrl: 'http://localhost:3000',
    bitbucket: { baseUrl: 'https://bitbucket.juspay.net/rest/api/latest' },
  },
}));
jest.mock('@/database/client', () => ({ db: {} }));
jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));
// @xyne/shared ships ESM that jest's transform ignores — stub the one import used.
jest.mock('@xyne/shared', () => ({ MessageType: { BOT: 'BOT' } }));

import { extractPrLink } from './prCheckApprovalService';

describe('extractPrLink', () => {
  const PR_URL = 'https://bitbucket.juspay.net/projects/XYNE/repos/xyne-spaces/pull-requests/8594';

  it('extracts a plain PR link', () => {
    expect(extractPrLink(`please merge ${PR_URL}`)).toEqual({
      prUrl: PR_URL,
      prId: 8594,
      projectKey: 'XYNE',
      repositorySlug: 'xyne-spaces',
      hostname: 'bitbucket.juspay.net',
    });
  });

  it('extracts a PR link from HTML content', () => {
    const html = `<p>merge this: <a href="${PR_URL}/overview?commentId=12">PR</a></p>`;
    expect(extractPrLink(html)?.prUrl).toBe(PR_URL);
  });

  it('normalizes trailing segments and query params to the canonical URL', () => {
    expect(extractPrLink(`${PR_URL}/overview?foo=bar#heading`)?.prUrl).toBe(PR_URL);
  });

  it('returns the first PR when multiple are present', () => {
    const other = 'https://bitbucket.juspay.net/projects/EULER/repos/euler-api/pull-requests/12';
    expect(extractPrLink(`${PR_URL} ${other}`)?.prId).toBe(8594);
  });

  it('rejects lookalike hosts', () => {
    expect(
      extractPrLink('https://bitbucket.juspay.net.evil.com/projects/XYNE/repos/xyne-spaces/pull-requests/1')
    ).toBeNull();
    expect(
      extractPrLink('https://evilbitbucket.juspay.net.attacker.io/projects/A/repos/b/pull-requests/2')
    ).toBeNull();
  });

  it('skips a lookalike host and returns a later valid link', () => {
    const evil = 'https://bitbucket.juspay.net.evil.com/projects/A/repos/b/pull-requests/1';
    expect(extractPrLink(`${evil} then ${PR_URL}`)?.prId).toBe(8594);
  });

  it('accepts subdomains of the configured host', () => {
    expect(
      extractPrLink('https://mirror.bitbucket.juspay.net/projects/XYNE/repos/xyne-spaces/pull-requests/3')?.prId
    ).toBe(3);
  });

  it('ignores non-PR Bitbucket URLs', () => {
    expect(extractPrLink('https://bitbucket.juspay.net/projects/XYNE/repos/xyne-spaces/commits/abc123')).toBeNull();
    expect(extractPrLink('https://bitbucket.juspay.net/projects/XYNE/repos/xyne-spaces')).toBeNull();
  });

  it('returns null for content without links', () => {
    expect(extractPrLink('no links here')).toBeNull();
  });
});
