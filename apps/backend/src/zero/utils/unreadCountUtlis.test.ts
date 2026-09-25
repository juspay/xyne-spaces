/**
 * DM recount write must not clobber a read: if the recipient opens the DM between the
 * recount's read and its write (markChannelAsViewed zeroes unreadCount and moves
 * lastViewedAt), the stale count is dropped instead of resurrecting the badge.
 */

jest.mock('@/database/tenant/context', () => ({
  withWorkspaceScope: (fn: () => Promise<void>) => fn(),
}));

jest.mock('@/database/client', () => ({
  db: {
    channelStats: { findUnique: jest.fn() },
    channelUserStatus: { findMany: jest.fn(), updateMany: jest.fn() },
    conversation: { count: jest.fn() },
    activity: { findMany: jest.fn() },
  },
}));

import { db } from '@/database/client';
import { handleUnreadCount } from './unreadCountUtlis';

const mockedDb = db as unknown as {
  channelStats: { findUnique: jest.Mock };
  channelUserStatus: { findMany: jest.Mock; updateMany: jest.Mock };
  conversation: { count: jest.Mock };
};

const VIEWED_AT = new Date('2026-09-25T10:00:00Z');
const ACTIVITY_AT = new Date('2026-09-25T11:00:00Z');

describe('handleUnreadCount (DM branch)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedDb.channelStats.findUnique.mockResolvedValue({ lastActivityAt: ACTIVITY_AT });
    mockedDb.channelUserStatus.updateMany.mockResolvedValue({ count: 1 });
  });

  it('writes the recount only while lastViewedAt is unchanged', async () => {
    mockedDb.channelUserStatus.findMany.mockResolvedValue([
      { userId: 'u2', lastViewedAt: VIEWED_AT, unreadCount: 0 },
    ]);
    mockedDb.conversation.count.mockResolvedValue(3);

    await handleUnreadCount('ch-1', true, [{ userId: 'u1' }, { userId: 'u2' }], 'u1');

    expect(mockedDb.channelUserStatus.updateMany).toHaveBeenCalledTimes(1);
    const call = mockedDb.channelUserStatus.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ channelId: 'ch-1', userId: 'u2', lastViewedAt: VIEWED_AT });
    expect(call.data.unreadCount).toBe(3);
  });

  it('guards a never-viewed channel with lastViewedAt: null', async () => {
    mockedDb.channelUserStatus.findMany.mockResolvedValue([
      { userId: 'u2', lastViewedAt: null, unreadCount: 0 },
    ]);
    mockedDb.conversation.count.mockResolvedValue(1);

    await handleUnreadCount('ch-1', true, [{ userId: 'u1' }, { userId: 'u2' }], 'u1');

    expect(mockedDb.channelUserStatus.updateMany.mock.calls[0][0].where.lastViewedAt).toBeNull();
  });

  it('does not write when the count is unchanged', async () => {
    mockedDb.channelUserStatus.findMany.mockResolvedValue([
      { userId: 'u2', lastViewedAt: VIEWED_AT, unreadCount: 3 },
    ]);
    mockedDb.conversation.count.mockResolvedValue(3);

    await handleUnreadCount('ch-1', true, [{ userId: 'u1' }, { userId: 'u2' }], 'u1');

    expect(mockedDb.channelUserStatus.updateMany).not.toHaveBeenCalled();
  });

  it('is a no-op, not an error, when the guard loses the race (row already moved on)', async () => {
    mockedDb.channelUserStatus.findMany.mockResolvedValue([
      { userId: 'u2', lastViewedAt: VIEWED_AT, unreadCount: 0 },
    ]);
    mockedDb.conversation.count.mockResolvedValue(3);
    mockedDb.channelUserStatus.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      handleUnreadCount('ch-1', true, [{ userId: 'u1' }, { userId: 'u2' }], 'u1'),
    ).resolves.toBeUndefined();
  });
});
