import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MENTION_USER_SCHEME,
  MENTION_CHANNEL_SCHEME,
  MENTION_GROUP_SCHEME,
  MENTION_BROADCAST_SCHEME,
} from '@/src/components/conversation-composer/utils/mentionSchemes';

describe('mention schemes', () => {
  const all = [
    MENTION_USER_SCHEME,
    MENTION_CHANNEL_SCHEME,
    MENTION_GROUP_SCHEME,
    MENTION_BROADCAST_SCHEME,
  ];

  it('exposes the exact xyne:// scheme prefixes', () => {
    assert.equal(MENTION_USER_SCHEME, 'xyne://user/');
    assert.equal(MENTION_CHANNEL_SCHEME, 'xyne://channel/');
    assert.equal(MENTION_GROUP_SCHEME, 'xyne://group/');
    assert.equal(MENTION_BROADCAST_SCHEME, 'xyne://broadcast/');
  });

  it('all use the xyne:// protocol and a trailing slash', () => {
    for (const scheme of all) {
      assert.ok(scheme.startsWith('xyne://'), `${scheme} should use xyne://`);
      assert.ok(scheme.endsWith('/'), `${scheme} should end with /`);
    }
  });

  it('are mutually distinct so renderers can disambiguate mention types', () => {
    assert.equal(new Set(all).size, all.length);
  });

  it('composes a decodable markdown-link target with an id', () => {
    const encoded = `${MENTION_USER_SCHEME}user_123`;
    assert.equal(encoded, 'xyne://user/user_123');
    assert.equal(encoded.slice(MENTION_USER_SCHEME.length), 'user_123');
  });
});
