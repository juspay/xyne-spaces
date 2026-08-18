jest.mock('../../../src/config/env', () => ({
  config: {
    xyneClaw: { callbackUrl: 'https://claw.example', s2sKey: 'test' },
    sdlcClawRunTimeoutMs: 3 * 60 * 60 * 1000,
  },
}));
jest.mock('../../../src/database/client', () => ({
  DatabaseClient: { getInstance: jest.fn() },
}));
jest.mock('../../../src/queues/sdlcAdmission', () => ({
  sdlcAdmission: {
    release: jest.fn(),
    renew: jest.fn(),
    restore: jest.fn(),
  },
}));
jest.mock('../../../src/queues/sdlcQueue', () => ({
  sdlcQueue: { enqueueWiki: jest.fn() },
}));
jest.mock('../../../src/services/clawAgentService', () => ({
  cancelS2SClawRun: jest.fn(),
  getS2SClawRunStatus: jest.fn(),
  runS2SClawAgent: jest.fn(),
}));
jest.mock('../../../src/sdlc/SdlcAgentContextService', () => ({
  sdlcAgentContext: { build: jest.fn() },
}));
jest.mock('../../../src/sdlc/vcs', () => ({
  sdlcVcs: { listBaseBranchFirstParentHistory: jest.fn() },
}));
jest.mock('../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { sdlcAdmission } from '../../../src/queues/sdlcAdmission';
import {
  cancelS2SClawRun,
  getS2SClawRunStatus,
  runS2SClawAgent,
} from '../../../src/services/clawAgentService';
import { sdlcAgentContext } from '../../../src/sdlc/SdlcAgentContextService';
import { sdlcVcs } from '../../../src/sdlc/vcs';
import { SdlcWikiExecutionService } from '../../../src/sdlc/wiki/SdlcWikiExecutionService';
import type { WikiExecutionContext } from '../../../src/sdlc/wiki/wikiRunState';

const SHA = 'a'.repeat(40);

function context(): WikiExecutionContext {
  return {
    version: 1,
    repoId: 'repo-1',
    agentSlug: 'sdlc-agent',
    conversationId: 'conversation-1',
    sessionId: 'session-1',
    credentialSessionId: 'session-1',
    admissionPermitId: 'permit-1',
    clawRunStartedAt: '2026-08-17T00:00:00.000Z',
    clawRunDeadlineAt: '2999-08-17T03:00:00.000Z',
    phase: 'PROCESSING',
    runMode: 'INITIAL',
    historyRange: { kind: 'FULL' },
    chunkSize: 10,
    quality: 'STANDARD',
    baseBranch: 'main',
    targetHeadSha: SHA,
    bootstrapRef: 'ROOT_BOOTSTRAP',
    selectedStartSha: SHA,
    selectedCommitShas: [SHA],
    cursorSha: null,
    assignedChunk: null,
    counts: { total: 1, processed: 0, updated: 0, noop: 0, failed: 0 },
    validatorReports: [],
    error: null,
    errorCode: null,
  };
}

function unpreparedContext(): WikiExecutionContext {
  return {
    ...context(),
    phase: 'QUEUED',
    historyRange: { kind: 'LAST_PERCENT', percent: 20 },
    targetHeadSha: null,
    bootstrapRef: null,
    selectedStartSha: null,
    selectedCommitShas: [],
    counts: { total: 0, processed: 0, updated: 0, noop: 0, failed: 0 },
    sessionId: null,
    credentialSessionId: null,
    admissionPermitId: null,
  };
}

function harness(claims: number[]) {
  const updateMany = jest.fn();
  for (const count of claims) updateMany.mockResolvedValueOnce({ count });
  const workflowUpdate = jest.fn().mockResolvedValue({});
  const tx = {
    workflowExecution: { updateMany },
    workflow: { update: workflowUpdate },
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
  };
  const queue = { enqueueWiki: jest.fn().mockResolvedValue(undefined) };
  const service = new SdlcWikiExecutionService(prisma as never, queue);
  return { service, updateMany, workflowUpdate, queue };
}

type TransitionMethods = {
  requeue(executionId: string, workflowId: string, value: WikiExecutionContext): Promise<void>;
  finish(executionId: string, workflowId: string, value: WikiExecutionContext): Promise<void>;
  fail(
    executionId: string,
    workflowId: string,
    value: WikiExecutionContext,
    error: string
  ): Promise<void>;
};

function transitions(service: SdlcWikiExecutionService): TransitionMethods {
  return service as unknown as TransitionMethods;
}

describe('SdlcWikiExecutionService deterministic preparation', () => {
  it('plans first-parent history in the backend and starts directly at bootstrap', async () => {
    const root = '1'.repeat(40);
    const head = '2'.repeat(40);
    const initial = unpreparedContext();
    const transactionUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      workflowExecution: { updateMany: transactionUpdate },
      workflow: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      workflowExecution: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'execution-1',
          workflowId: 'workflow-1',
          workflow: {},
          status: 'PENDING',
          createdBy: 'user-1',
          context: JSON.stringify(initial),
          output: JSON.stringify({ version: 1, outcomes: [] }),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      repo: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'repo-1',
          name: 'repo',
          channelId: 'channel-1',
          workspaceId: 'workspace-1',
          baseBranch: 'main',
          url: 'https://github.com/example/repo',
        }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          name: 'User',
          email: 'user@example.com',
        }),
      },
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    };
    jest.mocked(sdlcVcs.listBaseBranchFirstParentHistory).mockResolvedValueOnce({
      targetHeadSha: head,
      commits: [
        { sha: root, parentSha: null },
        { sha: head, parentSha: root },
      ],
    });
    jest.mocked(sdlcAgentContext.build).mockResolvedValueOnce({} as never);
    jest.mocked(runS2SClawAgent).mockResolvedValueOnce({} as never);
    const service = new SdlcWikiExecutionService(prisma as never, {
      enqueueWiki: jest.fn(),
    });

    await expect(service.dispatch('execution-1', 'permit-1')).resolves.toBe(true);

    expect(sdlcVcs.listBaseBranchFirstParentHistory).toHaveBeenCalledWith('repo-1');
    expect(runS2SClawAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        sdlcWikiRole: 'BOOTSTRAP_SURVEY',
        task: expect.not.stringContaining('ROLE=PREPARE'),
      })
    );
    const task = jest.mocked(runS2SClawAgent).mock.calls[0]?.[0].task ?? '';
    expect(task).toContain(root.slice(0, 9));
    expect(task).toContain(head.slice(0, 9));
    expect(task).not.toContain(root);
    expect(task).not.toContain(head);
    expect(sdlcAgentContext.build).toHaveBeenCalledWith(
      expect.anything(),
      'repo-1',
      expect.objectContaining({ wikiAssignedCommitShas: [root] })
    );
  });

  it('persists a bounded survey plan before dispatching bootstrap page writes', async () => {
    const bootstrapSha = 'b'.repeat(40);
    const dispatched: WikiExecutionContext = {
      ...context(),
      phase: 'BOOTSTRAPPING',
      bootstrapRef: bootstrapSha,
      assignedChunk: {
        kind: 'BOOTSTRAP_SURVEY',
        conversationId: 'conversation-1',
        sessionId: 'session-1',
        commitShas: [bootstrapSha],
        nextIndex: 0,
      },
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      workflowExecution: { updateMany },
      workflow: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      workflowExecution: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'execution-1',
          workflowId: 'workflow-1',
          workflow: {},
          workspaceId: 'workspace-1',
          status: 'RUNNING',
          createdBy: 'user-1',
          context: JSON.stringify(dispatched),
          output: JSON.stringify({ version: 1, outcomes: [] }),
        }),
      },
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    };
    const queue = { enqueueWiki: jest.fn().mockResolvedValue(undefined) };
    const service = new SdlcWikiExecutionService(prisma as never, queue);

    await service.handleCallback('execution-1', 'BOOTSTRAP_SURVEY', {
      sessionId: 'session-1',
      status: 'completed',
      result: {
        repositorySummary: 'A service repository.',
        pages: [
          {
            path: 'overview.md',
            purpose: 'System entry point',
            concepts: ['System'],
            priority: 'HIGH',
            archetype: 'overview',
            sourceAreas: ['src'],
            relatedPages: [],
            tableCandidates: [],
            diagramCandidates: ['System topology'],
          },
        ],
      },
    });

    const persisted = JSON.parse(updateMany.mock.calls[0][0].data.context) as WikiExecutionContext;
    expect(persisted.bootstrapPlan?.pages[0]).toMatchObject({
      path: 'overview.md',
      archetype: 'overview',
    });
    expect(persisted.bootstrapStage).toBe('PAGE');
    expect(persisted.assignedChunk).toBeNull();
    expect(persisted.sessionId).toBeNull();
    expect(queue.enqueueWiki).toHaveBeenCalledWith('execution-1', 'repo-1');
  });

  it('normalizes and deduplicates bootstrap page paths before dispatch', async () => {
    const bootstrapSha = 'b'.repeat(40);
    const dispatched: WikiExecutionContext = {
      ...context(),
      phase: 'BOOTSTRAPPING',
      bootstrapRef: bootstrapSha,
      assignedChunk: {
        kind: 'BOOTSTRAP_SURVEY',
        conversationId: 'conversation-1',
        sessionId: 'session-1',
        commitShas: [bootstrapSha],
        nextIndex: 0,
      },
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      workflowExecution: { updateMany },
      workflow: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      workflowExecution: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'execution-1',
          workflowId: 'workflow-1',
          workflow: {},
          workspaceId: 'workspace-1',
          status: 'RUNNING',
          createdBy: 'user-1',
          context: JSON.stringify(dispatched),
          output: JSON.stringify({ version: 1, outcomes: [] }),
        }),
      },
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    };
    const queue = { enqueueWiki: jest.fn().mockResolvedValue(undefined) };
    const service = new SdlcWikiExecutionService(prisma as never, queue);
    const page = {
      purpose: 'System entry point',
      concepts: ['System'],
      priority: 'HIGH',
      archetype: 'overview',
      sourceAreas: ['src'],
      relatedPages: [],
      tableCandidates: [],
      diagramCandidates: [],
    };

    await service.handleCallback('execution-1', 'BOOTSTRAP_SURVEY', {
      sessionId: 'session-1',
      status: 'completed',
      result: {
        repositorySummary: 'Repository',
        pages: [
          { ...page, path: 'overview' },
          { ...page, path: 'overview.md' },
          { ...page, path: 'subsystems/backend' },
          { ...page, path: '../unsafe' },
        ],
      },
    });

    const persisted = JSON.parse(updateMany.mock.calls[0][0].data.context) as WikiExecutionContext;
    expect(persisted.bootstrapPlan?.pages.map((candidate) => candidate.path)).toEqual([
      'overview.md',
      'subsystems/backend.md',
    ]);
  });
});

describe('SdlcWikiExecutionService terminal transition CAS', () => {
  it('does not resurrect a cancelled run when a late callback tries to requeue', async () => {
    const { service, updateMany, workflowUpdate, queue } = harness([0]);
    await transitions(service).requeue('execution-1', 'workflow-1', context());

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'execution-1', status: 'RUNNING' } })
    );
    expect(workflowUpdate).not.toHaveBeenCalled();
    expect(queue.enqueueWiki).not.toHaveBeenCalled();
  });

  it('collapses duplicate callbacks to one requeue and one job', async () => {
    const { service, workflowUpdate, queue } = harness([1, 0]);
    await transitions(service).requeue('execution-1', 'workflow-1', context());
    await transitions(service).requeue('execution-1', 'workflow-1', context());

    expect(workflowUpdate).toHaveBeenCalledTimes(1);
    expect(queue.enqueueWiki).toHaveBeenCalledTimes(1);
  });

  it('cannot finish or fail over a terminal execution', async () => {
    const { service, workflowUpdate } = harness([0, 0]);
    await transitions(service).finish('execution-1', 'workflow-1', context());
    await transitions(service).fail('execution-1', 'workflow-1', context(), 'late failure');

    expect(workflowUpdate).not.toHaveBeenCalled();
  });
});

describe('SdlcWikiExecutionService reconciliation', () => {
  it('times out a Claw run without renewing its admission permit', async () => {
    const timedOut = {
      ...context(),
      clawRunDeadlineAt: new Date(Date.now() - 1).toISOString(),
    };
    const serialized = JSON.stringify(timedOut);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      workflowExecution: { updateMany },
      workflow: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      workflowExecution: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'execution-1',
            workflowId: 'workflow-1',
            createdBy: 'user-1',
            context: serialized,
            updatedAt: new Date(),
          },
        ]),
      },
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    };
    jest.mocked(cancelS2SClawRun).mockResolvedValueOnce({ success: true, status: 'cancelled' });
    const service = new SdlcWikiExecutionService(prisma as never, { enqueueWiki: jest.fn() });

    await expect(service.reconcileExecutions()).resolves.toBeUndefined();

    expect(cancelS2SClawRun).toHaveBeenCalledWith('session-1', 'user-1');
    expect(sdlcAdmission.renew).not.toHaveBeenCalledWith('permit-1');
    expect(sdlcAdmission.release).toHaveBeenCalledWith('permit-1');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'execution-1', context: serialized }),
        data: expect.objectContaining({ status: 'FAILURE' }),
      })
    );
  });

  beforeEach(() => jest.clearAllMocks());

  it('advances a completed bootstrap when its durable checkpoint already cleared the assignment', async () => {
    const bootstrapSha = 'b'.repeat(40);
    const checkpointed: WikiExecutionContext = {
      ...context(),
      phase: 'BOOTSTRAPPING',
      bootstrapRef: bootstrapSha,
      assignedChunk: null,
    };
    const serialized = JSON.stringify(checkpointed);
    const output = JSON.stringify({
      version: 1,
      outcomes: [
        {
          commitSha: bootstrapSha,
          status: 'updated',
          revisions: [],
          completedAt: '2026-08-11T18:10:00.000Z',
        },
      ],
    });
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const workflowUpdate = jest.fn().mockResolvedValue({});
    const tx = {
      workflowExecution: { updateMany },
      workflow: { update: workflowUpdate },
    };
    const prisma = {
      workflowExecution: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'execution-1',
            workflowId: 'workflow-1',
            createdBy: 'user-1',
            context: serialized,
            updatedAt: new Date(0),
          },
        ]),
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'execution-1',
            workflowId: 'workflow-1',
            workflow: {},
            status: 'RUNNING',
            context: serialized,
            output,
          })
          .mockResolvedValueOnce({ context: serialized }),
      },
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    };
    const queue = { enqueueWiki: jest.fn().mockResolvedValue(undefined) };
    jest.mocked(getS2SClawRunStatus).mockResolvedValueOnce({
      sessionId: 'session-1',
      status: 'completed',
      result: 'bootstrap complete',
    });
    jest.mocked(sdlcAdmission.renew).mockResolvedValueOnce(undefined);
    const service = new SdlcWikiExecutionService(prisma as never, queue);

    await expect(service.reconcileExecutions()).resolves.toBeUndefined();

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'execution-1', status: 'RUNNING' },
        data: expect.objectContaining({ status: 'PENDING' }),
      })
    );
    expect(queue.enqueueWiki).toHaveBeenCalledWith('execution-1', 'repo-1');
    expect(updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILURE' }) })
    );
  });

  it('advances a completed commit chunk when reconciliation sees only its final checkpoint', async () => {
    const nextSha = 'b'.repeat(40);
    const checkpointed: WikiExecutionContext = {
      ...context(),
      targetHeadSha: nextSha,
      selectedCommitShas: [SHA, nextSha],
      cursorSha: SHA,
      assignedChunk: null,
      counts: { total: 2, processed: 1, updated: 1, noop: 0, failed: 0 },
    };
    const serialized = JSON.stringify(checkpointed);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const workflowUpdate = jest.fn().mockResolvedValue({});
    const tx = {
      workflowExecution: { updateMany },
      workflow: { update: workflowUpdate },
    };
    const prisma = {
      workflowExecution: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'execution-1',
            workflowId: 'workflow-1',
            workflow: {},
            status: 'RUNNING',
            context: serialized,
            output: JSON.stringify({
              version: 1,
              outcomes: [
                {
                  commitSha: SHA,
                  status: 'updated',
                  revisions: [],
                  completedAt: '2026-08-11T18:10:00.000Z',
                },
              ],
            }),
          })
          .mockResolvedValueOnce({ context: serialized }),
      },
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    };
    const queue = { enqueueWiki: jest.fn().mockResolvedValue(undefined) };
    const service = new SdlcWikiExecutionService(prisma as never, queue);

    await expect(
      service.handleCallback('execution-1', 'GENERATOR', {
        sessionId: 'session-1',
        status: 'completed',
        result: 'chunk complete',
      })
    ).resolves.toBeUndefined();

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'execution-1', status: 'RUNNING' },
        data: expect.objectContaining({ status: 'PENDING' }),
      })
    );
    expect(queue.enqueueWiki).toHaveBeenCalledWith('execution-1', 'repo-1');
    expect(updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILURE' }) })
    );
  });

  it('requeues only the durable suffix when a completed v2 agent misses the endpoint', async () => {
    const endpoint = 'b'.repeat(40);
    const intermediate = 'c'.repeat(40);
    const dispatched: WikiExecutionContext = {
      ...context(),
      version: 2,
      executionModel: 'HISTORY_WINDOW',
      targetHeadSha: endpoint,
      selectedCommitShas: [intermediate, endpoint],
      assignedChunk: {
        kind: 'COMMITS',
        conversationId: 'conversation-1',
        sessionId: 'session-1',
        commitShas: [intermediate, endpoint],
        nextIndex: 0,
        window: {
          beforeSha: SHA,
          afterSha: endpoint,
          activeCheckpointSha: null,
          completedCheckpointShas: [],
        },
      },
      counts: {
        total: 2,
        processed: 0,
        updated: 0,
        noop: 0,
        failed: 0,
        aggregated: 0,
        windows: { total: 1, completed: 0, updated: 0, noop: 0, failed: 0, intermediate: 0 },
      },
    };
    const checkpointed: WikiExecutionContext = {
      ...dispatched,
      cursorSha: intermediate,
      assignedChunk: {
        ...dispatched.assignedChunk!,
        nextIndex: 1,
        window: {
          ...dispatched.assignedChunk!.window!,
          completedCheckpointShas: [intermediate],
        },
      },
      counts: {
        ...dispatched.counts,
        processed: 1,
        updated: 1,
        aggregated: 0,
        windows: { ...dispatched.counts.windows!, intermediate: 1 },
      },
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      workflowExecution: { updateMany },
      workflow: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      workflowExecution: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'execution-1',
            workflowId: 'workflow-1',
            workflow: {},
            status: 'RUNNING',
            context: JSON.stringify(dispatched),
            output: JSON.stringify({ version: 2, outcomes: [] }),
          })
          .mockResolvedValueOnce({ context: JSON.stringify(checkpointed) }),
      },
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    };
    const queue = { enqueueWiki: jest.fn().mockResolvedValue(undefined) };
    const service = new SdlcWikiExecutionService(prisma as never, queue);

    await service.handleCallback('execution-1', 'GENERATOR', {
      sessionId: 'session-1',
      status: 'completed',
      result: 'done',
    });

    const saved = JSON.parse(updateMany.mock.calls[0]![0].data.context) as WikiExecutionContext;
    expect(saved.assignedChunk?.nextIndex).toBe(1);
    expect(saved.assignedChunk?.window?.afterSha).toBe(endpoint);
    expect(saved.sessionId).toBeNull();
    expect(saved.recovery).toEqual(expect.objectContaining({ attempts: 1, noProgressAttempts: 0 }));
    expect(queue.enqueueWiki).toHaveBeenCalledWith('execution-1', 'repo-1');
  });

  it('requeues a v2 infrastructure failure without discarding its assigned window', async () => {
    const endpoint = 'b'.repeat(40);
    const dispatched: WikiExecutionContext = {
      ...context(),
      version: 2,
      executionModel: 'HISTORY_WINDOW',
      targetHeadSha: endpoint,
      selectedCommitShas: [endpoint],
      assignedChunk: {
        kind: 'COMMITS',
        conversationId: 'conversation-1',
        sessionId: 'session-1',
        commitShas: [endpoint],
        nextIndex: 0,
        window: {
          beforeSha: SHA,
          afterSha: endpoint,
          activeCheckpointSha: null,
          completedCheckpointShas: [],
        },
      },
      counts: {
        total: 1,
        processed: 0,
        updated: 0,
        noop: 0,
        failed: 0,
        aggregated: 0,
        windows: { total: 1, completed: 0, updated: 0, noop: 0, failed: 0, intermediate: 0 },
      },
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = { workflowExecution: { updateMany }, workflow: { update: jest.fn() } };
    const prisma = {
      workflowExecution: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'execution-1',
            workflowId: 'workflow-1',
            workflow: {},
            status: 'RUNNING',
            context: JSON.stringify(dispatched),
            output: JSON.stringify({ version: 2, outcomes: [] }),
          })
          .mockResolvedValueOnce({ context: JSON.stringify(dispatched) }),
      },
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    };
    const queue = { enqueueWiki: jest.fn() };
    const service = new SdlcWikiExecutionService(prisma as never, queue);

    await service.handleCallback('execution-1', 'GENERATOR', {
      sessionId: 'session-1',
      status: 'failed',
      error: 'sandbox command timed out',
    });

    expect(queue.enqueueWiki).toHaveBeenCalledWith('execution-1', 'repo-1');
    const saved = JSON.parse(updateMany.mock.calls[0]![0].data.context) as WikiExecutionContext;
    expect(saved.assignedChunk?.window?.afterSha).toBe(endpoint);
    expect(saved.recovery?.lastCause).toContain('timed out');
  });

  it('preserves an active execution when Claw status fetch fails transiently', async () => {
    const prisma = {
      workflowExecution: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'execution-1',
            workflowId: 'workflow-1',
            createdBy: 'user-1',
            context: JSON.stringify(context()),
          },
        ]),
      },
    };
    jest.mocked(getS2SClawRunStatus).mockRejectedValueOnce(new Error('fetch failed'));
    jest.mocked(sdlcAdmission.renew).mockResolvedValueOnce(undefined);
    const service = new SdlcWikiExecutionService(prisma as never, {
      enqueueWiki: jest.fn(),
    });

    await expect(service.reconcileExecutions()).resolves.toBeUndefined();

    expect(sdlcAdmission.release).not.toHaveBeenCalledWith('permit-1');
  });

  it('does not terminalize a recently active Wiki execution from one failed Claw status', async () => {
    const findUnique = jest.fn();
    const prisma = {
      workflowExecution: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'execution-1',
            workflowId: 'workflow-1',
            createdBy: 'user-1',
            context: JSON.stringify(context()),
            updatedAt: new Date(),
          },
        ]),
        findUnique,
      },
    };
    jest.mocked(getS2SClawRunStatus).mockResolvedValueOnce({
      sessionId: 'session-1',
      status: 'failed',
      error: 'sse stream broken',
    });
    jest.mocked(sdlcAdmission.renew).mockResolvedValueOnce(undefined);
    const service = new SdlcWikiExecutionService(prisma as never, {
      enqueueWiki: jest.fn(),
    });

    await expect(service.reconcileExecutions()).resolves.toBeUndefined();

    expect(findUnique).not.toHaveBeenCalled();
    expect(sdlcAdmission.release).not.toHaveBeenCalledWith('permit-1');
  });
});

describe('SdlcWikiExecutionService staged bootstrap', () => {
  const plan = {
    repositorySummary: 'Repository',
    nextPageIndex: 0,
    pendingEditorialPath: null,
    correction: null,
    editorialReports: [],
    pages: [
      {
        path: 'overview.md',
        purpose: 'Overview',
        concepts: ['System'],
        priority: 'HIGH' as const,
        archetype: 'overview' as const,
        sourceAreas: ['src'],
        relatedPages: [],
        tableCandidates: [],
        diagramCandidates: [],
      },
    ],
  };

  function callbackHarness(value: WikiExecutionContext, durableOverride?: WikiExecutionContext) {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      workflowExecution: { updateMany },
      workflow: { update: jest.fn().mockResolvedValue({}) },
    };
    const durable =
      value.assignedChunk?.kind === 'BOOTSTRAP_PAGE'
        ? {
            ...value,
            pendingCommit: {
              commitSha: value.bootstrapRef!,
              pages: [
                {
                  path:
                    value.bootstrapPlan?.correction?.path ??
                    value.bootstrapPlan?.pages[value.bootstrapPlan.nextPageIndex]?.path ??
                    'overview.md',
                  requestHash: 'request-hash',
                  writerSessionId: value.assignedChunk.sessionId,
                  revision: {
                    action: 'created' as const,
                    commitSha: value.bootstrapRef!,
                    canvasId: 'canvas-1',
                    canvasVersionId: 'version-1',
                    contentHash: 'content-hash',
                    sourcePaths: ['src/index.ts'],
                  },
                },
              ],
            },
          }
        : value;
    const prisma = {
      workflowExecution: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'execution-1',
            workflowId: 'workflow-1',
            workflow: {},
            workspaceId: 'workspace-1',
            status: 'RUNNING',
            createdBy: 'user-1',
            context: JSON.stringify(value),
            output: JSON.stringify({ version: 1, outcomes: [] }),
          })
          .mockResolvedValueOnce({ context: JSON.stringify(durableOverride ?? durable) }),
      },
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    };
    const queue = { enqueueWiki: jest.fn().mockResolvedValue(undefined) };
    return { service: new SdlcWikiExecutionService(prisma as never, queue), updateMany, queue };
  }

  it('moves one completed page to a separate editorial run in Standard quality', async () => {
    const value: WikiExecutionContext = {
      ...context(),
      phase: 'BOOTSTRAPPING',
      bootstrapRef: SHA,
      bootstrapPlan: plan,
      bootstrapStage: 'PAGE',
      assignedChunk: {
        kind: 'BOOTSTRAP_PAGE',
        conversationId: 'conversation-1',
        sessionId: 'session-1',
        commitShas: [SHA],
        nextIndex: 0,
      },
    };
    const { service, updateMany } = callbackHarness(value);
    await service.handleCallback('execution-1', 'BOOTSTRAP_PAGE', {
      sessionId: 'session-1',
      status: 'completed',
      result: { completed: true },
    });
    const next = JSON.parse(updateMany.mock.calls[0][0].data.context) as WikiExecutionContext;
    expect(next.bootstrapStage).toBe('EDITOR');
    expect(next.bootstrapPlan).toMatchObject({
      nextPageIndex: 1,
      pendingEditorialPath: 'overview.md',
    });
  });

  it('does not advance a bootstrap page from another session pending evidence', async () => {
    const secondPlan = {
      ...plan,
      nextPageIndex: 1,
      pages: [plan.pages[0], { ...plan.pages[0], path: 'backend.md', purpose: 'Backend' }],
    };
    const value: WikiExecutionContext = {
      ...context(),
      phase: 'BOOTSTRAPPING',
      bootstrapRef: SHA,
      bootstrapPlan: secondPlan,
      sessionId: 'session-2',
      credentialSessionId: 'session-2',
      bootstrapStage: 'PAGE',
      assignedChunk: {
        kind: 'BOOTSTRAP_PAGE',
        conversationId: 'conversation-2',
        sessionId: 'session-2',
        commitShas: [SHA],
        nextIndex: 0,
      },
    };
    const durable: WikiExecutionContext = {
      ...value,
      pendingCommit: {
        commitSha: SHA,
        pages: [
          {
            path: 'backend.md',
            requestHash: 'old-request',
            writerSessionId: 'session-1',
            revision: {
              action: 'created',
              commitSha: SHA,
              canvasId: 'canvas-old',
              canvasVersionId: 'version-old',
              contentHash: 'content-old',
              sourcePaths: ['src/index.ts'],
            },
          },
        ],
      },
    };
    const { service, updateMany, queue } = callbackHarness(value, durable);

    await expect(
      service.handleCallback('execution-1', 'BOOTSTRAP_PAGE', {
        sessionId: 'session-2',
        status: 'completed',
        result: { completed: true },
      })
    ).resolves.toBeUndefined();

    expect(queue.enqueueWiki).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILURE',
          context: expect.stringContaining(
            'Wiki bootstrap page completed without durable page evidence: backend.md'
          ),
        }),
      })
    );
  });

  it('schedules a serialized correction when the editorial role finds an issue', async () => {
    const value: WikiExecutionContext = {
      ...context(),
      phase: 'BOOTSTRAPPING',
      bootstrapRef: SHA,
      bootstrapPlan: { ...plan, nextPageIndex: 1, pendingEditorialPath: 'overview.md' },
      bootstrapStage: 'EDITOR',
      assignedChunk: {
        kind: 'BOOTSTRAP_EDITOR',
        conversationId: 'conversation-1',
        sessionId: 'session-1',
        commitShas: [SHA],
        nextIndex: 0,
      },
    };
    const { service, updateMany } = callbackHarness(value);
    await service.handleCallback('execution-1', 'BOOTSTRAP_EDITOR', {
      sessionId: 'session-1',
      status: 'completed',
      result: {
        complete: false,
        missingTopics: [],
        issues: ['Missing failure behavior'],
        suggestions: [],
      },
    });
    const next = JSON.parse(updateMany.mock.calls[0][0].data.context) as WikiExecutionContext;
    expect(next.bootstrapStage).toBe('PAGE');
    expect(next.bootstrapPlan?.correction).toMatchObject({ path: 'overview.md' });
  });

  it('does not loop when the second editorial review still reports an issue', async () => {
    const priorReport = {
      complete: false,
      missingTopics: [],
      issues: ['Missing failure behavior'],
      suggestions: [],
    };
    const value: WikiExecutionContext = {
      ...context(),
      phase: 'BOOTSTRAPPING',
      bootstrapRef: SHA,
      sessionId: 'session-2',
      bootstrapPlan: {
        ...plan,
        nextPageIndex: 1,
        pendingEditorialPath: 'overview.md',
        editorialReports: [{ path: 'overview.md', report: priorReport }],
      },
      bootstrapStage: 'EDITOR',
      assignedChunk: {
        kind: 'BOOTSTRAP_EDITOR',
        conversationId: 'conversation-2',
        sessionId: 'session-2',
        commitShas: [SHA],
        nextIndex: 0,
      },
    };
    const { service, updateMany } = callbackHarness(value);
    await service.handleCallback('execution-1', 'BOOTSTRAP_EDITOR', {
      sessionId: 'session-2',
      status: 'completed',
      result: priorReport,
    });
    const next = JSON.parse(updateMany.mock.calls[0][0].data.context) as WikiExecutionContext;
    expect(next.bootstrapStage).toBe('FINALIZE');
    expect(next.bootstrapPlan?.correction).toBeNull();
    expect(next.bootstrapPlan?.editorialReports).toHaveLength(2);
  });
});
