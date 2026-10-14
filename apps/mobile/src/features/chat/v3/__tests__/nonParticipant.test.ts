import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatNonParticipantMarkdown,
  nonParticipantPreviewFromMetadata,
} from '../model/nonParticipant';

describe('nonParticipantPreviewFromMetadata', (): void => {
  it('ignores unrelated and malformed metadata', (): void => {
    assert.equal(nonParticipantPreviewFromMetadata(null, 'channel-1'), null);
    assert.equal(nonParticipantPreviewFromMetadata({ messageSubtype: 'other' }, 'channel-1'), null);
    assert.equal(
      nonParticipantPreviewFromMetadata(
        { messageSubtype: 'user_not_in_channel', channelId: '' },
        'channel-1',
      )?.channelId,
      'channel-1',
    );
  });

  it('normalizes the V2 action payload and preserves action capability', (): void => {
    assert.deepEqual(
      nonParticipantPreviewFromMetadata(
        {
          messageSubtype: 'user_not_in_channel',
          channelId: 'channel-2',
          mentionedUsers: [{ userId: 'u1' }, { userId: '' }, null, { userId: 'u2' }],
          canAddUsers: false,
        },
        'channel-1',
      ),
      {
        channelId: 'channel-2',
        userIds: ['u1', 'u2'],
        canAddMembers: false,
      },
    );
  });

  it('keeps V2 spacing between adjacent mention links', (): void => {
    assert.equal(
      formatNonParticipantMarkdown('Added, [**@Ada**](xyne://user/a)[**@Lin**](xyne://user/l)'),
      'Added,  [**@Ada**](xyne://user/a)  [**@Lin**](xyne://user/l)',
    );
  });
});
