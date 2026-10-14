jest.mock('@xyne/shared', () => ({
  ChannelScopeType: { DM: 'DM', GROUP_DM: 'GROUP_DM' },
  NotificationType: { CHANNEL_MESSAGE: 'CHANNEL_MESSAGE' },
}));

const dbMock = {
  poll: { findUnique: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
  channelParticipant: { findMany: jest.fn() },
  pollVote: { findMany: jest.fn() },
};
const queueMock = {
  add: jest.fn(),
  process: jest.fn(),
  on: jest.fn(),
  close: jest.fn(),
};
const createNotificationMock = jest.fn();
const filterUsersMock = jest.fn();

jest.mock('bull', () => jest.fn(() => queueMock));
jest.mock('@/database/client', () => ({ db: dbMock }));
jest.mock('@/services/redisService', () => ({
  redisService: { getRedisConfig: () => ({}) },
}));
jest.mock('@/services/notificationService', () => ({
  notificationService: { createNotification: createNotificationMock },
}));
jest.mock('@/services/notificationFilterService', () => ({
  filterUsers: filterUsersMock,
}));
jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  closePoll,
  pollLifecycleWorker,
  processPollLifecycleJob,
  remindPollNonVoters,
} from './pollLifecycleWorker';

function reminderPoll(overrides: Record<string, unknown> = {}) {
  return {
    id: 'poll-1',
    workspaceId: 'workspace-1',
    createdBy: 'creator-1',
    messageId: 'message-1',
    remindAt: new Date('2026-10-14T12:30:00.000Z'),
    closedAt: null,
    message: {
      isDeleted: false,
      conversation: { channel: { id: 'channel-1', scopeType: 'DEFAULT' } },
    },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  dbMock.poll.findUnique.mockResolvedValue(reminderPoll());
  dbMock.poll.updateMany.mockResolvedValue({ count: 1 });
  dbMock.channelParticipant.findMany.mockResolvedValue([
    { userId: 'creator-1' },
    { userId: 'voter-1' },
    { userId: 'user-1' },
    { userId: 'user-2' },
  ]);
  dbMock.pollVote.findMany.mockResolvedValue([{ userId: 'voter-1' }]);
  filterUsersMock.mockResolvedValue({ desktopUsers: ['user-1'], mobileUsers: ['user-1', 'user-2'] });
  createNotificationMock.mockResolvedValue(undefined);
});

describe('closePoll', () => {
  it('closes only a poll that is still open', async () => {
    const now = new Date('2026-10-14T13:00:00.000Z');

    await closePoll('poll-1', now);

    expect(dbMock.poll.updateMany).toHaveBeenCalledWith({
      where: { id: 'poll-1', closedAt: null },
      data: { closedAt: now },
    });
  });
});

describe('remindPollNonVoters', () => {
  it('filters every non-voter in one call, claims the reminder, then notifies', async () => {
    await remindPollNonVoters('poll-1');

    expect(filterUsersMock).toHaveBeenCalledTimes(1);
    expect(filterUsersMock).toHaveBeenCalledWith(
      ['user-1', 'user-2'],
      'channel-1',
      false,
      'channel_message',
      { notificationType: 'CHANNEL_MESSAGE' },
      undefined,
      false,
    );
    expect(dbMock.poll.updateMany).toHaveBeenCalledWith({
      where: { id: 'poll-1', remindAt: { not: null }, closedAt: null },
      data: { remindAt: null },
    });
    expect(createNotificationMock).toHaveBeenCalledTimes(2);
    expect(createNotificationMock).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ relatedEntityId: 'message-1', workspaceId: 'workspace-1' }),
      { sendDesktop: true, sendMobile: true },
    );
    expect(createNotificationMock).toHaveBeenCalledWith('user-2', expect.anything(), {
      sendDesktop: false,
      sendMobile: true,
    });
  });

  it.each([
    ['DM', true, false],
    ['GROUP_DM', false, true],
  ])('passes the DM flags for a %s channel', async (scopeType, isDM, isGroupDM) => {
    dbMock.poll.findUnique.mockResolvedValue(
      reminderPoll({
        message: { isDeleted: false, conversation: { channel: { id: 'channel-1', scopeType } } },
      }),
    );

    await remindPollNonVoters('poll-1');

    const args = filterUsersMock.mock.calls[0];
    expect(args[2]).toBe(isDM);
    expect(args[6]).toBe(isGroupDM);
  });

  it('sends nothing when another run already claimed the reminder', async () => {
    dbMock.poll.updateMany.mockResolvedValue({ count: 0 });

    await remindPollNonVoters('poll-1');

    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it.each([
    ['already reminded', { remindAt: null }],
    ['closed', { closedAt: new Date('2026-10-14T12:00:00.000Z') }],
    [
      'on a deleted message',
      { message: { isDeleted: true, conversation: { channel: { id: 'channel-1', scopeType: 'DEFAULT' } } } },
    ],
  ])('skips a poll that is %s', async (_label, overrides) => {
    dbMock.poll.findUnique.mockResolvedValue(reminderPoll(overrides));

    await remindPollNonVoters('poll-1');

    expect(filterUsersMock).not.toHaveBeenCalled();
    expect(dbMock.poll.updateMany).not.toHaveBeenCalled();
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it('does not throw (and so is not retried) when one notification fails', async () => {
    createNotificationMock.mockRejectedValueOnce(new Error('push failed'));

    await expect(remindPollNonVoters('poll-1')).resolves.toBeUndefined();
    expect(createNotificationMock).toHaveBeenCalledTimes(2);
  });
});

describe('processPollLifecycleJob', () => {
  it('routes CLOSE and REMIND jobs', async () => {
    await processPollLifecycleJob({ pollId: 'poll-1', kind: 'CLOSE' });
    expect(dbMock.poll.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'poll-1', closedAt: null } }),
    );

    await processPollLifecycleJob({ pollId: 'poll-1', kind: 'REMIND' });
    expect(filterUsersMock).toHaveBeenCalled();
  });

  it('rejects an unknown kind', async () => {
    await expect(
      processPollLifecycleJob({ pollId: 'poll-1', kind: 'OTHER' as never }),
    ).rejects.toThrow('Unsupported poll lifecycle job kind');
  });
});

describe('pollLifecycleWorker', () => {
  afterEach(async () => {
    await pollLifecycleWorker.shutdown();
  });

  it('registers the Bull processor once and closes the queue on shutdown', async () => {
    await pollLifecycleWorker.start();
    await pollLifecycleWorker.start();
    expect(queueMock.process).toHaveBeenCalledTimes(1);

    await pollLifecycleWorker.shutdown();
    expect(queueMock.close).toHaveBeenCalledTimes(1);
  });

  it('re-enqueues open polls with a pending close or reminder, deduped by jobId', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-14T12:00:00.000Z') });
    dbMock.poll.findMany.mockResolvedValue([
      {
        id: 'poll-1',
        closesAt: new Date('2026-10-14T13:00:00.000Z'),
        remindAt: new Date('2026-10-14T11:00:00.000Z'),
      },
      { id: 'poll-2', closesAt: null, remindAt: new Date('2026-10-14T12:30:00.000Z') },
    ]);

    try {
      await pollLifecycleWorker.reenqueuePendingPolls();
    } finally {
      jest.useRealTimers();
    }

    expect(dbMock.poll.findMany).toHaveBeenCalledWith({
      where: {
        closedAt: null,
        OR: [{ closesAt: { not: null } }, { remindAt: { not: null } }],
      },
      select: { id: true, closesAt: true, remindAt: true },
    });
    expect(queueMock.add.mock.calls).toEqual([
      [{ pollId: 'poll-1', kind: 'CLOSE' }, { jobId: 'poll-close:poll-1', delay: 3_600_000 }],
      [{ pollId: 'poll-1', kind: 'REMIND' }, { jobId: 'poll-remind:poll-1', delay: 0 }],
      [{ pollId: 'poll-2', kind: 'REMIND' }, { jobId: 'poll-remind:poll-2', delay: 1_800_000 }],
    ]);
  });
});
