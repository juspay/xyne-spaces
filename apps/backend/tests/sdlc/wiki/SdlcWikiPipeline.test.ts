const mockRequireCapabilities = jest.fn();

jest.mock('../../../src/database/client', () => ({
  DatabaseClient: { getInstance: jest.fn() },
}));
jest.mock('../../../src/queues/sdlcAdmission', () => ({
  sdlcAdmission: { release: jest.fn() },
}));
jest.mock('../../../src/services/clawAgentService', () => ({
  cancelS2SClawRun: jest.fn(),
}));
jest.mock('../../../src/sdlc/vcs', () => ({
  sdlcVcs: { requireCapabilities: mockRequireCapabilities },
}));
jest.mock('../../../src/config/env', () => ({
  config: {
    env: 'test',
    logging: { level: 'error', fluent: { enabled: false, host: 'localhost', port: 24224 } },
  },
}));

import { SdlcWikiPipelineService } from '../../../src/sdlc/wiki/SdlcWikiPipeline';
import { parseWikiExecutionContext } from '../../../src/sdlc/wiki/wikiRunState';

const SHA_1 = '1'.repeat(40);
const SHA_2 = '2'.repeat(40);

function cancelledContext() {
  return {
    version: 2 as const,
    executionModel: 'HISTORY_WINDOW' as const,
    repoId: 'repo-1',
    agentSlug: 'sdlc-agent' as const,
    conversationId: 'conversation-old',
    sessionId: 'session-old',
    credentialSessionId: 'session-old',
    admissionPermitId: 'permit-old',
    phase: 'CANCELLED' as const,
    runMode: 'INITIAL' as const,
    historyRange: { kind: 'FULL' as const },
    chunkSize: 10 as const,
    quality: 'QUICK' as const,
    baseBranch: 'main',
    targetHeadSha: SHA_2,
    bootstrapRef: SHA_1,
    selectedStartSha: SHA_1,
    selectedCommitShas: [SHA_1, SHA_2],
    cursorSha: SHA_1,
    assignedChunk: {
      kind: 'COMMITS' as const,
      conversationId: 'conversation-old',
      sessionId: 'session-old',
      commitShas: [SHA_2],
      nextIndex: 0,
      window: {
        beforeSha: SHA_1,
        afterSha: SHA_2,
        activeCheckpointSha: SHA_2,
        completedCheckpointShas: [],
      },
    },
    counts: {
      total: 2,
      processed: 1,
      updated: 1,
      noop: 0,
      failed: 0,
      aggregated: 0,
      windows: { total: 2, completed: 1, updated: 1, noop: 0, failed: 0, intermediate: 0 },
    },
    pendingCommit: null,
    validatorReports: [],
    error: null,
    errorCode: null,
  };
}

describe('SdlcWikiPipeline repository gates', () => {
  beforeEach(() => mockRequireCapabilities.mockReset().mockResolvedValue(undefined));

  const repository = (role: 'ADMIN' | 'MEMBER' = 'ADMIN') => ({
    id: 'repo-1',
    name: 'repo',
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    channelId: 'channel-1',
    createdBy: 'user-1',
    baseBranch: ['main'],
    accessCapabilities: [
      {
        capability: 'READ_REPOSITORY',
        state: 'PROVEN',
        source: 'github-api',
        detail: 'verified',
      },
    ],
    channel: { participants: [{ role }] },
  });

  it('delegates the admin start gate to proven VCS capability evidence', async () => {
    const prisma = {
      repo: {
        findFirst: jest.fn().mockResolvedValue(repository()),
      },
    };
    const service = new SdlcWikiPipelineService(prisma as never);

    await expect(
      (
        service as unknown as {
          requireRepository(
            actor: { userId: string; workspaceId: string },
            repoId: string,
            requireAdmin: boolean
          ): Promise<unknown>;
        }
      ).requireRepository({ userId: 'user-1', workspaceId: 'workspace-1' }, 'repo-1', true)
    ).resolves.toMatchObject({ id: 'repo-1' });
    expect(mockRequireCapabilities).toHaveBeenCalledWith(
      { userId: 'user-1', workspaceId: 'workspace-1' },
      'repo-1',
      ['READ_REPOSITORY']
    );
  });

  it('rejects Wiki mutations from repository members before checking VCS capability', async () => {
    const prisma = { repo: { findFirst: jest.fn().mockResolvedValue(repository('MEMBER')) } };
    const service = new SdlcWikiPipelineService(prisma as never);

    await expect(
      service.start({ userId: 'user-1', workspaceId: 'workspace-1' }, 'repo-1', {
        historyRange: { kind: 'LAST_PERCENT', percent: 20 },
        chunkSize: 10,
        quality: 'STANDARD',
      })
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockRequireCapabilities).not.toHaveBeenCalled();
  });

  it('serializes starts on the repository row and rejects a second active Wiki run', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'repo-1' }]),
      sdlcEntityLink: {
        findMany: jest.fn().mockResolvedValue([{ targetId: 'execution-active' }]),
      },
      workflowExecution: {
        findFirst: jest.fn().mockResolvedValue({ id: 'execution-active' }),
      },
      workflow: { create: jest.fn() },
    };
    const prisma = {
      repo: { findFirst: jest.fn().mockResolvedValue(repository()) },
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    };
    const service = new SdlcWikiPipelineService(prisma as never, { enqueueWiki: jest.fn() });

    await expect(
      service.start({ userId: 'user-1', workspaceId: 'workspace-1' }, 'repo-1', {
        historyRange: { kind: 'LAST_PERCENT', percent: 20 },
        chunkSize: 10,
        quality: 'STANDARD',
      })
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.workflow.create).not.toHaveBeenCalled();
  });

  it('resumes a cancelled run with its durable history-window assignment', async () => {
    const serialized = JSON.stringify(cancelledContext());
    const tx = {
      workflowExecution: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      workflow: { update: jest.fn().mockResolvedValue({}) },
    };
    const now = new Date('2026-08-14T00:00:00.000Z');
    const prisma = {
      repo: { findFirst: jest.fn().mockResolvedValue(repository()) },
      sdlcEntityLink: { findFirst: jest.fn().mockResolvedValue({ targetId: 'execution-1' }) },
      workflowExecution: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'execution-1',
          workflowId: 'workflow-1',
          status: 'CANCELLED',
          context: serialized,
          createdBy: null,
          createdAt: now,
          updatedAt: now,
        }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 'execution-1', createdAt: now, updatedAt: now }),
      },
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    };
    const queue = { enqueueWiki: jest.fn().mockResolvedValue(undefined) };
    const service = new SdlcWikiPipelineService(prisma as never, queue);

    const result = await service.retry({ userId: 'user-1', workspaceId: 'workspace-1' }, 'repo-1');

    expect(result.phase).toBe('QUEUED');
    expect(queue.enqueueWiki).toHaveBeenCalledWith('execution-1', 'repo-1');
    const update = tx.workflowExecution.updateMany.mock.calls[0]![0];
    expect(update.where.status).toBe('CANCELLED');
    const resumed = parseWikiExecutionContext(update.data.context);
    expect(resumed.assignedChunk).toEqual(cancelledContext().assignedChunk);
    expect(resumed.sessionId).toBeNull();
    expect(resumed.admissionPermitId).toBeNull();
  });

  it('does not report a terminal workflow as actively generating from stale context', async () => {
    const staleContext = {
      ...cancelledContext(),
      phase: 'PROCESSING' as const,
      error: null,
    };
    const now = new Date('2026-08-14T00:00:00.000Z');
    const prisma = {
      repo: {
        findFirst: jest.fn().mockResolvedValue(repository()),
        findUnique: jest.fn().mockResolvedValue({ sdlcSetupExecutionId: null }),
      },
      sdlcEntityLink: { findFirst: jest.fn().mockResolvedValue({ targetId: 'execution-1' }) },
      workflowExecution: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'execution-1',
          workflowId: 'workflow-1',
          status: 'FAILURE',
          context: JSON.stringify(staleContext),
          createdBy: null,
          createdAt: now,
          updatedAt: now,
        }),
      },
    };
    const service = new SdlcWikiPipelineService(prisma as never);

    const result = await service.getStatus(
      { userId: 'user-1', workspaceId: 'workspace-1' },
      'repo-1'
    );

    expect(result?.phase).toBe('PARTIALLY_FAILED');
  });
});
