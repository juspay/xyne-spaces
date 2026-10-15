import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MENTION_USER_SCHEME,
  MENTION_CHANNEL_SCHEME,
  MENTION_GROUP_SCHEME,
  MENTION_BROADCAST_SCHEME,
} from '@/src/features/chat/v2/components/conversation-composer/utils/mentionSchemes';
import * as legacy from '@/src/components/conversation-composer/utils/mentionSchemes';

describe('mention schemes (chat v2)', () => {
  it('exposes the exact xyne:// scheme prefixes', () => {
    assert.equal(MENTION_USER_SCHEME, 'xyne://user/');
    assert.equal(MENTION_CHANNEL_SCHEME, 'xyne://channel/');
    assert.equal(MENTION_GROUP_SCHEME, 'xyne://group/');
    assert.equal(MENTION_BROADCAST_SCHEME, 'xyne://broadcast/');
  });

  it('stays byte-for-byte in parity with the legacy composer schemes', () => {
    // The two modules encode the SAME wire format; a drift would break mentions
    // authored in one composer and rendered by the other.
    assert.equal(MENTION_USER_SCHEME, legacy.MENTION_USER_SCHEME);
    assert.equal(MENTION_CHANNEL_SCHEME, legacy.MENTION_CHANNEL_SCHEME);
    assert.equal(MENTION_GROUP_SCHEME, legacy.MENTION_GROUP_SCHEME);
    assert.equal(MENTION_BROADCAST_SCHEME, legacy.MENTION_BROADCAST_SCHEME);
  });
});
