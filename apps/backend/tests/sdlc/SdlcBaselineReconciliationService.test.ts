import { SdlcBaselineReconciliationService } from '../../src/sdlc/SdlcBaselineReconciliationService';

describe('SdlcBaselineReconciliationService', () => {
  it('queues a refresh-mode baseline execution linked to the completed Wiki run', async () => {
    const workflowCreate = jest.fn().mockResolvedValue({ id: 'workflow-knowledge' });
    const executionCreate = jest.fn().mockResolvedValue({
      id: 'execution-knowledge',
      workflowId: 'workflow-knowledge',
    });
    const repoUpdate = jest.fn().mockResolvedValue({});
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      workflow: { create: workflowCreate },
      workflowExecution: { create: executionCreate },
      repo: { update: repoUpdate },
    };
    const prisma = {
      repo: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'repo-1',
          name: 'Repo',
          workspaceId: 'workspace-1',
          projectId: 'project-1',
          sdlcSetupExecutionId: null,
        }),
      },
      workflowExecution: {
        findUnique: jest.fn().mockResolvedValue({ createdBy: 'admin-1', status: 'SUCCESS' }),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const queue = { enqueueSetup: jest.fn().mockResolvedValue(undefined) };
    const service = new SdlcBaselineReconciliationService(prisma as never, queue);

    await expect(service.queueAfterWiki('repo-1', 'wiki-1')).resolves.toBe('execution-knowledge');

    const context = JSON.parse(executionCreate.mock.calls[0][0].data.context);
    expect(context).toMatchObject({
      repoId: 'repo-1',
      refreshExisting: true,
      parentWikiExecutionId: 'wiki-1',
      completedBaselineKinds: [],
      reconciledBaselineKinds: [],
    });
    expect(repoUpdate).toHaveBeenCalledWith({
      where: { id: 'repo-1' },
      data: { sdlcSetupExecutionId: 'execution-knowledge' },
    });
    expect(queue.enqueueSetup).toHaveBeenCalledWith('execution-knowledge', 'repo-1');
  });

  it('reuses an active knowledge execution instead of starting another', async () => {
    const prisma = {
      repo: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'repo-1',
          name: 'Repo',
          workspaceId: 'workspace-1',
          projectId: 'project-1',
          sdlcSetupExecutionId: 'execution-active',
        }),
      },
      workflowExecution: {
        findUnique: jest.fn().mockResolvedValue({ createdBy: 'admin-1', status: 'SUCCESS' }),
        findFirst: jest.fn().mockResolvedValue({ id: 'execution-active' }),
      },
    };
    const queue = { enqueueSetup: jest.fn() };
    const service = new SdlcBaselineReconciliationService(prisma as never, queue);

    await expect(service.queueAfterWiki('repo-1', 'wiki-1')).resolves.toBe('execution-active');
    expect(queue.enqueueSetup).not.toHaveBeenCalled();
  });
});
