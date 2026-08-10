jest.mock('@xyne/shared', () => ({
  GOOGLE_PLAY_REVIEWS_SOURCE_TYPE: 'google-play-reviews',
}));

import { buildGooglePlaySourceRecords } from './sourceRecords';

describe('buildGooglePlaySourceRecords', () => {
  it('maps multiple applications to separate sources in the same channel', () => {
    const records = buildGooglePlaySourceRecords({
      workspaceId: 'workspace-1',
      channelId: 'channel-1',
      boardId: 'board-1',
      ownerUserId: 'owner-1',
      encryptedCredentials: 'encrypted-credentials',
      applications: [
        { packageName: 'com.example.one', displayName: 'App one' },
        { packageName: 'com.example.two', displayName: 'App two' },
      ],
    });

    expect(records).toHaveLength(2);
    expect(records.map((record) => record.channelId)).toEqual([
      'channel-1',
      'channel-1',
    ]);
    expect(records.map((record) => record.externalIdentifier)).toEqual([
      'com.example.one',
      'com.example.two',
    ]);
    expect(new Set(records.map((record) => record.name)).size).toBe(2);
    expect(records.every((record) => record.sourceType === 'google-play-reviews')).toBe(true);
  });
});
