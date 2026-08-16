jest.mock('@xyne/shared', () => ({
  ACLAuditEventType: {
    RESOURCE_CREATED: 'RESOURCE_CREATED',
    RESOURCE_DELETED: 'RESOURCE_DELETED',
    RESOURCE_UPDATED: 'RESOURCE_UPDATED',
  },
  ACLAuditTargetType: { RESOURCE: 'RESOURCE' },
}));
jest.mock('../../../src/database/client', () => ({
  DatabaseClient: { getInstance: jest.fn() },
}));
jest.mock('../../../src/queues/sdlcQueue', () => ({ sdlcQueue: {} }));
jest.mock('../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { SdlcVcsService } from '../../../src/sdlc/vcs/SdlcVcsService';
import { issueSdlcInteractiveGrant } from '../../../src/sdlc/vcs/sdlcInteractiveGrant';

describe('interactive SDLC draft pull request', () => {
  it('revalidates authority and creates only the verified draft', async () => {
    process.env['INTERNAL_S2S_KEY'] = 'interactive-pr-test-secret';
    const repo = {
      id: 'repo-1',
      workspaceId: 'workspace-1',
      canonicalUrl: 'https://github.com/acme/repo',
      url: 'https://github.com/acme/repo',
      baseBranch: ['main'],
    };
    const prisma = { repo: { findUnique: jest.fn().mockResolvedValue(repo) } };
    const service = new SdlcVcsService(prisma as never);
    jest.spyOn(service as never, 'requireRepositoryMember' as never).mockResolvedValue({} as never);
    const capabilities = jest.spyOn(service, 'requireCapabilities').mockResolvedValue(undefined);
    jest.spyOn(service as never, 'requireConnectedCredential' as never).mockResolvedValue({
      token: 'github_pat_test',
    } as never);
    const adapter = {
      parseRepositoryUrl: jest.fn().mockReturnValue({ owner: 'acme', name: 'repo' }),
      verifyRemoteCommit: jest.fn().mockResolvedValue(undefined),
      createDraftPullRequest: jest.fn().mockResolvedValue({
        url: 'https://github.com/acme/repo/pull/1',
        number: 1,
        draft: true,
        head: 'feature/change',
        base: 'main',
      }),
    };
    jest.spyOn(service as never, 'adapter' as never).mockReturnValue(adapter as never);
    const interactiveGrant = issueSdlcInteractiveGrant(
      {
        agentSlug: 'sdlc-agent',
        workspaceId: 'workspace-1',
        repoId: 'repo-1',
        actorUserId: 'user-1',
        conversationId: 'conversation-1',
      },
      process.env['INTERNAL_S2S_KEY']
    );
    const commitHash = 'a'.repeat(40);

    await expect(
      service.createDraftPullRequest({
        interactiveGrant,
        conversationId: 'conversation-1',
        repoId: 'repo-1',
        title: 'Change',
        body: '',
        head: 'feature/change',
        base: 'main',
        commitHash,
      })
    ).resolves.toMatchObject({ draft: true, head: 'feature/change', base: 'main' });
    expect(capabilities).toHaveBeenCalledWith(
      { userId: 'user-1', workspaceId: 'workspace-1' },
      'repo-1',
      ['READ_REPOSITORY', 'CREATE_PULL_REQUEST']
    );
    expect(adapter.verifyRemoteCommit).toHaveBeenCalledWith(
      'github_pat_test',
      { owner: 'acme', name: 'repo' },
      'feature/change',
      commitHash
    );
  });
});
