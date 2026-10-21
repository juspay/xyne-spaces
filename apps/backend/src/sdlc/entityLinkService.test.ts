// @xyne/shared ships as ESM dist/, which this CJS jest setup cannot load.
jest.mock('@xyne/shared', () => ({
  SDLC_FOLDER_FLAT_RELATION: 'FOLDER_ITEM_SECONDARY',
  SDLC_TRACK_FLAT_RELATION: 'TRACK_ITEM_SECONDARY',
  planSdlcFolderEdges: jest.fn(),
}));
jest.mock('./sdlcChannelMembership', () => ({ isCanvasInChannel: jest.fn(), isTrackInChannel: jest.fn() }));
jest.mock('@/utils/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

import type { PrismaClient } from '@prisma/client';
import { fileScheduledCallDiscussion, linkCallToSdlcOwner } from './entityLinkService';

const makeDb = (owners: unknown[], itemTrack: { sourceId: string } | null = null) => {
  const createMany = jest.fn().mockResolvedValue({ count: 1 });
  const db = {
    sdlcEntityLink: {
      createMany,
      findMany: jest.fn().mockResolvedValue(owners),
      findFirst: jest.fn().mockResolvedValue(itemTrack),
    },
  } as unknown as PrismaClient;
  const written = () => createMany.mock.calls.map(([arg]) => arg.data[0]);
  return { db, written };
};

describe('linkCallToSdlcOwner', () => {
  it('files the call under its owner', async () => {
    const { db, written } = makeDb([]);
    await linkCallToSdlcOwner(
      db,
      { ownerType: 'TRACK', ownerId: 'track-1' },
      { callId: 'call-1', channelId: 'hub-1', workspaceId: 'ws-1', userId: 'u-1' },
    );
    expect(written()).toEqual([
      {
        channelId: 'hub-1',
        sourceType: 'TRACK',
        sourceId: 'track-1',
        targetType: 'CALL',
        targetId: 'call-1',
        relationType: 'CALL',
        workspaceId: 'ws-1',
        createdBy: 'u-1',
      },
    ]);
  });
});

describe('fileScheduledCallDiscussion', () => {
  const owner = (sourceType: string, sourceId: string) => ({
    workspaceId: 'ws-1',
    channelId: 'hub-1',
    sourceType,
    sourceId,
  });

  it('files the conversation under a track the call is filed under', async () => {
    const { db, written } = makeDb([owner('TRACK', 'track-1')]);
    await fileScheduledCallDiscussion(db, 'call-1', 'conv-1', 'u-1');
    expect(written()).toEqual([
      expect.objectContaining({
        sourceType: 'TRACK',
        sourceId: 'track-1',
        targetType: 'CONVERSATION',
        targetId: 'conv-1',
        relationType: 'DISCUSSION',
      }),
    ]);
  });

  it("also files an item's conversation under the item's track", async () => {
    const { db, written } = makeDb([owner('FOLDER', 'folder-1')], { sourceId: 'track-1' });
    await fileScheduledCallDiscussion(db, 'call-1', 'conv-1', 'u-1');
    expect(written()).toEqual([
      expect.objectContaining({ sourceType: 'FOLDER', sourceId: 'folder-1', relationType: 'DISCUSSION' }),
      expect.objectContaining({
        sourceType: 'TRACK',
        sourceId: 'track-1',
        targetId: 'conv-1',
        relationType: 'TRACK_ITEM_SECONDARY',
      }),
    ]);
  });

  it('writes nothing for a call filed nowhere', async () => {
    const { db, written } = makeDb([]);
    await fileScheduledCallDiscussion(db, 'call-1', 'conv-1', 'u-1');
    expect(written()).toEqual([]);
  });
});
