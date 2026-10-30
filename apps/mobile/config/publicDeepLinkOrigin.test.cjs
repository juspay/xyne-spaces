const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const { resolvePublicDeepLinkOrigin } = require('./publicDeepLinkOrigin.cjs');

describe('public deep-link origin', () => {
  it('returns the origin of a configured HTTPS origin', () => {
    assert.equal(
      resolvePublicDeepLinkOrigin(' https://example.org '),
      'https://example.org',
    );
  });

  it('fails loudly when no origin is configured', () => {
    assert.throws(() => resolvePublicDeepLinkOrigin(undefined), /PUBLIC_DEEP_LINK_ORIGIN/);
    assert.throws(() => resolvePublicDeepLinkOrigin(''), /PUBLIC_DEEP_LINK_ORIGIN/);
  });

  it('rejects non-HTTPS origins and origins with paths', () => {
    assert.throws(() => resolvePublicDeepLinkOrigin('http://example.org'));
    assert.throws(() => resolvePublicDeepLinkOrigin('https://example.org/chat'));
  });
});
