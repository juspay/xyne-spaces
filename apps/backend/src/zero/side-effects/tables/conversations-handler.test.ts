/**
 * Phase 0 (unread badge unification): regression test for the frozen DM counter.
 *
 * `handleUnreadCount` skips recompute when `channel_stats.lastActivityAt <=
 * lastViewedAt`, but ordinary messages never bump `channel_stats.lastActivityAt`
 * (only channel creation, membership changes and calls do). The conversations
 * handler must bump it to the conversation's `createdAt` before recomputing,
 * otherwise `unreadCount` freezes at 0 for every channel the user has viewed.
 */

jest.mock('@xyne/shared', () => ({
  ChannelScopeType: { DM: 'DM', GROUP_DM: 'GROUP_DM' },
}));

jest.mock('@/zero/utils/unreadCountUtlis', () => ({
  handleUnreadCount: jest.fn(),
}));

jest.mock('@/database/client', () => ({
  db: {
    conversation: {
      findUnique: jest.fn(),
    },
    channel: {
      findUnique: jest.fn(),
    },
    channelParticipant: {
      findMany: jest.fn(),
    },
    channelStats: {
      updateMany: jest.fn(),
    },
  },
}));

import { db } from '@/database/client';
import { handleUnreadCount } from '@/zero/utils/unreadCountUtlis';
import { ConversationsSideEffectHandler } from './conversations-handler';

// The jest.mock factory above replaces `db` with bare jest.fn()s, so the
// Prisma-derived types no longer apply — cast to a minimal hand-rolled shape.
const mockedDb = db as unknown as {
  conversation: { findUnique: jest.Mock };
  channel: { findUnique: jest.Mock };
  channelParticipant: { findMany: jest.Mock };
  channelStats: { updateMany: jest.Mock };
};
const mockedHandleUnreadCount = handleUnreadCount as jest.Mock;

const CONVERSATION_ID = 'conv-1';
const CHANNEL_ID = 'chan-1';
const CREATED_AT = new Date('2026-01-02T00:00:00Z');

const makeHandler = () =>
  new ConversationsSideEffectHandler({
    userID: 'user-1',
    workspaceId: 'ws-1',
    role: 'member',
    orgRole: 'member',
    memberId: 'member-1',
  });

describe('ConversationsSideEffectHandler.onInsert (frozen-counter fix)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedDb.conversation.findUnique.mockResolvedValue({
      channelId: CHANNEL_ID,
      createdBy: 'user-sender',
      createdAt: CREATED_AT,
    } as never);
    mockedDb.channel.findUnique.mockResolvedValue({
      scopeType: 'DM',
    } as never);
    mockedDb.channelParticipant.findMany.mockResolvedValue([
      { userId: 'user-recipient' },
    ] as never);
    mockedDb.channelStats.updateMany.mockResolvedValue({ count: 1 } as never);
    mockedHandleUnreadCount.mockResolvedValue(undefined);
  });

  it('bumps channel_stats.lastActivityAt to the conversation createdAt before recomputing', async () => {
    await makeHandler().onInsert({ entityId: CONVERSATION_ID } as never);

    expect(mockedDb.channelStats.updateMany).toHaveBeenCalledTimes(1);
    expect(mockedDb.channelStats.updateMany).toHaveBeenCalledWith({
      where: {
        channelId: CHANNEL_ID,
        lastActivityAt: { lt: CREATED_AT },
      },
      data: { lastActivityAt: CREATED_AT },
    });
    expect(mockedHandleUnreadCount).toHaveBeenCalledTimes(1);
  });

  it('bumps before recomputing (call order matters — the recompute guard reads the bump)', async () => {
    await makeHandler().onInsert({ entityId: CONVERSATION_ID } as never);

    const bumpOrder = mockedDb.channelStats.updateMany.mock.invocationCallOrder[0];
    const recomputeOrder = mockedHandleUnreadCount.mock.invocationCallOrder[0];
    expect(bumpOrder).toBeDefined();
    expect(recomputeOrder).toBeDefined();
    expect(bumpOrder).toBeLessThan(recomputeOrder);
  });

  it('bumps lastActivityAt even for GROUP_DM channels', async () => {
    mockedDb.channel.findUnique.mockResolvedValue({
      scopeType: 'GROUP_DM',
    } as never);

    await makeHandler().onInsert({ entityId: CONVERSATION_ID } as never);

    expect(mockedDb.channelStats.updateMany).toHaveBeenCalledTimes(1);
    expect(mockedHandleUnreadCount).toHaveBeenCalledTimes(1);
  });

  it('still calls handleUnreadCount once with the expected arguments', async () => {
    await makeHandler().onInsert({ entityId: CONVERSATION_ID } as never);

    expect(mockedHandleUnreadCount).toHaveBeenCalledWith(
      CHANNEL_ID,
      true,
      [{ userId: 'user-recipient' }],
      'user-sender',
    );
  });

  it('does not recompute for non-DM channels (messages handler owns those)', async () => {
    mockedDb.channel.findUnique.mockResolvedValue({
      scopeType: 'PUBLIC',
    } as never);

    await makeHandler().onInsert({ entityId: CONVERSATION_ID } as never);

    expect(mockedDb.channelStats.updateMany).not.toHaveBeenCalled();
    expect(mockedHandleUnreadCount).not.toHaveBeenCalled();
  });

  it('does not recompute when the conversation no longer exists', async () => {
    mockedDb.conversation.findUnique.mockResolvedValue(null);

    await makeHandler().onInsert({ entityId: CONVERSATION_ID } as never);

    expect(mockedDb.channelStats.updateMany).not.toHaveBeenCalled();
    expect(mockedHandleUnreadCount).not.toHaveBeenCalled();
  });
});
