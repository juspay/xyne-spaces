jest.mock('@xyne/shared', () => ({
  NotificationType: { CHANNEL_MESSAGE: 'CHANNEL_MESSAGE' },
}));

const dbMock = {
  pollJob: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    updateMany: jest.fn(),
  },
  poll: { updateMany: jest.fn() },
  channelParticipant: { findMany: jest.fn() },
  pollVote: { findMany: jest.fn() },
  pollReminderDelivery: {
    createMany: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  },
};

const createNotificationMock = jest.fn();
const filterUsersMock = jest.fn();

jest.mock('@/database/client', () => ({ db: dbMock }));
jest.mock('@/services/notificationService', () => ({
  notificationService: { createNotification: createNotificationMock },
}));
jest.mock('@/services/notificationFilterService', () => ({
  filterUsers: filterUsersMock,
}));

import { processClaimablePollJobs, processPollLifecycleJob } from './pollLifecycleWorker';

const now = new Date('2026-10-06T12:10:00.000Z');

function reminderJob(pollOverrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    pollId: 'poll-1',
    kind: 'REMINDER',
    attempts: 1,
    maxAttempts: 5,
    poll: {
      id: 'poll-1',
      workspaceId: 'workspace-1',
      createdBy: 'creator-1',
      messageId: 'message-1',
      closedAt: null,
      message: {
        isDeleted: false,
        createdAt: new Date('2026-10-06T12:00:00.000Z'),
        conversation: { channelId: 'channel-1' },
      },
      ...pollOverrides,
    },
  };
}

function claimableJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    status: 'PENDING',
    runAt: now,
    attempts: 0,
    maxAttempts: 5,
    leaseExpiresAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  dbMock.pollJob.findUnique.mockResolvedValue(claimableJob());
  dbMock.pollJob.updateMany.mockResolvedValue({ count: 1 });
  dbMock.pollJob.findUniqueOrThrow.mockResolvedValue(reminderJob());
  dbMock.pollJob.updateMany.mockResolvedValue({ count: 1 });
  dbMock.pollReminderDelivery.createMany.mockResolvedValue({ count: 1 });
  dbMock.pollReminderDelivery.updateMany.mockResolvedValue({ count: 0 });
  dbMock.pollReminderDelivery.update.mockResolvedValue(undefined);
  dbMock.channelParticipant.findMany.mockResolvedValue([{ userId: 'user-1' }]);
  dbMock.pollVote.findMany.mockResolvedValue([]);
  filterUsersMock.mockResolvedValue({ desktopUsers: ['user-1'], mobileUsers: [] });
  createNotificationMock.mockResolvedValue(undefined);
});

describe('poll lifecycle worker', () => {
  it('scans only due pending or expired-lease jobs in a bounded batch', async () => {
    dbMock.pollJob.findMany.mockResolvedValue([{ id: 'job-1' }]);

    await processClaimablePollJobs(now, 'worker-1');

    expect(dbMock.pollJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 100,
        where: expect.objectContaining({ runAt: { lte: now } }),
      })
    );
    expect(dbMock.pollJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'RUNNING',
          leaseOwner: 'worker-1',
          leaseExpiresAt: new Date(now.getTime() + 5 * 60_000),
        }),
      })
    );
  });

  it('reclaims an expired RUNNING lease', async () => {
    dbMock.pollJob.findUnique.mockResolvedValue(
      claimableJob({
        status: 'RUNNING',
        leaseExpiresAt: new Date(now.getTime() - 1),
      })
    );

    await processPollLifecycleJob({ pollJobId: 'job-1' }, now, 'worker-2');

    expect(dbMock.pollJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'job-1', attempts: 0 }),
        data: expect.objectContaining({ leaseOwner: 'worker-2' }),
      })
    );
  });

  it('skips reminders for manually closed polls', async () => {
    dbMock.pollJob.findUniqueOrThrow.mockResolvedValue(
      reminderJob({ closedAt: new Date('2026-10-06T12:05:00.000Z') })
    );

    await processPollLifecycleJob({ pollJobId: 'job-1' }, now, 'worker-1');

    expect(createNotificationMock).not.toHaveBeenCalled();
    expect(dbMock.pollJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETED', leaseOwner: null }),
      })
    );
  });

  it('honors notification preferences before delivering reminders', async () => {
    filterUsersMock.mockResolvedValue({ desktopUsers: [], mobileUsers: [] });

    await processPollLifecycleJob({ pollJobId: 'job-1' }, now, 'worker-1');

    expect(filterUsersMock).toHaveBeenCalledWith(
      ['user-1'],
      'channel-1',
      false,
      'channel_message',
      { notificationType: 'CHANNEL_MESSAGE' }
    );
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it('does not resend an existing recipient ledger', async () => {
    dbMock.pollReminderDelivery.createMany.mockResolvedValue({ count: 0 });

    await processPollLifecycleJob({ pollJobId: 'job-1' }, now, 'worker-1');

    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it('retries a recipient whose previous delivery failed', async () => {
    dbMock.pollReminderDelivery.createMany.mockResolvedValue({ count: 0 });
    dbMock.pollReminderDelivery.updateMany.mockResolvedValue({ count: 1 });

    await processPollLifecycleJob({ pollJobId: 'job-1' }, now, 'worker-1');

    expect(dbMock.pollReminderDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'job-1:user-1', status: 'FAILED' }),
      })
    );
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
  });

  it('marks a job FAILED after its final attempt', async () => {
    dbMock.pollJob.findUnique.mockResolvedValue(claimableJob({ attempts: 4, maxAttempts: 5 }));
    dbMock.pollJob.findUniqueOrThrow.mockRejectedValue(new Error('boom'));

    await expect(processPollLifecycleJob({ pollJobId: 'job-1' }, now, 'worker-1')).rejects.toThrow(
      'boom'
    );

    expect(dbMock.pollJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', failedAt: now, leaseOwner: null }),
      })
    );
  });
});
