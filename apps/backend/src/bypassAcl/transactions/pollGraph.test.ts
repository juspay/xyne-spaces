import { buildPollLifecycleJobs, upsertPollLifecycleJobs } from './pollGraph';

const schedule = {
  publishAt: null,
  closeAt: '2026-10-06T12:30:00.000Z',
  remindAt: '2026-10-06T12:10:00.000Z',
};

describe('poll lifecycle graph', () => {
  it('builds deterministic close and reminder jobs', () => {
    expect(buildPollLifecycleJobs('poll-1', schedule, 'workspace-1', 1000)).toEqual([
      expect.objectContaining({
        id: 'poll-1:CLOSE',
        pollId: 'poll-1',
        workspaceId: 'workspace-1',
        kind: 'CLOSE',
        status: 'PENDING',
        maxAttempts: 5,
      }),
      expect.objectContaining({
        id: 'poll-1:REMINDER',
        pollId: 'poll-1',
        workspaceId: 'workspace-1',
        kind: 'REMINDER',
        status: 'PENDING',
      }),
    ]);
  });

  it('upserts persisted lifecycle times only for the creating actor and workspace', async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const client = {
      poll: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'poll-1',
          workspaceId: 'workspace-1',
          createdBy: 'user-1',
          message: { senderId: 'user-1' },
        }),
      },
      pollJob: { upsert },
    };

    await upsertPollLifecycleJobs(
      'poll-1',
      schedule,
      { userID: 'user-1', workspaceId: 'workspace-1' },
      client
    );

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pollId_kind: { pollId: 'poll-1', kind: 'CLOSE' } },
      })
    );
  });

  it('rejects cross-workspace lifecycle synchronization', async () => {
    const client = {
      poll: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'poll-1',
          workspaceId: 'workspace-2',
          createdBy: 'user-1',
          message: { senderId: 'user-1' },
        }),
      },
      pollJob: { upsert: jest.fn() },
    };

    await expect(
      upsertPollLifecycleJobs(
        'poll-1',
        schedule,
        { userID: 'user-1', workspaceId: 'workspace-1' },
        client
      )
    ).rejects.toThrow('not authorized');
  });
});
