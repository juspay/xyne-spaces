const dbMock = { poll: { findUnique: jest.fn(), findMany: jest.fn() } };
const asSystemMock = jest.fn((_tables: string[], _reason: string, fn: () => unknown) => fn());
const asServiceMock = jest.fn(
  (_tables: string[], _reason: string, _userId: string, _workspaceId: string, fn: () => unknown) => fn()
);

jest.mock('@/database/client', () => ({ db: dbMock }));
jest.mock('./base', () => ({ asSystem: asSystemMock, asService: asServiceMock }));

import { findPollsWithPendingLifecycle, runInPollWorkspace } from './pollLifecycleServices';

beforeEach(() => jest.clearAllMocks());

describe('pollLifecycleServices', () => {
  it('scans pending polls across workspaces as a declared system bypass', async () => {
    dbMock.poll.findMany.mockResolvedValue([]);
    await findPollsWithPendingLifecycle();
    expect(asSystemMock).toHaveBeenCalledWith(['Poll'], expect.any(String), expect.any(Function));
    expect(dbMock.poll.findMany).toHaveBeenCalledWith({
      where: { closedAt: null, OR: [{ closesAt: { not: null } }, { remindAt: { not: null } }] },
      select: { id: true, closesAt: true, remindAt: true },
    });
  });

  it("runs the job as a service actor bound to the poll's workspace", async () => {
    dbMock.poll.findUnique.mockResolvedValue({ workspaceId: 'workspace-1' });
    const job = jest.fn().mockResolvedValue(undefined);
    await runInPollWorkspace('poll-1', job);
    expect(asServiceMock).toHaveBeenCalledWith(
      expect.arrayContaining(['Poll', 'PollVote']),
      expect.any(String),
      'system:poll-lifecycle',
      'workspace-1',
      job
    );
    expect(job).toHaveBeenCalledTimes(1);
  });

  it('skips the job when the poll was deleted', async () => {
    dbMock.poll.findUnique.mockResolvedValue(null);
    const job = jest.fn();
    await runInPollWorkspace('gone', job);
    expect(asServiceMock).not.toHaveBeenCalled();
    expect(job).not.toHaveBeenCalled();
  });
});
