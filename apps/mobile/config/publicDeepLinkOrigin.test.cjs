const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const {
  DEFAULT_PUBLIC_DEEP_LINK_ORIGIN,
  resolvePublicDeepLinkOrigin,
} = require('./publicDeepLinkOrigin.cjs');

describe('public deep-link origin', () => {
  it('uses the canonical production origin by default', () => {
    assert.equal(resolvePublicDeepLinkOrigin(undefined), DEFAULT_PUBLIC_DEEP_LINK_ORIGIN);
  });

  it('rejects non-HTTPS origins and origins with paths', () => {
    assert.throws(() => resolvePublicDeepLinkOrigin('http://spaces.xyne.juspay.net'));
    assert.throws(() => resolvePublicDeepLinkOrigin('https://spaces.xyne.juspay.net/chat'));
  });
});
