const admissionMock = {
  release: jest.fn(),
  renew: jest.fn(),
};
const cancelRunMock = jest.fn();
const inspectPullRequestMock = jest.fn();
const markMergedPrMock = jest.fn();
const markDeclinedPrMock = jest.fn();
const countPRsForTicketMock = jest.fn();
const syncTicketStatusOnPRChangeMock = jest.fn();

jest.mock('@xyne/shared', () => ({
  PRStatus: { OPEN: 'OPEN', UPDATED: 'UPDATED', MERGED: 'MERGED' },
  PRStatusEvent: { MERGED: 'MERGED' },
  TicketStatusV2: { STARTED: 'STARTED' },
}));
jest.mock('../../src/config/env', () => ({
  config: {
    sdlcCapacityWaitTimeoutMs: 24 * 60 * 60 * 1000,
    sdlcClawRunTimeoutMs: 3 * 60 * 60 * 1000,
  },
}));
jest.mock('../../src/database/client', () => ({
  DatabaseClient: { getInstance: jest.fn(() => ({})) },
}));
jest.mock('../../src/database/repositories/pullRequestsRepository', () => ({
  PRMetricsRepository: jest.fn().mockImplementation(() => ({
    countPRsForTicket: countPRsForTicketMock,
    markDeclinedPr: markDeclinedPrMock,
    markMergedPr: markMergedPrMock,
  })),
}));
jest.mock('../../src/queues/sdlcAdmission', () => ({ sdlcAdmission: admissionMock }));
jest.mock('../../src/queues/sdlcQueue', () => ({ sdlcQueue: {} }));
jest.mock('../../src/services/clawAgentService', () => ({
  cancelS2SClawRun: (...args: unknown[]) => cancelRunMock(...args),
  getS2SClawRunStatus: jest.fn(),
  runS2SClawAgent: jest.fn(),
}));
jest.mock('../../src/services/prTicketStatusSyncService', () => ({
  prTicketStatusSyncService: {
    syncTicketStatusOnPRChange: syncTicketStatusOnPRChangeMock,
  },
}));
jest.mock('../../src/sdlc/baselineDefinitions', () => ({ BASELINE_DEFINITIONS: [] }));
jest.mock('../../src/sdlc/SdlcAgentContextService', () => ({ sdlcAgentContext: {} }));
jest.mock('../../src/sdlc/vcs', () => ({
  sdlcVcs: { inspectPullRequest: (...args: unknown[]) => inspectPullRequestMock(...args) },
}));
jest.mock('../../src/utils/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

import { SdlcClawExecutionService } from '../../src/sdlc/SdlcClawExecutionService';

describe('SdlcClawExecutionService reconciliation deadlines', () => {
  const now = Date.parse('2026-08-18T00:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    cancelRunMock.mockResolvedValue({ success: true, status: 'cancelled' });
    jest.spyOn(Date, 'now').mockReturnValue(now);
  });

  afterEach(() => jest.restoreAllMocks());

  it('keeps a capacity-blocked pending execution alive past the old ten-minute cutoff', async () => {
    const prisma = {
      pullRequests: { findMany: jest.fn().mockResolvedValue([]) },
      workflowExecution: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'execution-1',
            workflowId: 'workflow-1',
            workflowType: 'SDLC_WORK',
            status: 'PENDING',
            createdBy: 'user-1',
            context: JSON.stringify({ repoId: 'repo-1', phase: 'QUEUED' }),
            updatedAt: new Date(now - 11 * 60 * 1000),
          },
        ]),
      },
      $transaction: jest.fn(),
    };

    await new SdlcClawExecutionService(prisma as never).reconcileExecutions();

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('fails a pending execution at the configured capacity limit', async () => {
    const context = JSON.stringify({ repoId: 'repo-1', phase: 'QUEUED' });
    const tx = {
      workflowExecution: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      workflow: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      pullRequests: { findMany: jest.fn().mockResolvedValue([]) },
      workflowExecution: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'execution-1',
            workflowId: 'workflow-1',
            workflowType: 'SDLC_WORK',
            status: 'PENDING',
            createdBy: 'user-1',
            context,
            updatedAt: new Date(now - 24 * 60 * 60 * 1000),
          },
        ]),
        findUnique: jest.fn().mockResolvedValue({ context }),
      },
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    };

    await new SdlcClawExecutionService(prisma as never).reconcileExecutions();

    expect(tx.workflowExecution.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'execution-1' }),
        data: expect.objectContaining({ status: 'FAILURE' }),
      })
    );
    expect(tx.workflow.update).toHaveBeenCalledWith({
      where: { id: 'workflow-1' },
      data: { status: 'FAILURE' },
    });
  });

  it('cancels and classifies an expired running Claw execution', async () => {
    const context = JSON.stringify({
      repoId: 'repo-1',
      phase: 'GENERATING',
      sessionId: 'session-1',
      admissionPermitId: 'permit-1',
      clawRunStartedAt: new Date(now - 4 * 60 * 60 * 1000).toISOString(),
      clawRunDeadlineAt: new Date(now - 60_000).toISOString(),
    });
    const tx = {
      workflowExecution: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      workflow: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      pullRequests: { findMany: jest.fn().mockResolvedValue([]) },
      workflowExecution: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'execution-1',
            workflowId: 'workflow-1',
            workflowType: 'SDLC_WORK',
            status: 'RUNNING',
            createdBy: 'user-1',
            context,
            updatedAt: new Date(now - 3 * 60 * 1000),
          },
        ]),
      },
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    };

    await new SdlcClawExecutionService(prisma as never).reconcileExecutions();

    expect(cancelRunMock).toHaveBeenCalledWith('session-1', 'user-1');
    expect(tx.workflowExecution.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'execution-1', context }),
        data: expect.objectContaining({
          status: 'FAILURE',
          context: expect.stringContaining('CLAW_RUN_TIMED_OUT'),
          output: expect.stringContaining('configured execution limit'),
        }),
      })
    );
    expect(admissionMock.release).toHaveBeenCalledWith('permit-1');
    expect(admissionMock.renew).not.toHaveBeenCalled();
  });

  it('routes reconciled PR merges through the board-aware ticket sync service', async () => {
    inspectPullRequestMock.mockResolvedValue({ state: 'MERGED', numberOfComments: 4 });
    markMergedPrMock.mockResolvedValue({
      pr: { ticketId: 'ticket-1' },
      statusChanged: true,
      previousStatus: 'OPEN',
    });
    countPRsForTicketMock.mockResolvedValue(0);
    const prisma = {
      pullRequests: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'pull-request-1',
            prId: 42,
            prUrl: 'https://github.com/acme/repo/pull/42',
            repositoryUrl: 'https://github.com/acme/repo',
            ticketId: 'ticket-1',
          },
        ]),
      },
      sdlcEntityLink: {
        findMany: jest.fn().mockResolvedValue([{ targetId: 'pull-request-1', repoId: 'repo-1' }]),
      },
      workflowExecution: { findMany: jest.fn().mockResolvedValue([]) },
    };

    await new SdlcClawExecutionService(prisma as never).reconcileExecutions();

    expect(markMergedPrMock).toHaveBeenCalledWith({
      prId: 42,
      repoUrl: 'https://github.com/acme/repo',
      prUrl: 'https://github.com/acme/repo/pull/42',
      numberOfComments: 4,
    });
    expect(countPRsForTicketMock).toHaveBeenCalledWith(
      'ticket-1',
      42,
      'https://github.com/acme/repo/pull/42',
      ['OPEN', 'UPDATED']
    );
    expect(syncTicketStatusOnPRChangeMock).toHaveBeenCalledWith({
      prId: 42,
      prUrl: 'https://github.com/acme/repo/pull/42',
      newStatus: 'MERGED',
      prEvent: 'MERGED',
      remainingOpenPRs: 0,
    });
  });
});
