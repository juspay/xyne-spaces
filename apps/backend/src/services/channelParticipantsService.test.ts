jest.mock('@/database/client', () => ({
  db: {
    channel: { findFirst: jest.fn() },
    channelParticipant: { findFirst: jest.fn(), findMany: jest.fn() },
    user: { findMany: jest.fn() },
  },
}));
const mockAddBatch = jest.fn();
jest.mock('@/database/repositories/channelParticipantRepository', () => ({
  ChannelParticipantRepository: jest
    .fn()
    .mockImplementation(() => ({ addParticipantsBatch: mockAddBatch })),
}));
jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));
// @xyne/shared ships ESM that jest's transform ignores — stub what the service uses.
jest.mock('@xyne/shared', () => ({
  ChannelRole: { ADMIN: 'ADMIN', MEMBER: 'MEMBER' },
  ChannelScopeType: { DEFAULT: 'DEFAULT', DM: 'DM', GROUP_DM: 'GROUP_DM' },
  ChannelAddUserPolicy: { EVERYONE: 'EVERYONE', ADMINS_ONLY: 'ADMINS_ONLY' },
  UserStatus: { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE' },
}));

import { ChannelRole } from '@xyne/shared';
import { db } from '@/database/client';
import { addChannelParticipants } from './channelParticipantsService';

const mdb = db as unknown as {
  channel: { findFirst: jest.Mock };
  channelParticipant: { findFirst: jest.Mock; findMany: jest.Mock };
  user: { findMany: jest.Mock };
};

const channel = (over: Record<string, unknown> = {}) => ({
  id: 'ch1',
  workspaceId: 'ws1',
  scopeType: 'DEFAULT',
  isArchived: false,
  channelStats: { addUserPolicy: 'EVERYONE' },
  ...over,
});
const user = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: id,
  displayName: null,
  role: 'MEMBER',
  status: 'ACTIVE',
  leftAt: null,
  ...over,
});
const params = (over: Record<string, unknown> = {}) => ({
  channelId: 'ch1',
  actorId: 'actor',
  actorWorkspaceRole: 'MEMBER',
  workspaceId: 'ws1',
  userIds: ['u1'],
  role: ChannelRole.MEMBER,
  ...over,
});

describe('addChannelParticipants', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mdb.channel.findFirst.mockResolvedValue(channel());
    mdb.user.findMany.mockResolvedValue([user('u1')]);
    // 1st call: actor lookup (findFirst); findMany: existing members, then created rows.
    mdb.channelParticipant.findFirst.mockResolvedValue({ role: 'MEMBER' });
    mdb.channelParticipant.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'p1', userId: 'u1' }]);
  });

  it('adds new users and returns their participant ids', async () => {
    const result = await addChannelParticipants(params());
    expect(mockAddBatch).toHaveBeenCalledWith('ch1', ['u1'], 'MEMBER');
    expect(result.added).toEqual([{ userId: 'u1', userName: 'u1', participantId: 'p1' }]);
  });

  it('looks the channel up inside the caller workspace only', async () => {
    await addChannelParticipants(params());
    expect(mdb.channel.findFirst.mock.calls[0][0].where).toEqual({ id: 'ch1', workspaceId: 'ws1' });
  });

  it('404s a channel from another workspace', async () => {
    mdb.channel.findFirst.mockResolvedValue(null);
    await expect(addChannelParticipants(params())).rejects.toMatchObject({ statusCode: 404 });
    expect(mockAddBatch).not.toHaveBeenCalled();
  });

  it('rejects a user from another workspace and adds nobody', async () => {
    mdb.user.findMany.mockResolvedValue([]);
    await expect(addChannelParticipants(params())).rejects.toMatchObject({ statusCode: 400 });
    expect(mdb.user.findMany.mock.calls[0][0].where).toEqual({
      id: { in: ['u1'] },
      workspaceId: 'ws1',
    });
    expect(mockAddBatch).not.toHaveBeenCalled();
  });

  it('rejects the whole request when only some users are in the workspace', async () => {
    mdb.user.findMany.mockResolvedValue([user('u1')]);
    await expect(
      addChannelParticipants(params({ userIds: ['u1', 'foreign'] }))
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('foreign'),
    });
    expect(mockAddBatch).not.toHaveBeenCalled();
  });

  it.each([
    ['inactive', { status: 'INACTIVE' }],
    ['departed', { leftAt: new Date() }],
    ['guest', { role: 'GUEST' }],
  ])('rejects a %s user', async (_label, over) => {
    mdb.user.findMany.mockResolvedValue([user('u1', over)]);
    await expect(addChannelParticipants(params())).rejects.toMatchObject({ statusCode: 400 });
    expect(mockAddBatch).not.toHaveBeenCalled();
  });

  it('rejects a guest caller', async () => {
    await expect(
      addChannelParticipants(params({ actorWorkspaceRole: 'GUEST' }))
    ).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('rejects a caller who is not in the channel', async () => {
    mdb.channelParticipant.findFirst.mockResolvedValue(null);
    await expect(addChannelParticipants(params())).rejects.toMatchObject({ statusCode: 403 });
    expect(mockAddBatch).not.toHaveBeenCalled();
  });

  it('enforces the ADMINS_ONLY policy from channel_stats for members', async () => {
    mdb.channel.findFirst.mockResolvedValue(
      channel({ channelStats: { addUserPolicy: 'ADMINS_ONLY' } })
    );
    await expect(addChannelParticipants(params())).rejects.toMatchObject({ statusCode: 403 });
    expect(mockAddBatch).not.toHaveBeenCalled();
  });

  it('lets a channel admin add under ADMINS_ONLY', async () => {
    mdb.channel.findFirst.mockResolvedValue(
      channel({ channelStats: { addUserPolicy: 'ADMINS_ONLY' } })
    );
    mdb.channelParticipant.findFirst.mockResolvedValue({ role: 'ADMIN' });
    await expect(addChannelParticipants(params())).resolves.toMatchObject({
      added: [{ userId: 'u1' }],
    });
  });

  it('only lets admins add admins', async () => {
    await expect(addChannelParticipants(params({ role: ChannelRole.ADMIN }))).rejects.toMatchObject(
      {
        statusCode: 403,
      }
    );
  });

  it.each([['DM'], ['GROUP_DM']])('rejects %s channels', async (scopeType) => {
    mdb.channel.findFirst.mockResolvedValue(channel({ scopeType }));
    await expect(addChannelParticipants(params())).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects archived channels', async () => {
    mdb.channel.findFirst.mockResolvedValue(channel({ isArchived: true }));
    await expect(addChannelParticipants(params())).rejects.toMatchObject({ statusCode: 400 });
  });

  it('is idempotent for users who are already members', async () => {
    mdb.channelParticipant.findMany.mockReset();
    mdb.channelParticipant.findMany.mockResolvedValueOnce([{ userId: 'u1' }]);
    const result = await addChannelParticipants(params());
    expect(result).toEqual({ added: [], alreadyMembers: ['u1'] });
    expect(mockAddBatch).not.toHaveBeenCalled();
  });

  it('de-duplicates requested user ids', async () => {
    await addChannelParticipants(params({ userIds: ['u1', 'u1'] }));
    expect(mockAddBatch).toHaveBeenCalledWith('ch1', ['u1'], 'MEMBER');
  });
});
