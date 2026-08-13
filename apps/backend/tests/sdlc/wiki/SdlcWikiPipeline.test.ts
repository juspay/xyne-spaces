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
  config: { env: 'test', logging: { level: 'error' } },
}));

import { SdlcWikiPipelineService } from '../../../src/sdlc/wiki/SdlcWikiPipeline';

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
      ).requireRepository(
        { userId: 'user-1', workspaceId: 'workspace-1' },
        'repo-1',
        true
      )
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
      service.start(
        { userId: 'user-1', workspaceId: 'workspace-1' },
        'repo-1',
        { historyRange: { kind: 'LAST_PERCENT', percent: 20 }, chunkSize: 10, quality: 'STANDARD' }
      )
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
      service.start(
        { userId: 'user-1', workspaceId: 'workspace-1' },
        'repo-1',
        { historyRange: { kind: 'LAST_PERCENT', percent: 20 }, chunkSize: 10, quality: 'STANDARD' }
      )
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.workflow.create).not.toHaveBeenCalled();
  });
});
