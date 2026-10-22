import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseSupportDeepLink } from '@/src/notifications/supportDeepLink';

describe('parseSupportDeepLink', () => {
  it('reads a desk ticket link', () => {
    assert.deepEqual(
      parseSupportDeepLink('/6642623f-cca7-43ad-9a6b-5e49c33226b4/support/channel-1/XYNE-42'),
      { channelId: 'channel-1', xyneId: 'XYNE-42' },
    );
  });

  it('reads a desk conversation link', () => {
    assert.deepEqual(
      parseSupportDeepLink(
        '/workspace/support/channel-1?conversationId=conv-1&messageId=msg-1',
      ),
      { channelId: 'channel-1', conversationId: 'conv-1', messageId: 'msg-1' },
    );
  });

  it('leaves chat and DM links alone', () => {
    assert.equal(
      parseSupportDeepLink(
        '/workspace/chat/dir/channel-1/conv-1#origin=conv-1&messageId=msg-1',
      ),
      null,
    );
    assert.equal(parseSupportDeepLink('/workspace/chat/dm/channel-1#origin=conv-1'), null);
  });
});
