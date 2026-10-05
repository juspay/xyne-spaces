jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
// @xyne/shared's root barrel is ESM — stub the enum this trigger reads.
jest.mock('@xyne/shared', () => ({
  ChannelScopeType: { DEFAULT: 'DEFAULT', DM: 'DM', TICKET: 'TICKET', DOCUMENT: 'DOCUMENT', GROUP_DM: 'GROUP_DM' },
}));
jest.mock('@/events/emitDomainEvent', () => ({ emitDomainEvent: jest.fn() }));
jest.mock('@/database/client', () => ({
  db: { channel: { findUnique: jest.fn() } },
}));

import { emitDomainEvent } from '@/events/emitDomainEvent';
import { db } from '@/database/client';
import {
  emitUserJoinedChannel,
  matchUserJoinedChannel,
  resolveJoinMethod,
  USER_JOINED_CHANNEL_EVENT,
  UserJoinMethod,
} from './user-joined-channel.trigger';

const findChannel = db.channel.findUnique as unknown as jest.Mock;
const emit = emitDomainEvent as unknown as jest.Mock;

const OLD = new Date(Date.now() - 24 * 60 * 60 * 1000);

describe('resolveJoinMethod', () => {
  it('treats a self insert as SELF_JOINED', () => {
    expect(resolveJoinMethod({ channelId: 'c', userId: 'u', actorId: 'u' })).toBe(UserJoinMethod.SELF_JOINED);
    expect(resolveJoinMethod({ channelId: 'c', userId: 'u' })).toBe(UserJoinMethod.SELF_JOINED);
  });
  it('treats another actor as ADDED_BY_MEMBER', () => {
    expect(resolveJoinMethod({ channelId: 'c', userId: 'u', actorId: 'a' })).toBe(UserJoinMethod.ADDED_BY_MEMBER);
  });
  it('autoJoined wins', () => {
    expect(resolveJoinMethod({ channelId: 'c', userId: 'u', actorId: 'a', autoJoined: true })).toBe(
      UserJoinMethod.AUTO_JOINED,
    );
  });
});

describe('matchUserJoinedChannel', () => {
  const p = { channelId: 'c1', userId: 'u1', joinMethod: UserJoinMethod.SELF_JOINED };
  it('matches everything with an empty config', () => {
    expect(matchUserJoinedChannel({}, p)).toEqual({ matched: true });
  });
  it('filters by channel, user and join method', () => {
    expect(matchUserJoinedChannel({ channelIds: ['c2'] }, p)).toEqual({ matched: false, failed: 'channelIds' });
    expect(matchUserJoinedChannel({ userIds: ['u2'] }, p)).toEqual({ matched: false, failed: 'userIds' });
    expect(matchUserJoinedChannel({ joinMethods: [UserJoinMethod.AUTO_JOINED] }, p)).toEqual({
      matched: false,
      failed: 'joinMethods',
    });
    expect(
      matchUserJoinedChannel({ channelIds: ['c1'], userIds: ['u1'], joinMethods: [UserJoinMethod.SELF_JOINED] }, p),
    ).toEqual({ matched: true });
  });
  it('drops a membership that was removed before the run', () => {
    expect(matchUserJoinedChannel({}, { ...p, removed: true })).toEqual({ matched: false, failed: 'removed' });
  });
});

describe('emitUserJoinedChannel', () => {
  beforeEach(() => jest.clearAllMocks());

  it('emits for a regular channel with the resolved join method', async () => {
    findChannel.mockResolvedValue({ workspaceId: 'w1', scopeType: 'DEFAULT', createdBy: 'x', createdAt: OLD });
    await emitUserJoinedChannel({ channelId: 'c1', userId: 'u1', actorId: 'a1' });
    expect(emit).toHaveBeenCalledWith(
      {
        type: USER_JOINED_CHANNEL_EVENT,
        payload: { channelId: 'c1', userId: 'u1', addedById: 'a1', joinMethod: UserJoinMethod.ADDED_BY_MEMBER },
      },
      'w1',
    );
  });

  it.each(['DM', 'GROUP_DM', 'TICKET', 'DOCUMENT'])('skips %s channels', async scopeType => {
    findChannel.mockResolvedValue({ workspaceId: 'w1', scopeType, createdBy: 'x', createdAt: OLD });
    await emitUserJoinedChannel({ channelId: 'c1', userId: 'u1', actorId: 'u1' });
    expect(emit).not.toHaveBeenCalled();
  });

  it("skips the creator's own row on a freshly created channel", async () => {
    findChannel.mockResolvedValue({ workspaceId: 'w1', scopeType: 'DEFAULT', createdBy: 'u1', createdAt: new Date() });
    await emitUserJoinedChannel({ channelId: 'c1', userId: 'u1', actorId: 'u1' });
    expect(emit).not.toHaveBeenCalled();
  });

  it('never throws when the emit fails', async () => {
    findChannel.mockResolvedValue({ workspaceId: 'w1', scopeType: 'DEFAULT', createdBy: 'x', createdAt: OLD });
    emit.mockRejectedValueOnce(new Error('boom'));
    await expect(emitUserJoinedChannel({ channelId: 'c1', userId: 'u1' })).resolves.toBeUndefined();
  });
});
